package proxy

import (
	"fmt"
	"io"
	"net"
	"sync"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/proto"
	"github.com/serverme/serverme/server/internal/control"
	"github.com/serverme/serverme/server/internal/tunnel"
)

// TLSProxy handles TLS passthrough tunnels using SNI-based routing.
// It peeks at the TLS ClientHello to extract the SNI hostname, then
// routes the entire TLS connection (unmodified) to the appropriate tunnel client.
type TLSProxy struct {
	registry *tunnel.Registry
	manager  *control.Manager
	log      zerolog.Logger
}

// NewTLSProxy creates a new TLS passthrough proxy.
func NewTLSProxy(registry *tunnel.Registry, manager *control.Manager, log zerolog.Logger) *TLSProxy {
	return &TLSProxy{
		registry: registry,
		manager:  manager,
		log:      log.With().Str("component", "tls_proxy").Logger(),
	}
}

// HandleConn processes an incoming TLS connection by peeking at SNI.
func (p *TLSProxy) HandleConn(conn net.Conn) {
	defer conn.Close()

	// Peek at the TLS ClientHello to extract SNI
	hello, buf, err := peekClientHello(conn)
	if err != nil {
		p.log.Debug().Err(err).Msg("failed to peek TLS ClientHello")
		return
	}

	hostname := hello.ServerName
	if hostname == "" {
		p.log.Debug().Msg("TLS ClientHello has no SNI")
		return
	}

	tun := p.registry.LookupByHost(hostname)
	if tun == nil {
		p.log.Debug().Str("sni", hostname).Msg("no TLS tunnel for SNI hostname")
		return
	}

	ctrlConn, ok := p.manager.Get(tun.ClientID)
	if !ok {
		p.log.Warn().Str("client_id", tun.ClientID).Msg("TLS: client not connected")
		return
	}

	stream, err := ctrlConn.RequestProxy()
	if err != nil {
		p.log.Error().Err(err).Msg("TLS: failed to get proxy stream")
		return
	}
	defer stream.Close()

	// Send StartProxy
	if err := proto.WriteMsg(stream, proto.TypeStartProxy, &proto.StartProxy{
		URL:        tun.URL,
		ClientAddr: conn.RemoteAddr().String(),
	}); err != nil {
		p.log.Error().Err(err).Msg("TLS: failed to send StartProxy")
		return
	}

	// Write the buffered data (the ClientHello we already read) first
	if _, err := stream.Write(buf); err != nil {
		p.log.Error().Err(err).Msg("TLS: failed to write buffered ClientHello")
		return
	}

	// Bidirectional copy for the rest
	var wg sync.WaitGroup
	wg.Add(2)
	var bytesIn, bytesOut int64

	go func() {
		defer wg.Done()
		bytesIn, _ = io.Copy(stream, conn)
	}()

	go func() {
		defer wg.Done()
		bytesOut, _ = io.Copy(conn, stream)
	}()

	wg.Wait()
	tun.RecordHit(bytesIn, bytesOut) // one hit per proxied connection

	p.log.Debug().Str("sni", hostname).Msg("TLS connection proxied")
}

// tlsClientHello holds the parsed SNI from a TLS ClientHello.
type tlsClientHello struct {
	ServerName string
}

// peekClientHello reads enough of the TLS ClientHello to extract the SNI
// server name, and returns the full bytes read so they can be forwarded.
func peekClientHello(conn net.Conn) (*tlsClientHello, []byte, error) {
	// Read the TLS record header (5 bytes): content type (1) + version (2) + length (2)
	header := make([]byte, 5)
	if _, err := io.ReadFull(conn, header); err != nil {
		return nil, nil, fmt.Errorf("read TLS header: %w", err)
	}

	// Verify it's a TLS handshake (content type 22)
	if header[0] != 0x16 {
		return nil, header, fmt.Errorf("not a TLS handshake (type %d)", header[0])
	}

	// Get the record length
	recordLen := int(header[3])<<8 | int(header[4])
	if recordLen > 16384 {
		return nil, header, fmt.Errorf("TLS record too large: %d", recordLen)
	}

	// Read the full record
	record := make([]byte, recordLen)
	if _, err := io.ReadFull(conn, record); err != nil {
		buf := append(header, record...)
		return nil, buf, fmt.Errorf("read TLS record: %w", err)
	}

	fullBuf := append(header, record...)

	// Parse the ClientHello to extract SNI
	sni, err := extractSNI(record)
	if err != nil {
		return nil, fullBuf, err
	}

	return &tlsClientHello{ServerName: sni}, fullBuf, nil
}

// extractSNI parses a TLS handshake record to find the SNI extension.
func extractSNI(record []byte) (string, error) {
	if len(record) < 4 {
		return "", fmt.Errorf("record too short")
	}

	// Handshake type should be ClientHello (1)
	if record[0] != 0x01 {
		return "", fmt.Errorf("not a ClientHello (type %d)", record[0])
	}

	// Skip: handshake type (1) + length (3) + client version (2) + random (32)
	pos := 1 + 3 + 2 + 32
	if pos >= len(record) {
		return "", fmt.Errorf("record truncated at session_id")
	}

	// Session ID (variable length)
	sessionIDLen := int(record[pos])
	pos += 1 + sessionIDLen
	if pos+2 > len(record) {
		return "", fmt.Errorf("record truncated at cipher_suites")
	}

	// Cipher suites (variable length)
	cipherSuitesLen := int(record[pos])<<8 | int(record[pos+1])
	pos += 2 + cipherSuitesLen
	if pos+1 > len(record) {
		return "", fmt.Errorf("record truncated at compression")
	}

	// Compression methods (variable length)
	compressionLen := int(record[pos])
	pos += 1 + compressionLen
	if pos+2 > len(record) {
		return "", fmt.Errorf("no extensions")
	}

	// Extensions length
	extensionsLen := int(record[pos])<<8 | int(record[pos+1])
	pos += 2

	end := pos + extensionsLen
	if end > len(record) {
		end = len(record)
	}

	// Parse extensions to find SNI (type 0x0000)
	for pos+4 <= end {
		extType := int(record[pos])<<8 | int(record[pos+1])
		extLen := int(record[pos+2])<<8 | int(record[pos+3])
		pos += 4

		if extType == 0x0000 && pos+extLen <= end {
			// SNI extension
			return parseSNIExtension(record[pos : pos+extLen])
		}

		pos += extLen
	}

	return "", fmt.Errorf("no SNI extension found")
}

// parseSNIExtension extracts the hostname from an SNI extension payload.
func parseSNIExtension(data []byte) (string, error) {
	if len(data) < 2 {
		return "", fmt.Errorf("SNI extension too short")
	}

	// Server name list length
	listLen := int(data[0])<<8 | int(data[1])
	if listLen+2 > len(data) {
		return "", fmt.Errorf("SNI list length mismatch")
	}

	pos := 2
	for pos+3 <= 2+listLen {
		nameType := data[pos]
		nameLen := int(data[pos+1])<<8 | int(data[pos+2])
		pos += 3

		if nameType == 0x00 && pos+nameLen <= len(data) {
			return string(data[pos : pos+nameLen]), nil
		}
		pos += nameLen
	}

	return "", fmt.Errorf("no host_name in SNI")
}
