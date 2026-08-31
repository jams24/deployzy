package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/db"
	"github.com/serverme/serverme/server/internal/deploy"
)

// ── Email verification (MVP: no SMTP probe) ──────────────────────────────────
// Reputation-safe validation layers that run entirely on DNS + local lists:
// syntax, domain MX/A, disposable, role-based, free-provider, and typo
// suggestion. SMTP mailbox probing is deliberately NOT here — it needs an
// isolated probe IP and abuse gating (Phase 2). Metered by the credit system.

const emailVerifyCost = 0.05 // credits per verification (1 credit = $0.01)
const emailVerifyBatchMax = 100

// RFC-5321-ish local + domain syntax. Intentionally permissive on the local part
// (quoted forms exist) but strict enough to reject the common garbage.
var emailSyntaxRe = regexp.MustCompile(`^[a-zA-Z0-9.!#$%&'*+/=?^_` + "`" + `{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$`)

// Role/departmental local-parts — real inboxes but not individuals; marked risky
// for cold-outreach/list-cleaning use cases.
var roleLocalParts = map[string]bool{
	"admin": true, "administrator": true, "info": true, "support": true, "sales": true,
	"contact": true, "help": true, "billing": true, "office": true, "team": true,
	"marketing": true, "hello": true, "noreply": true, "no-reply": true, "postmaster": true,
	"webmaster": true, "abuse": true, "hostmaster": true, "root": true, "security": true,
	"careers": true, "jobs": true, "hr": true, "accounts": true, "enquiries": true, "mail": true,
}

// Common free consumer mail providers.
var freeProviders = map[string]bool{
	"gmail.com": true, "yahoo.com": true, "hotmail.com": true, "outlook.com": true,
	"live.com": true, "aol.com": true, "icloud.com": true, "me.com": true, "mac.com": true,
	"protonmail.com": true, "proton.me": true, "gmx.com": true, "yandex.com": true,
	"mail.com": true, "zoho.com": true, "hotmail.co.uk": true, "yahoo.co.uk": true,
}

// Popular domains used for typo suggestions (gmial.com → gmail.com).
var popularDomains = []string{
	"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com",
	"proton.me", "protonmail.com", "live.com", "gmx.com", "yandex.com", "zoho.com",
	"hotmail.co.uk", "yahoo.co.uk", "googlemail.com",
}

// EmailVerifyResult is the verdict for one address.
type EmailVerifyResult struct {
	Email        string `json:"email"`
	Normalized   string `json:"normalized"`
	Domain       string `json:"domain"`
	Score        string `json:"score"`  // valid | risky | invalid
	Reason       string `json:"reason"` // machine-readable
	Syntax       bool   `json:"syntax_valid"`
	HasMX        bool   `json:"has_mx"`
	Disposable   bool   `json:"disposable"`
	RoleBased    bool   `json:"role_based"`
	FreeProvider bool   `json:"free_provider"`
	Suggestion   string `json:"suggestion,omitempty"` // "did you mean" domain
	MailboxCheck bool   `json:"mailbox_checked"`      // true when an SMTP probe ran
	CatchAll     bool   `json:"catch_all"`            // domain accepts every address (probe inconclusive)
}

// ── SMTP mailbox probe (Phase 2) ─────────────────────────────────────────────
// Connects to the domain's MX and asks (RCPT TO) whether the exact mailbox
// exists, WITHOUT sending anything. Gated by the `email_smtp_probe` setting —
// probing affects the source IP's reputation, so it's opt-in and should run from
// an isolated IP for volume. Catch-all domains (accept everything) are detected
// and reported as inconclusive rather than a false "valid".

type smtpProbe struct {
	checked      bool // MAIL FROM accepted, so we could ask about the mailbox
	exists       bool // RCPT TO for the target returned 2xx
	catchAll     bool // a random address at the domain was ALSO accepted
	inconclusive bool // greylist (4xx), timeout, block, or connection failure
	code         int
}

func (s *Server) smtpProbeEnabled(ctx context.Context) bool {
	v, _ := s.db.GetSetting(ctx, "email_smtp_probe")
	return v == "true" || v == "1" || v == "on"
}

// secondaryProbeServer returns the platform worker server to run SMTP probes
// FROM — deliberately NOT the primary/local box, so probing never touches the
// main platform IP's reputation. Returns nil when no secondary is available.
func (s *Server) secondaryProbeServer(ctx context.Context) *db.WorkerServer {
	servers, err := s.db.ListWorkerServers(ctx, nil) // ordered local-first
	if err != nil {
		return nil
	}
	for i := range servers {
		sv := servers[i]
		if sv.UserID != nil { // platform only — never a user's BYOC box
			continue
		}
		if sv.IsLocal || sv.Host == "localhost" || sv.Host == "127.0.0.1" || sv.Host == "" {
			continue // skip the primary/local host
		}
		if !sv.DockerInstalled {
			continue // use a provisioned, reachable server
		}
		if full, err := s.db.GetWorkerServer(ctx, sv.ID); err == nil && full != nil {
			return full // carries SSH creds
		}
	}
	return nil
}

// probeMailbox resolves the MX locally (DNS only — reputation-neutral), then runs
// the actual SMTP RCPT conversation ON THE SECONDARY server via SSH, so the probe
// originates from the secondary IP. Returns inconclusive if no secondary is
// available (we never fall back to probing from the primary).
func (s *Server) probeMailbox(ctx context.Context, domain, target string) smtpProbe {
	var p smtpProbe
	cfg, _ := s.db.GetSettings(ctx, "email_probe_helo", "email_probe_from")
	helo := cfg["email_probe_helo"]
	if helo == "" {
		helo = "verify.deployzy.com"
	}
	from := cfg["email_probe_from"]
	if from == "" {
		from = "verify@deployzy.com"
	}

	mxs, err := net.DefaultResolver.LookupMX(ctx, domain)
	if err != nil || len(mxs) == 0 {
		p.inconclusive = true
		return p
	}
	sort.Slice(mxs, func(i, j int) bool { return mxs[i].Pref < mxs[j].Pref })
	mxHost := strings.TrimSuffix(mxs[0].Host, ".")

	srv := s.secondaryProbeServer(ctx)
	if srv == nil {
		p.inconclusive = true // no secondary → don't probe from primary
		return p
	}
	// Throttle probes per mail domain so a batch can't hammer one MX and get the
	// secondary IP blocked.
	probeThrottle.wait(ctx, domain)
	runner := deploy.NewRemoteRunner(srv)

	pctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	out, err := runner.RunShell(pctx, buildProbeCmd(mxHost, domain, target, helo, from))
	if err != nil {
		p.inconclusive = true
		return p
	}
	// Parse the JSON the probe script printed (last line).
	var res struct {
		Checked      bool `json:"checked"`
		Exists       bool `json:"exists"`
		CatchAll     bool `json:"catchall"`
		Inconclusive bool `json:"inconclusive"`
		Code         int  `json:"code"`
	}
	line := lastJSONLine(string(out))
	if line == "" || json.Unmarshal([]byte(line), &res) != nil {
		p.inconclusive = true
		return p
	}
	p.checked = res.Checked
	p.exists = res.Exists
	p.catchAll = res.CatchAll
	p.inconclusive = res.Inconclusive || !res.Checked
	p.code = res.Code
	return p
}

// buildProbeCmd renders a self-contained, injection-safe (base64) python3 SMTP
// probe to run on the secondary host. All variable values are base64-embedded so
// an address with quotes can't break out of the script.
func buildProbeCmd(mxHost, domain, target, helo, from string) string {
	b := func(v string) string { return base64.StdEncoding.EncodeToString([]byte(v)) }
	script := `import smtplib,base64,json,random
def d(x): return base64.b64decode(x).decode()
mx=d("` + b(mxHost) + `");target=d("` + b(target) + `");frm=d("` + b(from) + `");helo=d("` + b(helo) + `");dom=d("` + b(domain) + `")
out={"checked":False,"exists":False,"catchall":False,"inconclusive":False,"code":0}
try:
    s=smtplib.SMTP(timeout=15)
    s.connect(mx,25)
    s.helo(helo)
    s.mail(frm)
    out["checked"]=True
    c,_=s.rcpt(target)
    out["code"]=c
    if 200<=c<300:
        out["exists"]=True
        rc,_=s.rcpt("nouser%d@%s"%(random.randint(0,999999),dom))
        if 200<=rc<300:
            out["catchall"]=True
    elif 400<=c<500:
        out["inconclusive"]=True
    try:
        s.quit()
    except Exception:
        pass
except Exception:
    out["inconclusive"]=True
print(json.dumps(out))`
	return "echo " + base64.StdEncoding.EncodeToString([]byte(script)) + " | base64 -d | python3 -"
}

// lastJSONLine returns the last line of out that looks like a JSON object.
func lastJSONLine(out string) string {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		l := strings.TrimSpace(lines[i])
		if strings.HasPrefix(l, "{") && strings.HasSuffix(l, "}") {
			return l
		}
	}
	return ""
}

// deepVerify runs the domain-level checks, then (if SMTP probing is enabled and
// the address passed the cheap checks) confirms the actual mailbox.
func (s *Server) deepVerify(ctx context.Context, email string) EmailVerifyResult {
	r := verifyEmail(ctx, email)
	if r.Score == "invalid" || r.Disposable || !s.smtpProbeEnabled(ctx) {
		return r // don't probe garbage/disposable, or when probing is off
	}
	p := s.probeMailbox(ctx, r.Domain, r.Email)
	r.MailboxCheck = p.checked
	switch {
	case !p.checked || p.inconclusive:
		// Couldn't get a definitive answer — greylisting, block, or timeout.
		r.Score, r.Reason = "unknown", "smtp_inconclusive"
	case p.catchAll:
		r.CatchAll = true
		r.Score, r.Reason = "risky", "catch_all"
	case p.exists && r.RoleBased:
		r.Score, r.Reason = "risky", "role_account"
	case p.exists:
		r.Score, r.Reason = "valid", "mailbox_exists"
	default:
		r.Score, r.Reason = "invalid", "mailbox_not_found"
	}
	return r
}

// normalizeEmail lowercases the domain and applies Gmail's dot/plus rules so
// "John.Doe+tag@gmail.com" and "johndoe@gmail.com" collapse to the same address.
func normalizeEmail(email string) string {
	email = strings.TrimSpace(email)
	at := strings.LastIndex(email, "@")
	if at < 1 {
		return strings.ToLower(email)
	}
	local, domain := email[:at], strings.ToLower(email[at+1:])
	if domain == "gmail.com" || domain == "googlemail.com" {
		if plus := strings.IndexByte(local, '+'); plus >= 0 {
			local = local[:plus]
		}
		local = strings.ReplaceAll(local, ".", "")
		domain = "gmail.com"
	} else {
		if plus := strings.IndexByte(local, '+'); plus >= 0 {
			local = local[:plus]
		}
	}
	return strings.ToLower(local) + "@" + domain
}

// levenshtein is a small edit-distance for typo suggestions.
func levenshtein(a, b string) int {
	la, lb := len(a), len(b)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}
	prev := make([]int, lb+1)
	for j := 0; j <= lb; j++ {
		prev[j] = j
	}
	for i := 1; i <= la; i++ {
		cur := make([]int, lb+1)
		cur[0] = i
		for j := 1; j <= lb; j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = min3(cur[j-1]+1, prev[j]+1, prev[j-1]+cost)
		}
		prev = cur
	}
	return prev[lb]
}

func min3(a, b, c int) int {
	if b < a {
		a = b
	}
	if c < a {
		a = c
	}
	return a
}

// suggestDomain returns a close popular domain when the given one looks like a
// typo of it (edit distance 1–2), else "".
func suggestDomain(domain string) string {
	if popularDomainSet(domain) {
		return ""
	}
	best, bestDist := "", 3
	for _, p := range popularDomains {
		d := levenshtein(domain, p)
		if d > 0 && d < bestDist {
			best, bestDist = p, d
		}
	}
	return best
}

func popularDomainSet(d string) bool {
	for _, p := range popularDomains {
		if p == d {
			return true
		}
	}
	return false
}

// verifyEmail runs all reputation-safe checks (no SMTP).
func verifyEmail(ctx context.Context, email string) EmailVerifyResult {
	email = strings.TrimSpace(email)
	res := EmailVerifyResult{Email: email}

	if !emailSyntaxRe.MatchString(email) {
		res.Score, res.Reason = "invalid", "invalid_syntax"
		return res
	}
	res.Syntax = true
	res.Normalized = normalizeEmail(email)
	res.Domain = emailDomain(email)

	local := strings.ToLower(email[:strings.LastIndex(email, "@")])
	res.RoleBased = roleLocalParts[local]
	res.FreeProvider = freeProviders[res.Domain]

	// Disposable (exact or any parent domain), reusing the signup blocklist.
	labels := strings.Split(res.Domain, ".")
	for i := range labels {
		if disposableDomains[strings.Join(labels[i:], ".")] {
			res.Disposable = true
			break
		}
	}

	// Typo suggestion.
	res.Suggestion = suggestDomain(res.Domain)

	// Domain must be able to receive mail (MX, or A/AAAA implicit MX).
	lookupCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	var r net.Resolver
	if mx, err := r.LookupMX(lookupCtx, res.Domain); err == nil && len(mx) > 0 {
		res.HasMX = true
	} else if addrs, err := r.LookupHost(lookupCtx, res.Domain); err == nil && len(addrs) > 0 {
		res.HasMX = true // implicit MX
	}

	// Verdict (no mailbox probe in MVP).
	switch {
	case !res.HasMX:
		res.Score, res.Reason = "invalid", "no_mail_server"
	case res.Disposable:
		res.Score, res.Reason = "risky", "disposable"
	case res.RoleBased:
		res.Score, res.Reason = "risky", "role_account"
	default:
		res.Score, res.Reason = "valid", "ok"
	}
	return res
}

// POST /api/v1/email/verify — verify a single address. Body: {email}.
func (s *Server) handleEmailVerify(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	if !s.checkAIRate(w, r, u.ID) { // reuse the AI rate limiter
		return
	}
	var body struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(r, &body); err != nil || strings.TrimSpace(body.Email) == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	if s.overDailyCap(r.Context(), u.ID, 1) {
		writeError(w, http.StatusTooManyRequests, "daily email-verification limit reached — try again tomorrow or contact support to raise it")
		return
	}
	if err := billing.ChargeAICredits(r.Context(), s.db, u, emailVerifyCost, "email_verify"); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.deepVerify(r.Context(), body.Email))
}

// POST /api/v1/email/verify/batch — verify up to 100 addresses. Body: {emails:[]}.
func (s *Server) handleEmailVerifyBatch(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	if !s.checkAIRate(w, r, u.ID) {
		return
	}
	var body struct {
		Emails []string `json:"emails"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.Emails) == 0 {
		writeError(w, http.StatusBadRequest, "emails[] is required")
		return
	}
	if len(body.Emails) > emailVerifyBatchMax {
		writeError(w, http.StatusBadRequest, "too many emails — max 100 per batch")
		return
	}
	if s.overDailyCap(r.Context(), u.ID, len(body.Emails)) {
		writeError(w, http.StatusTooManyRequests, "daily email-verification limit reached — try again tomorrow or contact support to raise it")
		return
	}
	// Charge for the whole batch up front (only unique, non-empty addresses).
	if err := billing.ChargeAICredits(r.Context(), s.db, u, emailVerifyCost*float64(len(body.Emails)), "email_verify_batch"); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}
	// Verify in parallel (bounded) — the per-domain throttle still serializes
	// same-domain probes, so concurrency only speeds up DIFFERENT domains.
	emails := make([]string, 0, len(body.Emails))
	for _, e := range body.Emails {
		if strings.TrimSpace(e) != "" {
			emails = append(emails, e)
		}
	}
	results := make([]EmailVerifyResult, len(emails))
	sem := make(chan struct{}, 12)
	var wg sync.WaitGroup
	for i := range emails {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			results[i] = s.deepVerify(r.Context(), emails[i])
		}(i)
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, map[string]any{"count": len(results), "results": results})
}
