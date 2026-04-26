package client

import (
	"bufio"
	"crypto/rand"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/proto"
	"github.com/xtaci/smux"
)

// TunnelConfig defines what tunnel to create.
type TunnelConfig struct {
	Protocol   string
	LocalAddr  string
	Subdomain  string
	Hostname   string
	RemotePort int
	Name       string
	Inspect    bool
	Auth       string
}

// ActiveTunnel represents a tunnel that's been established.
type ActiveTunnel struct {
	URL      string
	Protocol string
	Name     string
}

// RequestInspector captures proxied request metadata.
type RequestInspector interface {
	AddRequest(req *InspectedRequest)
}

// InspectedRequest holds metadata about a proxied request.
type InspectedRequest struct {
	TunnelURL  string
	Method     string
	Path       string
	StatusCode int
	Duration   time.Duration
	RemoteAddr string
}

// Client manages the connection to the ServerMe server.
type Client struct {
	serverAddr     string
	authToken      string
	tlsSkip        bool
	tunnels        []TunnelConfig
	active         []ActiveTunnel
	session        *smux.Session
	ctrlStr        *smux.Stream
	inspector      RequestInspector
	log            zerolog.Logger
	closeCh        chan struct{}
	closeOnce      sync.Once
	userShutdown   bool // true only when Ctrl+C is pressed
}

// New creates a new tunnel client.
func New(serverAddr, authToken string, tlsSkip bool, tunnels []TunnelConfig, log zerolog.Logger) *Client {
	return &Client{
		serverAddr: serverAddr,
		authToken:  authToken,
		tlsSkip:    tlsSkip,
		tunnels:    tunnels,
		log:        log,
		closeCh:    make(chan struct{}),
	}
}

// Connect establishes the connection to the server and sets up tunnels.
func (c *Client) Connect() error {
	c.log.Info().Str("server", c.serverAddr).Msg("connecting to server")

	// Dial the server
	conn, err := c.dial()
	if err != nil {
		return fmt.Errorf("dial server: %w", err)
	}

	// Create smux client session
	smuxConfig := smux.DefaultConfig()
	smuxConfig.MaxReceiveBuffer = 4 * 1024 * 1024
	smuxConfig.KeepAliveInterval = 10 * time.Second
	smuxConfig.KeepAliveTimeout = 60 * time.Second

	session, err := smux.Client(conn, smuxConfig)
	if err != nil {
		conn.Close()
		return fmt.Errorf("create smux session: %w", err)
	}
	c.session = session

	// Open control stream (stream 0)
	ctrlStr, err := session.OpenStream()
	if err != nil {
		session.Close()
		return fmt.Errorf("open control stream: %w", err)
	}
	c.ctrlStr = ctrlStr

	// Authenticate
	if err := c.authenticate(); err != nil {
		session.Close()
		return fmt.Errorf("authenticate: %w", err)
	}

	// Request tunnels
	for _, tc := range c.tunnels {
		at, err := c.requestTunnel(tc)
		if err != nil {
			c.log.Error().Err(err).Str("local", tc.LocalAddr).Msg("failed to create tunnel")
			continue
		}
		c.active = append(c.active, *at)
	}

	if len(c.active) == 0 {
		session.Close()
		return fmt.Errorf("no tunnels established")
	}

	return nil
}

// Run listens for proxy requests until the connection closes.
func (c *Client) Run() (runErr error) {
	defer c.cleanup()
	defer func() {
		if r := recover(); r != nil {
			runErr = fmt.Errorf("connection lost: %v", r)
		}
	}()

	for {
		env, err := proto.ReadMsg(c.ctrlStr)
		if err != nil {
			if c.isClosed() || errors.Is(err, io.EOF) {
				return nil
			}
			return fmt.Errorf("read control msg: %w", err)
		}

		switch env.Type {
		case proto.TypeReqProxy:
			go c.handleReqProxy()

		case proto.TypePing:
			proto.WriteMsg(c.ctrlStr, proto.TypePong, &proto.Pong{})

		case proto.TypeCloseTunnel:
			var ct proto.CloseTunnel
			proto.UnpackPayload(env, &ct)
			c.log.Warn().Str("url", ct.URL).Str("error", ct.Error).Msg("tunnel closed by server")

		default:
			c.log.Debug().Str("type", env.Type).Msg("unknown message type")
		}
	}
}

// SetInspector attaches a request inspector to the client.
func (c *Client) SetInspector(ins RequestInspector) {
	c.inspector = ins
}

// ActiveTunnels returns the list of established tunnels.
func (c *Client) ActiveTunnels() []ActiveTunnel {
	return c.active
}

// Close shuts down the client connection intentionally (user pressed Ctrl+C).
func (c *Client) Close() {
	c.userShutdown = true
	c.cleanup()
}

// cleanup closes the connection without marking it as intentional.
func (c *Client) cleanup() {
	c.closeOnce.Do(func() {
		close(c.closeCh)
		if c.ctrlStr != nil {
			c.ctrlStr.Close()
		}
		if c.session != nil {
			c.session.Close()
		}
	})
}

func (c *Client) dial() (net.Conn, error) {
	dialer := &net.Dialer{Timeout: 10 * time.Second}

	tlsConfig := &tls.Config{
		InsecureSkipVerify: c.tlsSkip,
		MinVersion:         tls.VersionTLS12,
	}

	conn, err := tls.DialWithDialer(dialer, "tcp", c.serverAddr, tlsConfig)
	if err != nil {
		// Fall back to plain TCP (dev mode)
		c.log.Debug().Msg("TLS failed, trying plain TCP")
		return dialer.Dial("tcp", c.serverAddr)
	}
	return conn, nil
}

func (c *Client) authenticate() error {
	auth := proto.Auth{
		Token:   c.authToken,
		Version: proto.Version,
		OS:      runtime.GOOS,
		Arch:    runtime.GOARCH,
	}

	if err := proto.WriteMsg(c.ctrlStr, proto.TypeAuth, &auth); err != nil {
		return fmt.Errorf("send auth: %w", err)
	}

	var resp proto.AuthResp
	if err := proto.ReadTypedMsg(c.ctrlStr, proto.TypeAuthResp, &resp); err != nil {
		return err
	}

	if resp.Error != "" {
		return fmt.Errorf("auth failed: %s", resp.Error)
	}

	c.log.Info().Str("client_id", resp.ClientID).Msg("authenticated")
	return nil
}

func (c *Client) requestTunnel(tc TunnelConfig) (*ActiveTunnel, error) {
	req := proto.ReqTunnel{
		Protocol:   tc.Protocol,
		LocalAddr:  tc.LocalAddr,
		Subdomain:  tc.Subdomain,
		Hostname:   tc.Hostname,
		RemotePort: tc.RemotePort,
		Name:       tc.Name,
		Inspect:    tc.Inspect,
		Auth:       tc.Auth,
	}

	if err := proto.WriteMsg(c.ctrlStr, proto.TypeReqTunnel, &req); err != nil {
		return nil, fmt.Errorf("send ReqTunnel: %w", err)
	}

	var resp proto.NewTunnel
	if err := proto.ReadTypedMsg(c.ctrlStr, proto.TypeNewTunnel, &resp); err != nil {
		return nil, err
	}

	if resp.Error != "" {
		return nil, fmt.Errorf("tunnel error: %s", resp.Error)
	}

	return &ActiveTunnel{
		URL:      resp.URL,
		Protocol: resp.Protocol,
		Name:     resp.Name,
	}, nil
}

func (c *Client) handleReqProxy() {
	// Open a new smux stream for this proxy connection
	stream, err := c.session.OpenStream()
	if err != nil {
		c.log.Error().Err(err).Msg("failed to open proxy stream")
		return
	}

	// Send RegProxy to identify ourselves
	if err := proto.WriteMsg(stream, proto.TypeRegProxy, &proto.RegProxy{}); err != nil {
		c.log.Error().Err(err).Msg("failed to send RegProxy")
		stream.Close()
		return
	}

	// Read StartProxy to know where to connect
	var start proto.StartProxy
	if err := proto.ReadTypedMsg(stream, proto.TypeStartProxy, &start); err != nil {
		c.log.Error().Err(err).Msg("failed to read StartProxy")
		stream.Close()
		return
	}

	// Find the local address for this tunnel
	localAddr := c.findLocalAddr(start.URL)
	if localAddr == "" {
		c.log.Error().Str("url", start.URL).Msg("no local addr for tunnel")
		stream.Close()
		return
	}

	// Dial the local service
	local, err := net.DialTimeout("tcp", localAddr, 5*time.Second)
	if err != nil {
		c.log.Error().Err(err).Str("local", localAddr).Msg("failed to connect to local service")
		stream.Close()
		return
	}

	proxyStart := time.Now()

	// Read HTTP request headers line-by-line, rewriting the Host header to
	// localAddr before forwarding. Byte-level replacement avoids Go's
	// http.Request.Write re-encoding (chunked ↔ Content-Length, stripped
	// headers) which causes strict local servers like LM Studio and Ollama
	// to reject requests with 400.
	bufStream := bufio.NewReaderSize(stream, 4096)

	var method, path string
	var statusCode int
	firstLine := true

	for {
		line, err := bufStream.ReadString('\n')
		if line != "" {
			trimmed := strings.TrimRight(line, "\r\n")
			if firstLine {
				parts := strings.SplitN(trimmed, " ", 3)
				if len(parts) >= 2 {
					method, path = parts[0], parts[1]
				}
				local.Write([]byte(line))
				firstLine = false
			} else if len(trimmed) >= 5 && strings.EqualFold(trimmed[:5], "host:") {
				local.Write([]byte("Host: " + localAddr + "\r\n"))
			} else {
				local.Write([]byte(line))
			}
			if trimmed == "" {
				break // end of headers
			}
		}
		if err != nil {
			break
		}
	}

	var wg sync.WaitGroup
	wg.Add(2)

	// stream → local: pipe the request body verbatim after the rewritten headers
	go func() {
		defer wg.Done()
		io.Copy(local, bufStream)
		if tc, ok := local.(*net.TCPConn); ok {
			tc.CloseWrite()
		}
	}()

	// local → stream: sniff the status line then pipe the full response back
	go func() {
		defer wg.Done()
		bufLocal := bufio.NewReaderSize(local, 4096)
		respLine, err := bufLocal.ReadString('\n')
		if err == nil {
			parts := strings.SplitN(strings.TrimSpace(respLine), " ", 3)
			if len(parts) >= 2 {
				fmt.Sscanf(parts[1], "%d", &statusCode)
			}
		}
		stream.Write([]byte(respLine))
		io.Copy(stream, bufLocal)
		stream.Close()
	}()

	wg.Wait()
	local.Close()

	duration := time.Since(proxyStart)

	// Print request log to terminal
	if method != "" {
		c.printRequestLog(method, path, statusCode, duration)
	}

	// Notify inspector if attached
	if c.inspector != nil {
		c.inspector.AddRequest(&InspectedRequest{
			TunnelURL:  start.URL,
			Method:     method,
			Path:       path,
			StatusCode: statusCode,
			RemoteAddr: start.ClientAddr,
			Duration:   duration,
		})
	}
}

func (c *Client) printRequestLog(method, path string, statusCode int, duration time.Duration) {
	// Color codes
	const (
		reset  = "\033[0m"
		dim    = "\033[2m"
		green  = "\033[32m"
		yellow = "\033[33m"
		red    = "\033[31m"
		blue   = "\033[34m"
		cyan   = "\033[36m"
		white  = "\033[37m"
		bold   = "\033[1m"
	)

	// Status color
	sc := green
	if statusCode >= 400 {
		sc = red
	} else if statusCode >= 300 {
		sc = yellow
	}

	// Method color
	mc := blue
	switch method {
	case "POST":
		mc = green
	case "PUT", "PATCH":
		mc = yellow
	case "DELETE":
		mc = red
	}

	ts := time.Now().Format("15:04:05")

	noColor := os.Getenv("NO_COLOR") != ""
	if noColor {
		fmt.Printf("%s %s %s %d %s\n", ts, method, path, statusCode, duration.Round(time.Millisecond))
	} else {
		fmt.Printf("%s%s%s %s%-6s%s %s%-30s%s %s%d%s %s%s%s\n",
			dim, ts, reset,
			mc+bold, method, reset,
			white, path, reset,
			sc+bold, statusCode, reset,
			dim, duration.Round(time.Millisecond), reset,
		)
	}
}

func (c *Client) findLocalAddr(tunnelURL string) string {
	// Match active tunnel URL to find the corresponding local addr
	for i, at := range c.active {
		if at.URL == tunnelURL && i < len(c.tunnels) {
			return c.tunnels[i].LocalAddr
		}
	}
	// Fallback: return first tunnel's local addr
	if len(c.tunnels) > 0 {
		return c.tunnels[0].LocalAddr
	}
	return ""
}

// RunWithReconnect runs the client with automatic reconnection on disconnect.
// Survives network loss, laptop sleep, WiFi changes — never exits unless Ctrl+C.
func (c *Client) RunWithReconnect() error {
	backoff := &expBackoff{
		min:    1 * time.Second,
		max:    30 * time.Second,
		factor: 1.5,
	}

	wasConnected := true

	for {
		c.Run()

		if c.userShutdown {
			return nil
		}

		if wasConnected {
			fmt.Fprintf(os.Stderr, "\n  \033[31m●\033[0m Disconnected\n")
			wasConnected = false
		}

		// Reset for reconnect
		c.closeOnce = sync.Once{}
		c.closeCh = make(chan struct{})
		c.active = nil

		// Reconnect loop — wait for network, then reconnect
		attempt := 0
		for {
			if c.userShutdown {
				return nil
			}

			attempt++
			wait := backoff.next()

			// Wait for network to be available before attempting
			c.waitForNetwork(wait)

			if c.userShutdown {
				return nil
			}

			// Only show attempt number after first few silent retries
			if attempt <= 3 {
				fmt.Fprintf(os.Stderr, "  \033[33m●\033[0m Reconnecting...\n")
			} else if attempt%5 == 0 {
				fmt.Fprintf(os.Stderr, "  \033[33m●\033[0m Still trying (attempt %d)...\n", attempt)
			}

			if err := c.Connect(); err != nil {
				// Silent retry for network errors — don't spam the terminal
				if attempt <= 3 || attempt%10 == 0 {
					c.log.Debug().Err(err).Int("attempt", attempt).Msg("reconnect failed")
				}
				continue
			}

			backoff.reset()
			wasConnected = true

			fmt.Fprintf(os.Stderr, "  \033[32m●\033[0m Reconnected!\n\n")
			for _, t := range c.active {
				fmt.Fprintf(os.Stderr, "  \033[2mHTTP\033[0m  \033[32;1m%s\033[0m\n", t.URL)
			}
			fmt.Fprintln(os.Stderr)
			break
		}
	}
}

// waitForNetwork waits until we can resolve DNS or the timeout expires.
// This prevents spamming reconnect attempts when there's no internet.
func (c *Client) waitForNetwork(timeout time.Duration) {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		if c.userShutdown {
			return
		}

		// Try to resolve the server hostname — if it works, network is up
		host := c.serverAddr
		if idx := strings.Index(host, ":"); idx > 0 {
			host = host[:idx]
		}

		conn, err := net.DialTimeout("tcp", c.serverAddr, 3*time.Second)
		if err == nil {
			conn.Close()
			return // Network is up
		}

		// Network still down — wait a bit before checking again
		select {
		case <-time.After(2 * time.Second):
		}
	}
}

func (c *Client) isClosed() bool {
	select {
	case <-c.closeCh:
		return true
	default:
		return false
	}
}

// expBackoff implements exponential backoff with jitter.
type expBackoff struct {
	min     time.Duration
	max     time.Duration
	factor  float64
	current time.Duration
}

func (b *expBackoff) next() time.Duration {
	if b.current < b.min {
		b.current = b.min
	}

	wait := b.current

	// Add jitter: +/- 25%
	jitter := time.Duration(float64(wait) * 0.25)
	randBytes := make([]byte, 1)
	rand.Read(randBytes)
	if randBytes[0]%2 == 0 {
		wait += jitter
	} else {
		wait -= jitter
	}

	b.current = time.Duration(float64(b.current) * b.factor)
	if b.current > b.max {
		b.current = b.max
	}

	return wait
}

func (b *expBackoff) reset() {
	b.current = 0
}
