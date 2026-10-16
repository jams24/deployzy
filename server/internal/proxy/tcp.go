package proxy

import (
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/proto"
	"github.com/serverme/serverme/server/internal/control"
	"github.com/serverme/serverme/server/internal/tunnel"
)

const (
	tcpPortMin = 10000
	tcpPortMax = 60000
)

// TCPProxy manages TCP tunnel listeners.
type TCPProxy struct {
	registry  *tunnel.Registry
	manager   *control.Manager
	log       zerolog.Logger
	listeners sync.Map // port -> *tcpListener
	nextPort  atomic.Int32
}

type tcpListener struct {
	listener net.Listener
	port     int
	tunnel   *tunnel.Tunnel
	closeCh  chan struct{}
}

// NewTCPProxy creates a new TCP proxy manager.
func NewTCPProxy(registry *tunnel.Registry, manager *control.Manager, log zerolog.Logger) *TCPProxy {
	p := &TCPProxy{
		registry: registry,
		manager:  manager,
		log:      log.With().Str("component", "tcp_proxy").Logger(),
	}
	p.nextPort.Store(tcpPortMin)
	return p
}

// AllocatePort finds an available port and starts a TCP listener for the tunnel.
func (p *TCPProxy) AllocatePort(tun *tunnel.Tunnel, requestedPort int) (int, error) {
	port := requestedPort
	if port == 0 {
		var err error
		port, err = p.findAvailablePort()
		if err != nil {
			return 0, err
		}
	}

	addr := fmt.Sprintf(":%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return 0, fmt.Errorf("listen on port %d: %w", port, err)
	}

	tl := &tcpListener{
		listener: ln,
		port:     port,
		tunnel:   tun,
		closeCh:  make(chan struct{}),
	}

	p.listeners.Store(port, tl)

	go p.serve(tl)

	p.log.Info().Int("port", port).Str("client_id", tun.ClientID).Msg("TCP listener started")
	return port, nil
}

// ClosePort stops a TCP listener on the given port.
func (p *TCPProxy) ClosePort(port int) {
	if v, ok := p.listeners.LoadAndDelete(port); ok {
		tl := v.(*tcpListener)
		close(tl.closeCh)
		tl.listener.Close()
		p.log.Info().Int("port", port).Msg("TCP listener stopped")
	}
}

// CloseAllForClient stops all TCP listeners owned by a client.
func (p *TCPProxy) CloseAllForClient(clientID string) {
	p.listeners.Range(func(key, value interface{}) bool {
		tl := value.(*tcpListener)
		if tl.tunnel.ClientID == clientID {
			close(tl.closeCh)
			tl.listener.Close()
			p.listeners.Delete(key)
		}
		return true
	})
}

func (p *TCPProxy) serve(tl *tcpListener) {
	for {
		conn, err := tl.listener.Accept()
		if err != nil {
			select {
			case <-tl.closeCh:
				return
			default:
				p.log.Error().Err(err).Int("port", tl.port).Msg("TCP accept error")
				continue
			}
		}

		go p.handleTCPConn(conn, tl.tunnel)
	}
}

func (p *TCPProxy) handleTCPConn(extConn net.Conn, tun *tunnel.Tunnel) {
	defer extConn.Close()

	ctrlConn, ok := p.manager.Get(tun.ClientID)
	if !ok {
		p.log.Warn().Str("client_id", tun.ClientID).Msg("TCP: client not connected")
		return
	}

	stream, err := ctrlConn.RequestProxy()
	if err != nil {
		p.log.Error().Err(err).Msg("TCP: failed to get proxy stream")
		return
	}
	defer stream.Close()

	// Send StartProxy so the client knows which tunnel this is for
	if err := proto.WriteMsg(stream, proto.TypeStartProxy, &proto.StartProxy{
		URL:        tun.URL,
		ClientAddr: extConn.RemoteAddr().String(),
	}); err != nil {
		p.log.Error().Err(err).Msg("TCP: failed to send StartProxy")
		return
	}

	// Bidirectional copy
	var wg sync.WaitGroup
	wg.Add(2)
	var bytesIn, bytesOut int64

	go func() {
		defer wg.Done()
		bytesIn, _ = io.Copy(stream, extConn)
	}()

	go func() {
		defer wg.Done()
		bytesOut, _ = io.Copy(extConn, stream)
	}()

	wg.Wait()
	tun.RecordHit(bytesIn, bytesOut) // one hit per proxied connection

	p.log.Debug().
		Int("port", tun.RemotePort).
		Str("client", extConn.RemoteAddr().String()).
		Msg("TCP connection proxied")
}

func (p *TCPProxy) findAvailablePort() (int, error) {
	start := int(p.nextPort.Load())
	for port := start; port <= tcpPortMax; port++ {
		if _, loaded := p.listeners.Load(port); !loaded {
			// Try to actually bind to verify availability
			ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
			if err == nil {
				ln.Close()
				p.nextPort.Store(int32(port + 1))
				return port, nil
			}
		}
	}
	// Wrap around
	for port := tcpPortMin; port < start; port++ {
		if _, loaded := p.listeners.Load(port); !loaded {
			ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
			if err == nil {
				ln.Close()
				p.nextPort.Store(int32(port + 1))
				return port, nil
			}
		}
	}
	return 0, fmt.Errorf("no available TCP ports in range %d-%d", tcpPortMin, tcpPortMax)
}
