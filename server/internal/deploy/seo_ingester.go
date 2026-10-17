package deploy

import (
	"bufio"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
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

// seoClassifierVersion bumps whenever classifyLine's rules change; the cached
// counts are then rebuilt from the retained logs on next start.
//
//	2: exclude Next.js RSC/prefetch fetches (≈97% of "human page views")
const seoClassifierVersion = 2

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

	s.backfill(ctx)
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
		Method  string              `json:"method"`
		URI     string              `json:"uri"`
		Headers map[string][]string `json:"headers"`
	} `json:"request"`
	Status int `json:"status"`
}

// backfill reads every rotated log still on disk (deployzy-access-*.log.gz)
// exactly once, so the corrected counts start from the oldest retained day
// instead of from the deploy that introduced them. All counts land in one
// write, followed by the backfilled flag; the live file is then read from 0 by
// the normal ingest pass (rotated files and the live file never overlap).
func (s *SEOIngester) backfill(ctx context.Context) {
	state, err := s.db.GetSEOIngestState(ctx)
	if err != nil {
		return
	}
	if state.Version != seoClassifierVersion {
		// The counting rules changed: the cached counts are stale. Rebuild.
		if err := s.db.ResetSEOCache(ctx, seoClassifierVersion); err != nil {
			s.log.Warn().Err(err).Msg("seo cache reset failed")
			return
		}
		s.log.Info().Int("version", seoClassifierVersion).Msg("seo classifier changed — rebuilding counts from logs")
		state = db.SEOIngestState{Version: seoClassifierVersion}
	}
	if state.Backfilled {
		return
	}
	files, _ := filepath.Glob(strings.TrimSuffix(s.logPath, ".log") + "-*.log.gz")
	sort.Strings(files) // names embed the rotation timestamp
	counts := map[db.SEOCountKey]int64{}
	lines := 0
	for _, f := range files {
		fh, err := os.Open(f)
		if err != nil {
			continue
		}
		zr, err := gzip.NewReader(fh)
		if err != nil {
			fh.Close()
			continue
		}
		sc := bufio.NewScanner(zr)
		sc.Buffer(make([]byte, 64<<10), 4<<20)
		for sc.Scan() {
			s.classifyLine(sc.Bytes(), counts)
			lines++
		}
		zr.Close()
		fh.Close()
	}
	since := ""
	for k := range counts {
		if since == "" || k.Day < since {
			since = k.Day
		}
	}
	if err := s.db.AddSEOCounts(ctx, counts); err != nil {
		s.log.Warn().Err(err).Msg("seo backfill write failed")
		return
	}
	state.Backfilled, state.SinceDay, state.Offset, state.Inode, state.Version = true, since, 0, 0, seoClassifierVersion
	if err := s.db.SetSEOIngestState(ctx, state); err != nil {
		s.log.Warn().Err(err).Msg("seo backfill state save failed")
		return
	}
	s.log.Info().Int("files", len(files)).Int("lines", lines).Str("since", since).Msg("seo backfill done")
}

func (s *SEOIngester) ingest(ctx context.Context) {
	fi, err := os.Stat(s.logPath)
	if err != nil {
		// Log not present yet (access logging not enabled, or no traffic) — quiet.
		return
	}
	inode := statInode(fi) // platform-specific (Unix inode; 0 on Windows)
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

// seoDiscoveryFiles are the files crawlers fetch to learn about a site. A
// crawler fetching them counts as a crawl; humans never count for them.
func isDiscoveryFile(p string) bool {
	switch p {
	case "/robots.txt", "/llms.txt", "/llms-full.txt", "/sitemap.xml":
		return true
	}
	return strings.HasPrefix(p, "/sitemap") && strings.HasSuffix(p, ".xml")
}

// isPagePath reports whether a path is a page (not an asset, API call, or
// auth round-trip). Pages have no file extension, or .html.
func isPagePath(p string) bool {
	for _, pre := range []string{"/_next/", "/api/", "/auth/", "/static/", "/.well-known/"} {
		if strings.HasPrefix(p, pre) {
			return false
		}
	}
	last := p[strings.LastIndexByte(p, '/')+1:]
	if !strings.Contains(last, ".") {
		return true
	}
	return strings.HasSuffix(last, ".html") || strings.HasSuffix(last, ".htm")
}

// classifyLine buckets one access-log line:
//   - 4xx/5xx from anything but a named crawler → probe/scanner (vulnerability
//     scanners hammer /wp-admin, /.git/config, ... and often spoof a Google
//     referrer, which used to inflate "search referrals")
//   - generic clients (curl, python-requests, ...) → probe/script
//   - named crawler fetching a page or discovery file → crawler/<category>
//   - human GET of a page → human/pageview, plus referral/<channel> when the
//     referrer is a known external source (matched on domain boundaries)
//
// Redirects and assets don't count: one visit is one page view, not the 30
// chunk/image requests that render it.
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
	path := l.Request.URI
	if i := strings.IndexAny(path, "?#"); i >= 0 {
		path = path[:i]
	}
	if path == "" {
		path = "/"
	}
	add := func(kind, channel, name string) {
		counts[db.SEOCountKey{Day: day, Kind: kind, Channel: channel, Name: name}]++
	}

	botName := analytics.ClassifyBot(ua)
	category := ""
	if botName != "" {
		category = analytics.BotCategory(botName)
	}
	generic := botName != "" && category == "other"

	if l.Status >= 400 {
		if botName != "" && !generic {
			return // a real crawler following a stale link — not a probe
		}
		name := botName
		if name == "" {
			name = "Browser-like"
		}
		add("probe", "scanner", name)
		return
	}
	if !(l.Status >= 200 && l.Status < 300) && l.Status != 304 {
		return // redirects and anything odd
	}
	if generic {
		add("probe", "script", botName)
		return
	}
	page, discovery := isPagePath(path), isDiscoveryFile(path)
	if botName != "" {
		if page || discovery {
			add("crawler", category, botName)
		}
		return
	}
	if _, _, _, isBot := analytics.ParseUA(ua); isBot {
		if page || discovery {
			add("crawler", "other", "Other bot")
		}
		return
	}
	if !page || (l.Request.Method != "" && l.Request.Method != "GET" && l.Request.Method != "HEAD") {
		return
	}
	// Next.js client navigations and link prefetches fetch the same page path
	// as an RSC payload. They're not page loads (and aren't new visits).
	if header(l.Request.Headers, "RSC") != "" || header(l.Request.Headers, "Next-Router-Prefetch") != "" ||
		strings.Contains(l.Request.URI, "_rsc=") {
		return
	}
	add("human", "pageview", "pageviews")
	refHost := analytics.RefererHost(header(l.Request.Headers, "Referer"))
	if refHost == "" || refHost == "deployzy.com" || strings.HasSuffix(refHost, ".deployzy.com") {
		return
	}
	if source, channel := analytics.ClassifyReferrer(refHost); source != "" {
		add("referral", channel, source)
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
