package tunnel

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
)

// Tunnel represents an active tunnel with its metadata.
type Tunnel struct {
	URL        string
	Protocol   string
	Subdomain  string
	Hostname   string
	RemotePort int    // assigned TCP port (for TCP tunnels)
	LocalAddr  string
	Name       string
	Inspect    bool
	Auth       string // basic auth "user:pass"
	ClientID   string
	UserID     string // owner user ID (empty for dev-token tunnels)
}

// Registry manages active tunnels and maps hostnames/ports to them.
type Registry struct {
	mu       sync.RWMutex
	byHost   map[string]*Tunnel // hostname -> tunnel (for HTTP/TLS)
	byPort   map[int]*Tunnel    // port -> tunnel (for TCP)
	byClient map[string][]*Tunnel // clientID -> tunnels
}

// NewRegistry creates a new tunnel registry.
func NewRegistry() *Registry {
	return &Registry{
		byHost:   make(map[string]*Tunnel),
		byPort:   make(map[int]*Tunnel),
		byClient: make(map[string][]*Tunnel),
	}
}

// Register adds a tunnel to the registry.
func (r *Registry) Register(t *Tunnel) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	host := t.Subdomain
	if t.Hostname != "" {
		host = t.Hostname
	}

	if host != "" {
		if existing, exists := r.byHost[host]; exists {
			// Same-user reconnect: evict the old (likely dead) tunnel so the new one wins.
			// This fixes the case where a client disconnects uncleanly and reconnects with
				// the same subdomain before the ping-timeout has detected the old as dead.
			if t.UserID != "" && existing.UserID == t.UserID {
				r.removeTunnelLocked(existing)
			} else {
				return fmt.Errorf("hostname %q already in use", host)
			}
		}
		r.byHost[host] = t
	}

	if t.RemotePort > 0 {
		if existing, exists := r.byPort[t.RemotePort]; exists {
			if t.UserID != "" && existing.UserID == t.UserID {
				r.removeTunnelLocked(existing)
			} else {
				return fmt.Errorf("port %d already in use", t.RemotePort)
			}
		}
		r.byPort[t.RemotePort] = t
	}

	r.byClient[t.ClientID] = append(r.byClient[t.ClientID], t)
	return nil
}

// LookupByURL finds a tunnel by its full public URL.
func (r *Registry) LookupByURL(url string) *Tunnel {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, t := range r.byHost {
		if t.URL == url {
			return t
		}
	}
	for _, t := range r.byPort {
		if t.URL == url {
			return t
		}
	}
	return nil
}

// LookupByHost finds a tunnel by hostname or subdomain.
func (r *Registry) LookupByHost(host string) *Tunnel {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.byHost[host]
}

// LookupByPort finds a tunnel by TCP port.
func (r *Registry) LookupByPort(port int) *Tunnel {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.byPort[port]
}

// RemoveByClient removes all tunnels for a given client.
func (r *Registry) RemoveByClient(clientID string) []*Tunnel {
	r.mu.Lock()
	defer r.mu.Unlock()

	tunnels := r.byClient[clientID]
	for _, t := range tunnels {
		host := t.Subdomain
		if t.Hostname != "" {
			host = t.Hostname
		}
		if host != "" {
			delete(r.byHost, host)
		}
		if t.RemotePort > 0 {
			delete(r.byPort, t.RemotePort)
		}
	}
	delete(r.byClient, clientID)
	return tunnels
}

// removeTunnelLocked removes a single tunnel from all indexes.
// Caller must hold r.mu.
func (r *Registry) removeTunnelLocked(t *Tunnel) {
	host := t.Subdomain
	if t.Hostname != "" {
		host = t.Hostname
	}
	if host != "" {
		delete(r.byHost, host)
	}
	if t.RemotePort > 0 {
		delete(r.byPort, t.RemotePort)
	}
	tunnels := r.byClient[t.ClientID]
	for i, ct := range tunnels {
		if ct == t {
			r.byClient[t.ClientID] = append(tunnels[:i], tunnels[i+1:]...)
			break
		}
	}
	if len(r.byClient[t.ClientID]) == 0 {
		delete(r.byClient, t.ClientID)
	}
}

// RemoveByURL removes a specific tunnel by URL.
func (r *Registry) RemoveByURL(url string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for host, t := range r.byHost {
		if t.URL == url {
			delete(r.byHost, host)
			// Remove from client list
			tunnels := r.byClient[t.ClientID]
			for i, ct := range tunnels {
				if ct.URL == url {
					r.byClient[t.ClientID] = append(tunnels[:i], tunnels[i+1:]...)
					break
				}
			}
			return
		}
	}
}

// List returns all active tunnels.
func (r *Registry) List() []*Tunnel {
	r.mu.RLock()
	defer r.mu.RUnlock()

	seen := make(map[string]bool)
	var result []*Tunnel
	for _, t := range r.byHost {
		if !seen[t.URL] {
			seen[t.URL] = true
			result = append(result, t)
		}
	}
	for _, t := range r.byPort {
		if !seen[t.URL] {
			seen[t.URL] = true
			result = append(result, t)
		}
	}
	return result
}

// ListByUser returns tunnels owned by a specific user.
func (r *Registry) ListByUser(userID string) []*Tunnel {
	r.mu.RLock()
	defer r.mu.RUnlock()

	seen := make(map[string]bool)
	var result []*Tunnel
	for _, t := range r.byHost {
		if !seen[t.URL] && t.UserID == userID {
			seen[t.URL] = true
			result = append(result, t)
		}
	}
	for _, t := range r.byPort {
		if !seen[t.URL] && t.UserID == userID {
			seen[t.URL] = true
			result = append(result, t)
		}
	}
	return result
}

// GenerateSubdomain creates a random 8-character hex subdomain.
func GenerateSubdomain() string {
	b := make([]byte, 4)
	rand.Read(b)
	return hex.EncodeToString(b)
}
