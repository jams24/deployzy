package api

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
	db "github.com/serverme/serverme/server/internal/db"
)

// Custom-domain helpers: clean up what people type, tell them exactly which
// DNS records to create, and check (in the background too) whether those
// records point at us.

// cnameTarget is a DNS-only (grey-cloud) A record pointing to the primary.
// Using deployzy.com directly breaks custom domains because deployzy.com is
// Cloudflare-proxied: Cloudflare can't terminate TLS for a domain it doesn't own.
const cnameTarget = "cname.deployzy.com"

var platformDomains = []string{"deployzy.com", "deployzy.app", "serverme.site"}

var hostnameLabel = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

var errInvalidDomain = errors.New("enter a domain name like app.example.com")

// normalizeDomain turns "HTTPS://WWW.Example.com:443/path" into "example.com".
// A leading "www." is dropped (with a note) because the proxy redirects every
// www.<domain> to <domain>; registering the www name itself would loop.
func normalizeDomain(raw string) (domain, note string, err error) {
	d := strings.ToLower(strings.TrimSpace(raw))
	if i := strings.Index(d, "://"); i >= 0 {
		d = d[i+3:]
	}
	if i := strings.IndexAny(d, "/?#"); i >= 0 {
		d = d[:i]
	}
	if i := strings.LastIndex(d, "@"); i >= 0 {
		d = d[i+1:]
	}
	if h, _, splitErr := net.SplitHostPort(d); splitErr == nil {
		d = h
	}
	d = strings.Trim(d, ".")
	if strings.HasPrefix(d, "www.") && strings.Count(d, ".") >= 2 {
		d = strings.TrimPrefix(d, "www.")
		note = "www." + d + " redirects to " + d + " automatically, so we added " + d + "."
	}
	if len(d) == 0 || len(d) > 253 || !strings.Contains(d, ".") || net.ParseIP(d) != nil {
		return "", "", errInvalidDomain
	}
	for _, label := range strings.Split(d, ".") {
		if !hostnameLabel.MatchString(label) {
			return "", "", errInvalidDomain
		}
	}
	for _, p := range platformDomains {
		if d == p || strings.HasSuffix(d, "."+p) {
			return "", "", errors.New(p + " addresses are provided by Deployzy already; add a domain you own")
		}
	}
	return d, note, nil
}

// dnsRecord is one record the user has to create at their DNS provider.
// Host is relative to their zone ("@" for the zone apex), which is what DNS
// provider forms ask for.
type dnsRecord struct {
	Type     string `json:"type"`
	Host     string `json:"host"`
	Value    string `json:"value"`
	Required bool   `json:"required"`
	Purpose  string `json:"purpose"`
}

type domainView struct {
	db.Domain
	Apex    bool        `json:"apex"`
	Zone    string      `json:"zone"`
	Live    bool        `json:"live"`
	Records []dnsRecord `json:"records"`
}

type cachedValue struct {
	value   string
	expires time.Time
}

var (
	dnsCacheMu sync.Mutex
	dnsCache   = map[string]cachedValue{}
)

func cached(key string, ttl time.Duration, compute func() string) string {
	dnsCacheMu.Lock()
	if c, ok := dnsCache[key]; ok && time.Now().Before(c.expires) {
		dnsCacheMu.Unlock()
		return c.value
	}
	dnsCacheMu.Unlock()
	v := compute()
	dnsCacheMu.Lock()
	dnsCache[key] = cachedValue{value: v, expires: time.Now().Add(ttl)}
	dnsCacheMu.Unlock()
	return v
}

var lookupResolver = &net.Resolver{}

// zoneOf finds the DNS zone a name lives in: the closest ancestor (or the name
// itself) that has its own NS records and isn't a CNAME. Falls back to the last
// two labels when DNS doesn't answer.
func zoneOf(domain string) string {
	return cached("zone:"+domain, 6*time.Hour, func() string {
		labels := strings.Split(domain, ".")
		for i := 0; i <= len(labels)-2; i++ {
			name := strings.Join(labels[i:], ".")
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			ns, err := lookupResolver.LookupNS(ctx, name)
			cancel()
			if err != nil || len(ns) == 0 {
				continue
			}
			ctx, cancel = context.WithTimeout(context.Background(), 2*time.Second)
			canon, err := lookupResolver.LookupCNAME(ctx, name)
			cancel()
			if err == nil && strings.TrimSuffix(canon, ".") != name {
				continue // NS answer came from a CNAME target, not this name
			}
			return name
		}
		if len(labels) >= 2 {
			return strings.Join(labels[len(labels)-2:], ".")
		}
		return domain
	})
}

// targetIP is what an apex A record must point at (the IP behind cname.deployzy.com).
func targetIP() string {
	return cached("ip:"+cnameTarget, 10*time.Minute, func() string {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		ips, err := lookupResolver.LookupIPAddr(ctx, cnameTarget)
		if err != nil {
			return ""
		}
		for _, ip := range ips {
			if v4 := ip.IP.To4(); v4 != nil {
				return v4.String()
			}
		}
		return ""
	})
}

// dnsRecordsFor lists what to create for a domain. An apex can't hold a CNAME
// at most providers, so it gets an A record (plus www, which we redirect).
func dnsRecordsFor(domain string) (records []dnsRecord, apex bool, zone string) {
	zone = zoneOf(domain)
	apex = domain == zone
	if apex {
		ip := targetIP()
		if ip != "" {
			records = append(records, dnsRecord{Type: "A", Host: "@", Value: ip, Required: true,
				Purpose: "Points " + domain + " at Deployzy"})
		} else {
			records = append(records, dnsRecord{Type: "CNAME", Host: "@", Value: cnameTarget, Required: true,
				Purpose: "Points " + domain + " at Deployzy (needs CNAME flattening / ALIAS at the root)"})
		}
		records = append(records, dnsRecord{Type: "CNAME", Host: "www", Value: cnameTarget, Required: false,
			Purpose: "Optional: www." + domain + " redirects to " + domain})
		return records, true, zone
	}
	host := strings.TrimSuffix(domain, "."+zone)
	records = append(records, dnsRecord{Type: "CNAME", Host: host, Value: cnameTarget, Required: true,
		Purpose: "Points " + domain + " at Deployzy"})
	return records, false, zone
}

// domainViews decorates domains with their DNS instructions. Zone lookups are
// cached, and the first (uncached) ones run in parallel.
func domainViews(domains []db.Domain) []domainView {
	out := make([]domainView, len(domains))
	var wg sync.WaitGroup
	for i, d := range domains {
		wg.Add(1)
		go func(i int, d db.Domain) {
			defer wg.Done()
			records, apex, zone := dnsRecordsFor(d.Domain)
			out[i] = domainView{Domain: d, Apex: apex, Zone: zone, Records: records,
				Live: d.Verified && d.TargetSubdomain != ""}
		}(i, d)
	}
	wg.Wait()
	return out
}

// checkDomainDNS reports whether a domain resolves to us, by which method, and
// if not, a hint that says what to change.
func checkDomainDNS(domain string) (ok bool, method, hint string) {
	validTargets := []string{cnameTarget, "deployzy.com"} // deployzy.com: legacy target

	cname, _ := net.LookupCNAME(domain)
	cname = strings.TrimSuffix(cname, ".")
	for _, t := range validTargets {
		if cname == t {
			return true, "cname", ""
		}
	}

	// A record (or a provider-flattened CNAME) resolving to the same IP.
	ips, _ := net.LookupHost(domain)
	serverIPs, _ := net.LookupHost(cnameTarget)
	for _, ip := range ips {
		for _, sip := range serverIPs {
			if ip == sip {
				return true, "a-record", ""
			}
		}
	}

	// Our resolver may hold a stale answer; ask Google's, then the local one.
	for _, args := range [][]string{{"+short", domain, "@8.8.8.8"}, {"+short", domain}} {
		out, err := exec.Command("dig", args...).Output()
		if err != nil {
			continue
		}
		srvArgs := append([]string{"+short", cnameTarget}, args[2:]...)
		out2, err := exec.Command("dig", srvArgs...).Output()
		if err != nil {
			continue
		}
		got, want := strings.TrimSpace(string(out)), strings.TrimSpace(string(out2))
		if got != "" && want != "" && got == want {
			return true, "dig", ""
		}
	}

	switch {
	case domainIsCloudflareProxied(domain):
		hint = "The record is proxied by Cloudflare (orange cloud), which hides it. In Cloudflare, click the orange cloud to make it grey (DNS only)."
	case len(ips) == 0 && (cname == "" || cname == domain):
		hint = "No DNS record found yet. Add the record below; new records usually show up within a few minutes."
	case cname != "" && cname != domain:
		hint = domain + " points to " + cname + ", not " + cnameTarget + ". Update the record below."
	default:
		hint = domain + " resolves to " + strings.Join(ips, ", ") + ", not Deployzy. Update the record below."
	}
	return false, "", hint
}

// checkDomainTarget confirms the caller's team owns the project a domain is
// being pointed at. Tunnel targets are names the user connects with, so any
// non-empty name is accepted (as before).
func (s *Server) checkDomainTarget(r *http.Request, userIDs []string, targetType, targetSubdomain string) error {
	if targetType != "tunnel" && targetType != "project" {
		return errors.New("target_type must be 'tunnel' or 'project'")
	}
	if targetSubdomain == "" {
		return errors.New("target_subdomain required")
	}
	if targetType == "project" {
		for _, uid := range userIDs {
			projects, _ := s.db.ListProjects(r.Context(), uid)
			for _, p := range projects {
				if p.Subdomain == targetSubdomain {
					return nil
				}
			}
		}
		return errors.New("no project with that subdomain found in your team")
	}
	return nil
}

// StartDomainVerifier checks pending custom domains every 2 minutes, so a
// domain goes live on its own once its DNS is right, without anyone clicking
// Verify. Only domains added in the last 7 days are checked.
func StartDomainVerifier(ctx context.Context, database *db.DB, log zerolog.Logger) {
	log = log.With().Str("component", "domain_verifier").Logger()
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		domains, err := database.ListDomainsToCheck(ctx, 50)
		if err != nil {
			log.Warn().Err(err).Msg("list pending domains")
			continue
		}
		for _, d := range domains {
			ok, method, hint := checkDomainDNS(d.Domain)
			if err := database.RecordDomainCheck(ctx, d.ID, ok, hint); err != nil {
				log.Warn().Err(err).Str("domain", d.Domain).Msg("record domain check")
				continue
			}
			if ok {
				log.Info().Str("domain", d.Domain).Str("method", method).Msg("custom domain verified")
			}
		}
	}
}
