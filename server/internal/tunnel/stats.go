package tunnel

import (
	"sync/atomic"
	"time"
)

// Counters accumulates traffic for a tunnel (or a whole client session).
// Lock-free so the proxy hot path pays only a few atomic adds per request.
type Counters struct {
	requests atomic.Int64 // HTTP requests, or TCP/TLS connections
	bytesIn  atomic.Int64 // visitor → local service
	bytesOut atomic.Int64 // local service → visitor
	lastHit  atomic.Int64 // unix nanos of the most recent hit
}

// Record adds one request/connection and its byte counts.
func (c *Counters) Record(in, out int64) {
	c.requests.Add(1)
	if in > 0 {
		c.bytesIn.Add(in)
	}
	if out > 0 {
		c.bytesOut.Add(out)
	}
	c.lastHit.Store(time.Now().UnixNano())
}

// CounterSnapshot is a point-in-time copy of Counters, safe to serialize.
type CounterSnapshot struct {
	Requests int64      `json:"requests"`
	BytesIn  int64      `json:"bytes_in"`
	BytesOut int64      `json:"bytes_out"`
	LastHit  *time.Time `json:"last_hit,omitempty"`
}

// Snapshot returns the current values.
func (c *Counters) Snapshot() CounterSnapshot {
	s := CounterSnapshot{
		Requests: c.requests.Load(),
		BytesIn:  c.bytesIn.Load(),
		BytesOut: c.bytesOut.Load(),
	}
	if ns := c.lastHit.Load(); ns > 0 {
		t := time.Unix(0, ns)
		s.LastHit = &t
	}
	return s
}

// RecordHit charges one request/connection to the tunnel and, when set, to the
// owning client session so session totals survive individual tunnels closing.
func (t *Tunnel) RecordHit(in, out int64) {
	t.Stats.Record(in, out)
	if t.Session != nil {
		t.Session.Record(in, out)
	}
}
