package inspect

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/server/internal/db"
)

// Store manages captured requests across all tunnels and notifies subscribers.
type Store struct {
	mu      sync.RWMutex
	buffers map[string]*RingBuffer
	subs    map[string][]chan *CapturedRequest
	subsMu  sync.RWMutex
	db      *db.DB
	log     zerolog.Logger
}

// NewStore creates a new inspection store. If database is nil, operates in memory-only mode.
func NewStore(database *db.DB, log zerolog.Logger) *Store {
	return &Store{
		buffers: make(map[string]*RingBuffer),
		subs:    make(map[string][]chan *CapturedRequest),
		db:      database,
		log:     log.With().Str("component", "inspect_store").Logger(),
	}
}

// Capture stores a captured request in memory, persists to DB, and notifies subscribers.
func (s *Store) Capture(req *CapturedRequest) {
	if req.ID == "" {
		req.ID = generateID()
	}

	// Store in ring buffer (in-memory, for fast access)
	s.mu.Lock()
	buf, ok := s.buffers[req.TunnelURL]
	if !ok {
		buf = NewRingBuffer(defaultBufferSize)
		s.buffers[req.TunnelURL] = buf
	}
	s.mu.Unlock()

	buf.Add(req)

	// Persist to database (async, non-blocking)
	if s.db != nil {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			row := &db.CapturedRequestRow{
				ID:              req.ID,
				TunnelURL:       req.TunnelURL,
				UserID:          req.UserID,
				Timestamp:       req.Timestamp,
				DurationMs:      float64(req.Duration),
				Method:          req.Method,
				Path:            req.Path,
				Query:           req.Query,
				StatusCode:      req.StatusCode,
				RequestHeaders:  req.RequestHeaders,
				ResponseHeaders: req.ResponseHeaders,
				RequestSize:     req.RequestSize,
				ResponseSize:    req.ResponseSize,
				RemoteAddr:      req.RemoteAddr,
			}

			if err := s.db.SaveCapturedRequest(ctx, row); err != nil {
				s.log.Warn().Err(err).Str("id", req.ID).Msg("failed to persist captured request")
			}
		}()
	}

	// Notify subscribers
	s.subsMu.RLock()
	subs := s.subs[req.TunnelURL]
	s.subsMu.RUnlock()

	for _, ch := range subs {
		select {
		case ch <- req:
		default:
		}
	}
}

// List returns captured requests for a tunnel (from memory).
func (s *Store) List(tunnelURL string) []*CapturedRequest {
	s.mu.RLock()
	buf, ok := s.buffers[tunnelURL]
	s.mu.RUnlock()

	if !ok {
		return nil
	}
	return buf.List()
}

// ListFromDB returns persisted captured requests from the database.
func (s *Store) ListFromDB(ctx context.Context, tunnelURL string, limit int) ([]db.CapturedRequestRow, error) {
	if s.db == nil {
		return nil, nil
	}
	return s.db.ListCapturedRequests(ctx, tunnelURL, limit)
}

// Get retrieves a specific captured request by ID (from memory).
func (s *Store) Get(tunnelURL, requestID string) *CapturedRequest {
	s.mu.RLock()
	buf, ok := s.buffers[tunnelURL]
	s.mu.RUnlock()

	if !ok {
		return nil
	}
	return buf.Get(requestID)
}

// Subscribe creates a channel that receives new captured requests for a tunnel.
func (s *Store) Subscribe(tunnelURL string) chan *CapturedRequest {
	ch := make(chan *CapturedRequest, 64)

	s.subsMu.Lock()
	s.subs[tunnelURL] = append(s.subs[tunnelURL], ch)
	s.subsMu.Unlock()

	return ch
}

// Unsubscribe removes a subscriber channel.
func (s *Store) Unsubscribe(tunnelURL string, ch chan *CapturedRequest) {
	s.subsMu.Lock()
	defer s.subsMu.Unlock()

	subs := s.subs[tunnelURL]
	for i, sub := range subs {
		if sub == ch {
			s.subs[tunnelURL] = append(subs[:i], subs[i+1:]...)
			close(ch)
			return
		}
	}
}

// Clear removes all captured requests for a tunnel (memory only).
func (s *Store) Clear(tunnelURL string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.buffers, tunnelURL)
}

// Stats returns capture statistics.
func (s *Store) Stats() map[string]int {
	s.mu.RLock()
	defer s.mu.RUnlock()

	stats := make(map[string]int)
	for url, buf := range s.buffers {
		stats[url] = buf.Count()
	}
	return stats
}

func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// OwnerOf returns the user who owns a tunnel's captured traffic, taken from
// the newest buffered request ("" when nothing is buffered). Used to authorize
// inspector reads after a tunnel has disconnected.
func (s *Store) OwnerOf(tunnelURL string) string {
	reqs := s.List(tunnelURL)
	for i := len(reqs) - 1; i >= 0; i-- {
		if reqs[i].UserID != "" {
			return reqs[i].UserID
		}
	}
	return ""
}
