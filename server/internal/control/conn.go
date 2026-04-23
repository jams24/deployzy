package control

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/proto"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/db"
	"github.com/serverme/serverme/server/internal/tunnel"
	"github.com/xtaci/smux"
)

const (
	pingInterval = 10 * time.Second
	pingTimeout  = 25 * time.Second // close connection if no pong within this window
)

// TCPAllocator is the interface for allocating TCP tunnel ports.
type TCPAllocator interface {
	AllocatePort(tun *tunnel.Tunnel, requestedPort int) (int, error)
	ClosePort(port int)
	CloseAllForClient(clientID string)
}

// SubdomainChecker validates, reserves, and plan-gates tunnel operations.
// Implementations live in internal/db and internal/billing; the control
// package stays dependency-free on those concrete packages.
type SubdomainChecker interface {
	CheckSubdomainAvailable(ctx context.Context, subdomain, userID string) (bool, string)
	ReserveSubdomainAuto(ctx context.Context, userID, subdomain string) error
	// CheckTunnelAllowed returns "" if the user can open another tunnel of the
	// given protocol ("http"|"tcp"|"tls"), or a human-readable reason otherwise.
	// Implementations should treat is_admin users as always allowed.
	CheckTunnelAllowed(ctx context.Context, userID, protocol string, activeCount int) string
}

// Conn represents a single client's control connection.
type Conn struct {
	id               string
	userID           string // authenticated user ID (empty for dev-token)
	subdomainChecker SubdomainChecker
	session      *smux.Session
	ctrlStr      *smux.Stream // stream 0: control messages
	registry     *tunnel.Registry
	tcpAllocator TCPAllocator
	domain       string
	scheme       string
	serverHost   string // server's public host for TCP URLs
	log          zerolog.Logger
	tunnels      []string // URLs of tunnels owned by this client
	mu           sync.Mutex
	proxyCh      chan *smux.Stream // incoming data streams from client
	closeCh      chan struct{}
	closeOnce    sync.Once
	lastPong     time.Time
	pongMu       sync.Mutex
}

// NewConn creates a control connection from an accepted smux session.
func NewConn(session *smux.Session, registry *tunnel.Registry, tcpAlloc TCPAllocator, subCheck SubdomainChecker, domain, scheme, serverHost string, log zerolog.Logger) (*Conn, error) {
	// Accept the first stream as the control stream
	ctrlStr, err := session.AcceptStream()
	if err != nil {
		return nil, fmt.Errorf("accept control stream: %w", err)
	}

	return &Conn{
		session:          session,
		ctrlStr:          ctrlStr,
		registry:         registry,
		tcpAllocator:     tcpAlloc,
		subdomainChecker: subCheck,
		domain:           domain,
		scheme:           scheme,
		serverHost:       serverHost,
		log:              log,
		proxyCh:          make(chan *smux.Stream, 64),
		closeCh:          make(chan struct{}),
		lastPong:         time.Now(),
	}, nil
}

// ID returns the client ID.
func (c *Conn) ID() string {
	return c.id
}

// Authenticate performs the auth handshake.
func (c *Conn) Authenticate(validToken string) error {
	var auth proto.Auth
	if err := proto.ReadTypedMsg(c.ctrlStr, proto.TypeAuth, &auth); err != nil {
		return fmt.Errorf("read auth: %w", err)
	}

	c.log = c.log.With().Str("client_version", auth.Version).Str("os", auth.OS).Logger()

	// Validate token
	if auth.Token != validToken {
		proto.WriteMsg(c.ctrlStr, proto.TypeAuthResp, &proto.AuthResp{
			Error: "invalid auth token",
		})
		return fmt.Errorf("invalid auth token")
	}

	// Generate or reuse client ID
	if auth.ClientID != "" {
		c.id = auth.ClientID
	} else {
		c.id = tunnel.GenerateSubdomain() + tunnel.GenerateSubdomain()
	}

	c.log = c.log.With().Str("client_id", c.id).Logger()

	if err := proto.WriteMsg(c.ctrlStr, proto.TypeAuthResp, &proto.AuthResp{
		ClientID: c.id,
		Version:  proto.Version,
	}); err != nil {
		return fmt.Errorf("write auth resp: %w", err)
	}

	c.log.Info().Msg("client authenticated")
	return nil
}

// AuthenticateWithDB performs auth against the database (API key) or falls back to static token.
// JWTValidator validates JWT tokens.
type JWTValidator interface {
	Validate(tokenStr string) (*auth.Claims, error)
}

func (c *Conn) AuthenticateWithDB(staticToken string, database *db.DB, jwtMgr JWTValidator) error {
	var authMsg proto.Auth
	if err := proto.ReadTypedMsg(c.ctrlStr, proto.TypeAuth, &authMsg); err != nil {
		return fmt.Errorf("read auth: %w", err)
	}

	c.log = c.log.With().Str("client_version", authMsg.Version).Str("os", authMsg.OS).Logger()

	authenticated := false

	// Try API key auth (sm_live_...)
	if database != nil && strings.HasPrefix(authMsg.Token, "sm_live_") {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		user, err := database.ValidateAPIKey(ctx, authMsg.Token)
		if err == nil && user != nil {
			authenticated = true
			c.userID = user.ID
			c.log = c.log.With().Str("user_id", user.ID).Str("email", user.Email).Logger()
		}
	}

	// Try JWT auth (from serverme login)
	if !authenticated && jwtMgr != nil && strings.HasPrefix(authMsg.Token, "eyJ") {
		claims, err := jwtMgr.Validate(authMsg.Token)
		if err == nil {
			authenticated = true
			c.userID = claims.UserID
			c.log = c.log.With().Str("user_id", claims.UserID).Str("email", claims.Email).Logger()
		}
	}

	// Fall back to static token
	if !authenticated && authMsg.Token == staticToken {
		authenticated = true
	}

	if !authenticated {
		proto.WriteMsg(c.ctrlStr, proto.TypeAuthResp, &proto.AuthResp{
			Error: "invalid auth token",
		})
		return fmt.Errorf("invalid auth token")
	}

	// Generate or reuse client ID
	if authMsg.ClientID != "" {
		c.id = authMsg.ClientID
	} else {
		c.id = tunnel.GenerateSubdomain() + tunnel.GenerateSubdomain()
	}

	c.log = c.log.With().Str("client_id", c.id).Logger()

	if err := proto.WriteMsg(c.ctrlStr, proto.TypeAuthResp, &proto.AuthResp{
		ClientID: c.id,
		Version:  proto.Version,
	}); err != nil {
		return fmt.Errorf("write auth resp: %w", err)
	}

	c.log.Info().Msg("client authenticated")
	return nil
}

// Run processes control messages until the connection closes.
func (c *Conn) Run() error {
	defer c.Close()

	// Start accepting data streams in background
	go c.acceptProxyStreams()

	// Start ping loop
	go c.pingLoop()

	for {
		env, err := proto.ReadMsg(c.ctrlStr)
		if err != nil {
			if c.isClosed() || errors.Is(err, io.EOF) {
				return nil
			}
			return fmt.Errorf("read control msg: %w", err)
		}

		switch env.Type {
		case proto.TypeReqTunnel:
			var req proto.ReqTunnel
			if err := proto.UnpackPayload(env, &req); err != nil {
				c.log.Error().Err(err).Msg("unpack ReqTunnel")
				continue
			}
			c.handleReqTunnel(&req)

		case proto.TypePong:
			// keepalive response — record so we can detect dead connections
			c.pongMu.Lock()
			c.lastPong = time.Now()
			c.pongMu.Unlock()

		case proto.TypeCloseTunnel:
			var ct proto.CloseTunnel
			if err := proto.UnpackPayload(env, &ct); err != nil {
				continue
			}
			c.registry.RemoveByURL(ct.URL)
			c.log.Info().Str("url", ct.URL).Msg("tunnel closed by client")

		default:
			c.log.Warn().Str("type", env.Type).Msg("unknown control message")
		}
	}
}

func (c *Conn) handleReqTunnel(req *proto.ReqTunnel) {
	switch req.Protocol {
	case proto.ProtoHTTP:
		c.handleHTTPTunnel(req)
	case proto.ProtoTCP:
		c.handleTCPTunnel(req)
	case proto.ProtoTLS:
		c.handleTLSTunnel(req)
	default:
		proto.WriteMsg(c.ctrlStr, proto.TypeNewTunnel, &proto.NewTunnel{
			Error: fmt.Sprintf("unsupported protocol: %s", req.Protocol),
		})
	}
}

// gateTunnel enforces plan-based limits before a new tunnel is registered.
// Returns true if the tunnel should proceed; false + already-sent error if not.
func (c *Conn) gateTunnel(protocol string) bool {
	if c.subdomainChecker == nil || c.userID == "" {
		return true // dev-token / anon path — no gating
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	active := len(c.registry.ListByUser(c.userID))
	if reason := c.subdomainChecker.CheckTunnelAllowed(ctx, c.userID, protocol, active); reason != "" {
		proto.WriteMsg(c.ctrlStr, proto.TypeNewTunnel, &proto.NewTunnel{Error: reason})
		return false
	}
	return true
}

func (c *Conn) handleHTTPTunnel(req *proto.ReqTunnel) {
	if !c.gateTunnel("http") {
		return
	}
	subdomain := req.Subdomain
	isCustom := subdomain != ""
	if subdomain == "" {
		subdomain = tunnel.GenerateSubdomain()
	}

	// Check subdomain availability for custom subdomains
	if isCustom && c.userID != "" && c.subdomainChecker != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		available, reason := c.subdomainChecker.CheckSubdomainAvailable(ctx, subdomain, c.userID)
		if !available {
			proto.WriteMsg(c.ctrlStr, proto.TypeNewTunnel, &proto.NewTunnel{
				Error: reason,
			})
			return
		}

		// Auto-reserve the subdomain
		c.subdomainChecker.ReserveSubdomainAuto(ctx, c.userID, subdomain)
	}

	hostname := subdomain + "." + c.domain
	url := fmt.Sprintf("%s://%s", c.scheme, hostname)

	t := &tunnel.Tunnel{
		URL:       url,
		Protocol:  proto.ProtoHTTP,
		Subdomain: hostname,
		LocalAddr: req.LocalAddr,
		Name:      req.Name,
		Inspect:   req.Inspect,
		Auth:      req.Auth,
		ClientID:  c.id,
		UserID:    c.userID,
	}

	if err := c.registry.Register(t); err != nil {
		proto.WriteMsg(c.ctrlStr, proto.TypeNewTunnel, &proto.NewTunnel{
			Error: err.Error(),
		})
		return
	}

	c.mu.Lock()
	c.tunnels = append(c.tunnels, url)
	c.mu.Unlock()

	proto.WriteMsg(c.ctrlStr, proto.TypeNewTunnel, &proto.NewTunnel{
		URL:      url,
		Protocol: proto.ProtoHTTP,
		Name:     req.Name,
	})

	c.log.Info().Str("url", url).Str("subdomain", subdomain).Msg("HTTP tunnel created")
}

func (c *Conn) handleTCPTunnel(req *proto.ReqTunnel) {
	if !c.gateTunnel("tcp") {
		return
	}
	_ = req // continue
	t := &tunnel.Tunnel{
		Protocol:  proto.ProtoTCP,
		LocalAddr: req.LocalAddr,
		Name:      req.Name,
		Inspect:   req.Inspect,
		ClientID:  c.id,
		UserID:    c.userID,
	}

	if c.tcpAllocator == nil {
		proto.WriteMsg(c.ctrlStr, proto.TypeNewTunnel, &proto.NewTunnel{
			Error: "TCP tunnels not enabled on this server",
		})
		return
	}

	port, err := c.tcpAllocator.AllocatePort(t, req.RemotePort)
	if err != nil {
		proto.WriteMsg(c.ctrlStr, proto.TypeNewTunnel, &proto.NewTunnel{
			Error: fmt.Sprintf("TCP port allocation failed: %v", err),
		})
		return
	}

	t.RemotePort = port
	url := fmt.Sprintf("tcp://%s:%d", c.serverHost, port)
	t.URL = url

	if err := c.registry.Register(t); err != nil {
		c.tcpAllocator.ClosePort(port)
		proto.WriteMsg(c.ctrlStr, proto.TypeNewTunnel, &proto.NewTunnel{
			Error: err.Error(),
		})
		return
	}

	c.mu.Lock()
	c.tunnels = append(c.tunnels, url)
	c.mu.Unlock()

	proto.WriteMsg(c.ctrlStr, proto.TypeNewTunnel, &proto.NewTunnel{
		URL:      url,
		Protocol: proto.ProtoTCP,
		Name:     req.Name,
	})

	c.log.Info().Str("url", url).Int("port", port).Msg("TCP tunnel created")
}

func (c *Conn) handleTLSTunnel(req *proto.ReqTunnel) {
	if !c.gateTunnel("tls") {
		return
	}
	_ = req // continue
	subdomain := req.Subdomain
	if subdomain == "" {
		subdomain = tunnel.GenerateSubdomain()
	}

	hostname := subdomain + "." + c.domain
	url := fmt.Sprintf("tls://%s:443", hostname)

	t := &tunnel.Tunnel{
		URL:       url,
		Protocol:  proto.ProtoTLS,
		Subdomain: hostname,
		LocalAddr: req.LocalAddr,
		Name:      req.Name,
		Inspect:   false, // can't inspect encrypted TLS
		ClientID:  c.id,
		UserID:    c.userID,
	}

	if err := c.registry.Register(t); err != nil {
		proto.WriteMsg(c.ctrlStr, proto.TypeNewTunnel, &proto.NewTunnel{
			Error: err.Error(),
		})
		return
	}

	c.mu.Lock()
	c.tunnels = append(c.tunnels, url)
	c.mu.Unlock()

	proto.WriteMsg(c.ctrlStr, proto.TypeNewTunnel, &proto.NewTunnel{
		URL:      url,
		Protocol: proto.ProtoTLS,
		Name:     req.Name,
	})

	c.log.Info().Str("url", url).Str("hostname", hostname).Msg("TLS tunnel created")
}

// RequestProxy sends a ReqProxy message to the client and returns the data stream.
func (c *Conn) RequestProxy() (*smux.Stream, error) {
	if err := proto.WriteMsg(c.ctrlStr, proto.TypeReqProxy, &proto.ReqProxy{}); err != nil {
		return nil, fmt.Errorf("write ReqProxy: %w", err)
	}

	// Wait for a data stream from the client
	select {
	case stream := <-c.proxyCh:
		return stream, nil
	case <-time.After(10 * time.Second):
		return nil, fmt.Errorf("timeout waiting for proxy stream")
	case <-c.closeCh:
		return nil, fmt.Errorf("connection closed")
	}
}

// acceptProxyStreams continuously accepts new smux streams (data connections from client).
func (c *Conn) acceptProxyStreams() {
	for {
		stream, err := c.session.AcceptStream()
		if err != nil {
			if !c.isClosed() {
				c.log.Debug().Err(err).Msg("accept proxy stream ended")
			}
			return
		}

		// Read RegProxy to verify the client
		var reg proto.RegProxy
		if err := proto.ReadTypedMsg(stream, proto.TypeRegProxy, &reg); err != nil {
			c.log.Warn().Err(err).Msg("invalid proxy registration")
			stream.Close()
			continue
		}

		select {
		case c.proxyCh <- stream:
		case <-c.closeCh:
			stream.Close()
			return
		}
	}
}

func (c *Conn) pingLoop() {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			// Check if client has been silent for too long (dead connection)
			c.pongMu.Lock()
			silent := time.Since(c.lastPong)
			c.pongMu.Unlock()
			if silent > pingTimeout {
				c.log.Info().Dur("silent", silent).Msg("ping timeout — closing dead connection")
				c.Close()
				return
			}

			if err := proto.WriteMsg(c.ctrlStr, proto.TypePing, &proto.Ping{}); err != nil {
				c.log.Debug().Err(err).Msg("ping failed")
				c.Close()
				return
			}
		case <-c.closeCh:
			return
		}
	}
}

// Close shuts down the connection and removes all tunnels.
func (c *Conn) Close() {
	c.closeOnce.Do(func() {
		close(c.closeCh)
		c.ctrlStr.Close()
		c.session.Close()
		if c.tcpAllocator != nil {
			c.tcpAllocator.CloseAllForClient(c.id)
		}
		removed := c.registry.RemoveByClient(c.id)
		c.log.Info().Int("tunnels_removed", len(removed)).Msg("client disconnected")
	})
}

func (c *Conn) isClosed() bool {
	select {
	case <-c.closeCh:
		return true
	default:
		return false
	}
}

// RemoteAddr returns the client's remote address.
func (c *Conn) RemoteAddr() net.Addr {
	return c.session.RemoteAddr()
}

func init() {
	// Ensure we use all available CPU cores
	runtime.GOMAXPROCS(runtime.NumCPU())
}
