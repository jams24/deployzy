package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/db"
)

// redisClientForService builds a go-redis client from a service record.
func redisClientForService(svc *db.Service) *redis.Client {
	host := svc.Host
	port := svc.Port
	if svc.PublicHost != nil && *svc.PublicHost != "" {
		host = *svc.PublicHost
	}
	if svc.PublicPort != nil && *svc.PublicPort > 0 {
		port = *svc.PublicPort
	}
	opts := &redis.Options{
		Addr:         fmt.Sprintf("%s:%d", host, port),
		DialTimeout:  10 * time.Second,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}
	if svc.DBPassword != nil && *svc.DBPassword != "" {
		opts.Password = *svc.DBPassword
	}
	return redis.NewClient(opts)
}

// resolveRedisService validates ownership and type; returns the service.
func (s *Server) resolveRedisService(r *http.Request) (*db.Service, error) {
	u := auth.GetUser(r)
	serviceID := chi.URLParam(r, "serviceId")
	svc, _ := s.db.GetService(r.Context(), serviceID)
	if svc == nil || svc.UserID != u.ID {
		return nil, fmt.Errorf("service not found")
	}
	if svc.Type != "redis" {
		return nil, fmt.Errorf("not a redis service")
	}
	return svc, nil
}

// ── Key scanner ──────────────────────────────────────────────────────────────

type redisKeyInfo struct {
	Key     string `json:"key"`
	Type    string `json:"type"`
	TTL     int64  `json:"ttl"`  // seconds, -1 = no expiry, -2 = key gone
	Preview string `json:"preview"` // short value preview
	Size    int64  `json:"size"`    // len/llen/scard/hlen/zcard
}

// handleRedisKeys scans keys matching a pattern (SCAN-based, cursor paginated).
// GET /api/v1/services/{serviceId}/redis/keys?pattern=*&cursor=0&count=200
func (s *Server) handleRedisKeys(w http.ResponseWriter, r *http.Request) {
	svc, err := s.resolveRedisService(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	pattern := r.URL.Query().Get("pattern")
	if pattern == "" {
		pattern = "*"
	}
	count := int64(200)
	var cursor uint64
	fmt.Sscanf(r.URL.Query().Get("cursor"), "%d", &cursor)
	fmt.Sscanf(r.URL.Query().Get("count"), "%d", &count)
	if count < 1 || count > 1000 {
		count = 200
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	rc := redisClientForService(svc)
	defer rc.Close()

	keys, nextCursor, err := rc.Scan(ctx, cursor, pattern, count).Result()
	if err != nil {
		writeError(w, http.StatusBadGateway, "scan failed: "+err.Error())
		return
	}

	// Pipeline TYPE + TTL + a preview GET/LLEN/etc for each key.
	infos := make([]redisKeyInfo, len(keys))
	for i, k := range keys {
		infos[i].Key = k
	}

	if len(keys) > 0 {
		pipe := rc.Pipeline()
		typeCmds := make([]*redis.StatusCmd, len(keys))
		ttlCmds := make([]*redis.DurationCmd, len(keys))
		for i, k := range keys {
			typeCmds[i] = pipe.Type(ctx, k)
			ttlCmds[i] = pipe.TTL(ctx, k)
		}
		pipe.Exec(ctx) //nolint:errcheck

		// Second pipeline for size/preview based on type.
		pipe2 := rc.Pipeline()
		type previewCmd struct {
			kind string
			cmd  interface{}
		}
		prevCmds := make([]previewCmd, len(keys))

		for i, k := range keys {
			t := typeCmds[i].Val()
			infos[i].Type = t
			d := ttlCmds[i].Val()
			if d == -1*time.Second {
				infos[i].TTL = -1
			} else if d < 0 {
				infos[i].TTL = -2
			} else {
				infos[i].TTL = int64(d.Seconds())
			}

			switch t {
			case "string":
				prevCmds[i] = previewCmd{"string", pipe2.Get(ctx, k)}
			case "list":
				prevCmds[i] = previewCmd{"list", pipe2.LLen(ctx, k)}
			case "set":
				prevCmds[i] = previewCmd{"set", pipe2.SCard(ctx, k)}
			case "hash":
				prevCmds[i] = previewCmd{"hash", pipe2.HLen(ctx, k)}
			case "zset":
				prevCmds[i] = previewCmd{"zset", pipe2.ZCard(ctx, k)}
			case "stream":
				prevCmds[i] = previewCmd{"stream", pipe2.XLen(ctx, k)}
			default:
				prevCmds[i] = previewCmd{"none", nil}
			}
		}
		pipe2.Exec(ctx) //nolint:errcheck

		for i := range keys {
			pc := prevCmds[i]
			switch pc.kind {
			case "string":
				if v, ok := pc.cmd.(*redis.StringCmd); ok {
					val := v.Val()
					if len(val) > 120 {
						infos[i].Preview = val[:120] + "…"
					} else {
						infos[i].Preview = val
					}
					infos[i].Size = int64(len(val))
				}
			case "list", "set", "hash", "zset", "stream":
				if v, ok := pc.cmd.(*redis.IntCmd); ok {
					n := v.Val()
					infos[i].Size = n
					infos[i].Preview = fmt.Sprintf("%d item(s)", n)
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"keys":        infos,
		"next_cursor": nextCursor,
		"done":        nextCursor == 0,
	})
}

// ── Full key value ───────────────────────────────────────────────────────────

// handleRedisGetValue returns the full value + metadata for a single key.
// GET /api/v1/services/{serviceId}/redis/value?key=mykey
func (s *Server) handleRedisGetValue(w http.ResponseWriter, r *http.Request) {
	svc, err := s.resolveRedisService(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	key := r.URL.Query().Get("key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "key required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	rc := redisClientForService(svc)
	defer rc.Close()

	t, err := rc.Type(ctx, key).Result()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	ttlD, _ := rc.TTL(ctx, key).Result()
	ttl := int64(-1)
	if ttlD >= 0 {
		ttl = int64(ttlD.Seconds())
	}

	var value interface{}
	switch t {
	case "string":
		value, err = rc.Get(ctx, key).Result()
	case "list":
		value, err = rc.LRange(ctx, key, 0, 499).Result()
	case "set":
		value, err = rc.SMembers(ctx, key).Result()
	case "hash":
		value, err = rc.HGetAll(ctx, key).Result()
	case "zset":
		zs, e := rc.ZRangeWithScores(ctx, key, 0, 499).Result()
		if e == nil {
			type zMember struct {
				Member string  `json:"member"`
				Score  float64 `json:"score"`
			}
			items := make([]zMember, len(zs))
			for i, z := range zs {
				items[i] = zMember{Member: fmt.Sprintf("%v", z.Member), Score: z.Score}
			}
			value = items
		}
		err = e
	case "stream":
		msgs, e := rc.XRange(ctx, key, "-", "+").Result()
		if e == nil {
			type streamMsg struct {
				ID     string            `json:"id"`
				Values map[string]string `json:"values"`
			}
			items := make([]streamMsg, 0, len(msgs))
			for _, m := range msgs {
				vals := make(map[string]string, len(m.Values))
				for k, v := range m.Values {
					vals[k] = fmt.Sprintf("%v", v)
				}
				items = append(items, streamMsg{ID: m.ID, Values: vals})
			}
			value = items
		}
		err = e
	default:
		value = nil
	}
	if err != nil && err != redis.Nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"key":   key,
		"type":  t,
		"ttl":   ttl,
		"value": value,
	})
}

// ── Set / upsert a key ───────────────────────────────────────────────────────

// handleRedisSetValue sets or updates a key.
// PUT /api/v1/services/{serviceId}/redis/value?key=mykey
// Body: {"value": "...", "ttl": -1}   (string type only for now)
func (s *Server) handleRedisSetValue(w http.ResponseWriter, r *http.Request) {
	svc, err := s.resolveRedisService(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	key := r.URL.Query().Get("key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "key required")
		return
	}
	var body struct {
		Value string `json:"value"`
		TTL   int64  `json:"ttl"` // seconds, -1 = no expiry
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	rc := redisClientForService(svc)
	defer rc.Close()

	var exp time.Duration
	if body.TTL > 0 {
		exp = time.Duration(body.TTL) * time.Second
	}
	if err := rc.Set(ctx, key, body.Value, exp).Err(); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ── Delete a key ─────────────────────────────────────────────────────────────

// handleRedisDelValue deletes one key.
// DELETE /api/v1/services/{serviceId}/redis/value?key=mykey
func (s *Server) handleRedisDelValue(w http.ResponseWriter, r *http.Request) {
	svc, err := s.resolveRedisService(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	key := r.URL.Query().Get("key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "key required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	rc := redisClientForService(svc)
	defer rc.Close()
	rc.Del(ctx, key)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ── CLI exec ─────────────────────────────────────────────────────────────────

// handleRedisExec runs an arbitrary Redis command.
// POST /api/v1/services/{serviceId}/redis/exec
// Body: {"args": ["SET", "foo", "bar"]}
func (s *Server) handleRedisExec(w http.ResponseWriter, r *http.Request) {
	svc, err := s.resolveRedisService(r)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	var body struct {
		Args []string `json:"args"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Args) == 0 {
		writeError(w, http.StatusBadRequest, "args array required")
		return
	}

	// Block destructive/server-level commands.
	blocked := map[string]bool{
		"FLUSHALL": true, "FLUSHDB": true, "DEBUG": true,
		"CONFIG": true, "SLAVEOF": true, "REPLICAOF": true,
		"SHUTDOWN": true, "BGREWRITEAOF": true, "BGSAVE": true,
	}
	if blocked[strings.ToUpper(body.Args[0])] {
		writeError(w, http.StatusForbidden, "command not allowed")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	rc := redisClientForService(svc)
	defer rc.Close()

	// Convert []string → []interface{} for Do.
	iargs := make([]interface{}, len(body.Args)-1)
	for i, a := range body.Args[1:] {
		iargs[i] = a
	}

	start := time.Now()
	res, err := rc.Do(ctx, redisArgsToInterface(body.Args)...).Result()
	durationMs := time.Since(start).Milliseconds()

	if err != nil && err != redis.Nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"error":       err.Error(),
			"duration_ms": durationMs,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"result":      normalizeRedisResult(res),
		"duration_ms": durationMs,
	})
}

func redisArgsToInterface(args []string) []interface{} {
	out := make([]interface{}, len(args))
	for i, a := range args {
		out[i] = a
	}
	return out
}

func normalizeRedisResult(v interface{}) interface{} {
	if v == nil {
		return nil
	}
	switch x := v.(type) {
	case []byte:
		return string(x)
	case []interface{}:
		out := make([]interface{}, len(x))
		for i, item := range x {
			out[i] = normalizeRedisResult(item)
		}
		return out
	default:
		return x
	}
}
