package deploy

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/server/internal/analytics"
	"github.com/serverme/serverme/server/internal/db"
)

// SEOIngester incrementally parses the Caddy access log for deployzy.com and
// records, per day, which crawlers fetched us (GPTBot/Googlebot/…) and which
// external sources sent us human traffic (ChatGPT/Google/…). It stores only
// aggregate counts — no per-request rows, no IPs.
//
// It reads from a byte offset persisted in seo_ingest_state so restarts don't
// re-count, and detects log rotation via inode + size so a rotated file resets
// the cursor instead of being skipped.
type SEOIngester struct {
	db      *db.DB
	log     zerolog.Logger
	logPath string
}

const seoLogPath = "/var/log/caddy/deployzy-access.log"

// maxBytesPerPass bounds one ingest pass so a huge first read can't blow up
// memory — the rest is picked up next tick.
const maxBytesPerPass = 16 << 20 // 16 MiB

func NewSEOIngester(database *db.DB, log zerolog.Logger) *SEOIngester {
	return &SEOIngester{
		db:      database,
		log:     log.With().Str("component", "seo_ingester").Logger(),
		logPath: seoLogPath,
	}
}

func (s *SEOIngester) Start(ctx context.Context) {
	s.log.Info().Str("log", s.logPath).Msg("seo ingester started")
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()

	s.ingest(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.ingest(ctx)
		}
	}
}

// caddyLogLine is the minimal subset of Caddy's JSON access-log format we need.
type caddyLogLine struct {
	TS      float64 `json:"ts"`
	Request struct {
		Host    string              `json:"host"`
		Headers map[string][]string `json:"headers"`
	} `json:"request"`
	Status int `json:"status"`
}

func (s *SEOIngester) ingest(ctx context.Context) {
	fi, err := os.Stat(s.logPath)
	if err != nil {
		// Log not present yet (access logging not enabled, or no traffic) — quiet.
		return
	}
	inode := int64(0)
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		inode = int64(st.Ino)
	}
	size := fi.Size()

	state, err := s.db.GetSEOIngestState(ctx)
	if err != nil {
		s.log.Warn().Err(err).Msg("read ingest state failed")
		return
	}
	// Rotation / truncation: new file (inode changed) or shrunk below our cursor.
	if inode != state.Inode || size < state.Offset {
		state.Offset = 0
	}
	if size == state.Offset {
		return // nothing new
	}

	f, err := os.Open(s.logPath)
	if err != nil {
		s.log.Warn().Err(err).Msg("open access log failed")
		return
	}
	defer f.Close()
	if _, err := f.Seek(state.Offset, io.SeekStart); err != nil {
		return
	}

	counts := map[db.SEOCountKey]int64{}
	reader := bufio.NewReader(io.LimitReader(f, maxBytesPerPass))
	var consumed int64
	for {
		line, err := reader.ReadBytes('\n')
		consumed += int64(len(line))
		if len(line) > 0 && (err == nil || (err == io.EOF && line[len(line)-1] == '\n')) {
			s.classifyLine(line, counts)
		}
		if err != nil {
			// On EOF without a trailing newline the last (partial) line is left
			// for the next pass by not advancing the offset past it.
			if err == io.EOF && len(line) > 0 && line[len(line)-1] != '\n' {
				consumed -= int64(len(line))
			}
			break
		}
	}

	if err := s.db.AddSEOCounts(ctx, counts); err != nil {
		s.log.Warn().Err(err).Msg("write seo counts failed")
		return
	}
	state.Offset += consumed
	state.Inode = inode
	if err := s.db.SetSEOIngestState(ctx, state); err != nil {
		s.log.Warn().Err(err).Msg("save ingest state failed")
	}
	if len(counts) > 0 {
		s.log.Debug().Int("buckets", len(counts)).Msg("seo ingest pass")
	}
}

func (s *SEOIngester) classifyLine(line []byte, counts map[db.SEOCountKey]int64) {
	var l caddyLogLine
	if err := json.Unmarshal(line, &l); err != nil {
		return
	}
	host := strings.ToLower(strings.TrimPrefix(l.Request.Host, "www."))
	if i := strings.IndexByte(host, ':'); i >= 0 {
		host = host[:i]
	}
	if host != "deployzy.com" {
		return // defensive — the log should only carry our root site
	}

	ua := header(l.Request.Headers, "User-Agent")
	day := time.Now().UTC().Format("2006-01-02")
	if l.TS > 0 {
		day = time.Unix(int64(l.TS), 0).UTC().Format("2006-01-02")
	}

	// A recognised crawler is definitive.
	if botName := analytics.ClassifyBot(ua); botName != "" {
		counts[db.SEOCountKey{Day: day, Kind: "crawler", Channel: analytics.BotCategory(botName), Name: botName}]++
		return
	}

	// Otherwise a human — attribute the referral source if we know it.
	refHost := analytics.RefererHost(header(l.Request.Headers, "Referer"))
	if source, channel := analytics.ClassifyReferrer(refHost); source != "" {
		counts[db.SEOCountKey{Day: day, Kind: "referral", Channel: channel, Name: source}]++
	}
}

// header does a case-insensitive lookup — Caddy preserves the sent casing, which
// is usually canonical but we don't want to depend on it.
func header(h map[string][]string, key string) string {
	if v, ok := h[key]; ok && len(v) > 0 {
		return v[0]
	}
	lk := strings.ToLower(key)
	for k, v := range h {
		if strings.ToLower(k) == lk && len(v) > 0 {
			return v[0]
		}
	}
	return ""
}
