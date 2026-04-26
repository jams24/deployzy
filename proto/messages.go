package proto

import "encoding/json"

// Protocol version
const Version = "1.0.15"

// Message type constants
const (
	TypeAuth        = "Auth"
	TypeAuthResp    = "AuthResp"
	TypeReqTunnel   = "ReqTunnel"
	TypeNewTunnel   = "NewTunnel"
	TypeReqProxy    = "ReqProxy"
	TypeRegProxy    = "RegProxy"
	TypeStartProxy  = "StartProxy"
	TypePing        = "Ping"
	TypePong        = "Pong"
	TypeCloseTunnel = "CloseTunnel"
	TypeError       = "Error"
)

// Tunnel protocol types
const (
	ProtoHTTP = "http"
	ProtoTCP  = "tcp"
	ProtoTLS  = "tls"
)

// Envelope wraps every message with a type discriminator.
type Envelope struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// Auth is sent by the client immediately after connecting.
type Auth struct {
	Token    string `json:"token"`
	Version  string `json:"version"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	ClientID string `json:"client_id,omitempty"` // set on reconnect
}

// AuthResp is the server's reply to Auth.
type AuthResp struct {
	ClientID string `json:"client_id"`
	Version  string `json:"version"`
	Error    string `json:"error,omitempty"`
}

// ReqTunnel is sent by the client to request a new tunnel.
type ReqTunnel struct {
	Protocol   string `json:"protocol"`              // "http", "tcp", "tls"
	Subdomain  string `json:"subdomain,omitempty"`    // requested subdomain for HTTP
	Hostname   string `json:"hostname,omitempty"`     // custom domain
	RemotePort int    `json:"remote_port,omitempty"`  // requested port for TCP
	LocalAddr  string `json:"local_addr"`             // local address to forward to
	Name       string `json:"name,omitempty"`         // tunnel label
	Inspect    bool   `json:"inspect"`                // enable inspection
	Auth       string `json:"auth,omitempty"`         // basic auth "user:pass"
}

// NewTunnel is the server's confirmation of a tunnel.
type NewTunnel struct {
	URL      string `json:"url"`      // public URL (e.g., "https://abc123.serverme.dev")
	Protocol string `json:"protocol"`
	Name     string `json:"name"`
	Error    string `json:"error,omitempty"`
}

// ReqProxy is sent by the server when it needs the client to open a data stream.
type ReqProxy struct{}

// RegProxy is sent by the client on a new data stream to identify itself.
type RegProxy struct {
	ClientID string `json:"client_id"`
}

// StartProxy is sent by the server on the data stream to begin forwarding.
type StartProxy struct {
	URL        string `json:"url"`
	ClientAddr string `json:"client_addr"`
}

// Ping is a keepalive message.
type Ping struct{}

// Pong is the reply to Ping.
type Pong struct{}

// CloseTunnel requests graceful tunnel shutdown.
type CloseTunnel struct {
	URL   string `json:"url,omitempty"`
	Error string `json:"error,omitempty"`
}

// Error is a generic error message.
type Error struct {
	Message string `json:"message"`
}
