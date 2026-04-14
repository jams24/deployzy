// Package analytics captures per-request events for deployed projects.
// Cookieless, privacy-first: visitor identity is a daily-rotating salted hash
// of IP+UA, so a visitor can't be correlated across days and no personal data
// is stored.
package analytics

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/phuslu/iploc"
	"github.com/rs/zerolog"
)

// LookupCountry returns the 2-letter ISO country code for an IP, or "" on
// failure. Pure-Go, embedded data — no DB file, no MaxMind account.
// Exposed so the proxy can use it too (not just the collector's flush loop).
func LookupCountry(ip string) string {
	if ip == "" {
		return ""
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ""
	}
	c := iploc.Country(parsed)
	return strings.ToUpper(string(c))
}

// Event is a single captured request.
type Event struct {
	ProjectID   string
	TS          time.Time
	Path        string
	Method      string
	Status      int
	Bytes       int64
	RefererHost string
	Country     string // if non-empty (e.g. from CF-IPCountry), skip GeoIP lookup
	IP          string // used for GeoIP in the flush loop; never persisted
	Device      string
	Browser     string
	OS          string
	VisitorHash string
	IsBot       bool
}

// Collector buffers events in a channel and flushes them to Postgres in batches.
// A bounded channel ensures a flood of traffic can't swamp memory — excess
// events get dropped (logged at debug).
type Collector struct {
	pool *pgxpool.Pool
	log  zerolog.Logger
	ch   chan Event

	saltMu    sync.RWMutex
	dailySalt []byte
	saltDay   string

	batchSize  int
	flushEvery time.Duration
}

func New(pool *pgxpool.Pool, log zerolog.Logger) *Collector {
	c := &Collector{
		pool:       pool,
		log:        log.With().Str("component", "analytics").Logger(),
		ch:         make(chan Event, 4096),
		batchSize:  500,
		flushEvery: 5 * time.Second,
	}
	c.rotateSalt()
	return c
}

// Start runs the flush loop. Call as a goroutine.
func (c *Collector) Start(ctx context.Context) {
	c.log.Info().Msg("analytics collector started")
	flushT := time.NewTicker(c.flushEvery)
	defer flushT.Stop()
	// Rotate the visitor-salt at next midnight and every 24h after.
	rotateT := time.NewTimer(timeUntilNextMidnight())
	defer rotateT.Stop()

	buf := make([]Event, 0, c.batchSize)
	flush := func() {
		if len(buf) == 0 {
			return
		}
		if err := c.insertBatch(ctx, buf); err != nil {
			c.log.Warn().Err(err).Int("n", len(buf)).Msg("analytics batch insert failed")
		}
		buf = buf[:0]
	}

	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case <-rotateT.C:
			c.rotateSalt()
			rotateT.Reset(24 * time.Hour)
		case <-flushT.C:
			flush()
		case ev := <-c.ch:
			buf = append(buf, ev)
			if len(buf) >= c.batchSize {
				flush()
			}
		}
	}
}

// Collect enqueues an event. Non-blocking — drops silently if the buffer is full.
func (c *Collector) Collect(ev Event) {
	if c == nil {
		return
	}
	select {
	case c.ch <- ev:
	default:
		// Buffer full — drop. At very high QPS we'd rather lose analytics than
		// stall the proxy.
	}
}

// HashVisitor returns a daily-rotating visitor identifier. Same ip+ua yields
// the same hash within a day but is unlinkable to the next day's hash.
func (c *Collector) HashVisitor(ip, ua string) string {
	c.saltMu.RLock()
	salt := c.dailySalt
	c.saltMu.RUnlock()
	h := sha256.New()
	h.Write(salt)
	h.Write([]byte(ip))
	h.Write([]byte("\x00"))
	h.Write([]byte(canonicalUA(ua)))
	return hex.EncodeToString(h.Sum(nil)[:16])
}

func (c *Collector) rotateSalt() {
	salt := make([]byte, 32)
	_, _ = rand.Read(salt)
	c.saltMu.Lock()
	c.dailySalt = salt
	c.saltDay = time.Now().UTC().Format("2006-01-02")
	c.saltMu.Unlock()
}

func (c *Collector) insertBatch(ctx context.Context, events []Event) error {
	// Use a single multi-value INSERT. Avoids per-row round-trips.
	const cols = "(project_id, ts, path, method, status, bytes, referrer, country, device, browser, os, visitor_hash, is_bot)"
	var sb strings.Builder
	sb.WriteString("INSERT INTO site_events ")
	sb.WriteString(cols)
	sb.WriteString(" VALUES ")
	args := make([]any, 0, len(events)*13)
	for i, e := range events {
		if i > 0 {
			sb.WriteByte(',')
		}
		// GeoIP lookup: only if not already set by a trusted header.
		country := e.Country
		if country == "" {
			country = LookupCountry(e.IP)
		}
		base := i * 13
		sb.WriteString(fmt.Sprintf("($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d)",
			base+1, base+2, base+3, base+4, base+5, base+6, base+7, base+8, base+9, base+10, base+11, base+12, base+13))
		args = append(args,
			e.ProjectID, e.TS, e.Path, e.Method, e.Status, e.Bytes,
			e.RefererHost, country, e.Device, e.Browser, e.OS,
			e.VisitorHash, e.IsBot,
		)
	}
	_, err := c.pool.Exec(ctx, sb.String(), args...)
	return err
}

// ── User-agent parsing ────────────────────────────────────────────────────

var botRE = regexp.MustCompile(`(?i)\bbot\b|crawl|spider|slurp|pingdom|uptimerobot|headless|monitor|python-requests|curl/|wget/|facebookexternalhit|whatsapp|telegrambot`)

// ParseUA returns (device, browser, os, isBot).
func ParseUA(ua string) (string, string, string, bool) {
	if ua == "" {
		return "other", "other", "other", false
	}
	isBot := botRE.MatchString(ua)

	device := "desktop"
	uaLow := strings.ToLower(ua)
	if strings.Contains(uaLow, "tablet") || strings.Contains(uaLow, "ipad") {
		device = "tablet"
	} else if strings.Contains(uaLow, "mobi") || strings.Contains(uaLow, "iphone") || strings.Contains(uaLow, "android") {
		device = "mobile"
	}
	if isBot {
		device = "bot"
	}

	browser := "other"
	switch {
	case strings.Contains(uaLow, "edg/"):
		browser = "edge"
	case strings.Contains(uaLow, "chrome/") && !strings.Contains(uaLow, "chromium"):
		browser = "chrome"
	case strings.Contains(uaLow, "firefox/"):
		browser = "firefox"
	case strings.Contains(uaLow, "safari/") && !strings.Contains(uaLow, "chrome"):
		browser = "safari"
	case strings.Contains(uaLow, "opera") || strings.Contains(uaLow, "opr/"):
		browser = "opera"
	}

	os := "other"
	switch {
	case strings.Contains(uaLow, "windows"):
		os = "windows"
	case strings.Contains(uaLow, "mac os") || strings.Contains(uaLow, "macos"):
		os = "macos"
	case strings.Contains(uaLow, "android"):
		os = "android"
	case strings.Contains(uaLow, "iphone") || strings.Contains(uaLow, "ipad") || strings.Contains(uaLow, "ios"):
		os = "ios"
	case strings.Contains(uaLow, "linux"):
		os = "linux"
	}

	return device, browser, os, isBot
}

// canonicalUA strips version numbers so slight UA changes (e.g. Chrome minor
// bumps) don't fragment the visitor count for the same person on the same day.
func canonicalUA(ua string) string {
	// Collapse all digits to make versions match.
	out := make([]byte, 0, len(ua))
	prev := byte(0)
	for i := 0; i < len(ua); i++ {
		c := ua[i]
		if c >= '0' && c <= '9' {
			c = '#'
		}
		if c == '#' && prev == '#' {
			continue
		}
		out = append(out, c)
		prev = c
	}
	return string(out)
}

// RefererHost strips a Referer header to just its hostname.
func RefererHost(ref string) string {
	if ref == "" {
		return ""
	}
	// Cheap parse — avoid net/url for every request.
	ref = strings.TrimSpace(ref)
	if i := strings.Index(ref, "://"); i >= 0 {
		ref = ref[i+3:]
	}
	if i := strings.IndexAny(ref, "/?#"); i >= 0 {
		ref = ref[:i]
	}
	ref = strings.TrimPrefix(ref, "www.")
	if len(ref) > 120 {
		ref = ref[:120]
	}
	return ref
}

func timeUntilNextMidnight() time.Duration {
	now := time.Now().UTC()
	next := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
	return next.Sub(now)
}
