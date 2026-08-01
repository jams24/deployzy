package api

import (
	"bufio"
	"context"
	_ "embed"
	"fmt"
	"net"
	"strings"
	"time"
)

//go:embed disposable_domains.txt
var disposableDomainsRaw string

// disposableDomains is the set of blocked throwaway/temp-mail domains, loaded
// once from the embedded list.
var disposableDomains = loadDisposableDomains()

func loadDisposableDomains() map[string]bool {
	set := make(map[string]bool)
	sc := bufio.NewScanner(strings.NewReader(disposableDomainsRaw))
	for sc.Scan() {
		line := strings.TrimSpace(strings.ToLower(sc.Text()))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		set[line] = true
	}
	return set
}

// emailDomain returns the lowercased domain part of an email, or "" if malformed.
func emailDomain(email string) string {
	at := strings.LastIndex(email, "@")
	if at < 1 || at == len(email)-1 {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(email[at+1:]))
}

// validateSignupEmail rejects disposable/temporary email domains and domains
// with no real mailbox (no MX and no A/AAAA record). This is an anti-abuse gate
// for free-tier signups — it lets through Gmail/Yahoo/Outlook and legitimate
// custom/business domains, but blocks throwaway addresses. Returns a user-facing
// error message (non-nil) when the email should be refused.
func validateSignupEmail(ctx context.Context, email string) error {
	domain := emailDomain(email)
	if domain == "" || !strings.Contains(domain, ".") {
		return fmt.Errorf("please enter a valid email address")
	}

	// Blocklist: known disposable providers (exact domain or any parent domain,
	// so sub.mailinator.com is caught by mailinator.com).
	labels := strings.Split(domain, ".")
	for i := range labels {
		if disposableDomains[strings.Join(labels[i:], ".")] {
			return fmt.Errorf("temporary or disposable email addresses aren't allowed — please sign up with a permanent email (Gmail, Yahoo, Outlook, or your own domain)")
		}
	}

	// Mailbox check: the domain must actually be able to receive mail. A domain
	// with valid MX records passes; if there are none we accept an A/AAAA record
	// as a fallback (RFC 5321 implicit MX) so small self-hosted domains still work.
	lookupCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	var r net.Resolver
	if mx, err := r.LookupMX(lookupCtx, domain); err == nil && len(mx) > 0 {
		for _, m := range mx {
			if strings.TrimSuffix(m.Host, ".") != "" {
				return nil // has a real mail server
			}
		}
	}
	if addrs, err := r.LookupHost(lookupCtx, domain); err == nil && len(addrs) > 0 {
		return nil // implicit MX (A/AAAA present)
	}
	return fmt.Errorf("that email domain can't receive mail — please use a valid email address")
}
