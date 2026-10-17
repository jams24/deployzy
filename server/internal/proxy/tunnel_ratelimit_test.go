package proxy

import "testing"

func TestTunnelRateLimiter(t *testing.T) {
	plan := map[string]int{"free": 5, "admin": -1}
	l := newTunnelRateLimiter(func(uid string) int { return plan[uid] })

	allowed := 0
	for i := 0; i < 50; i++ { // a burst well over the cap
		if l.allow("https://a.example", "free") {
			allowed++
		}
	}
	if allowed != 10 { // burst = 2 × 5 req/s
		t.Fatalf("free tunnel allowed %d of 50 burst requests, want 10", allowed)
	}
	for i := 0; i < 1000; i++ {
		if !l.allow("https://b.example", "admin") {
			t.Fatal("unlimited (-1) owner was rate limited")
		}
	}
	if !l.allow("https://c.example", "") {
		t.Fatal("anonymous/dev tunnel should not be limited")
	}
	if n := l.prune(func(u string) bool { return u == "https://a.example" }); n != 0 {
		// b.example never got a bucket (unlimited), so nothing else to prune
		t.Fatalf("pruned %d buckets, want 0", n)
	}
	if n := l.prune(func(string) bool { return false }); n != 1 {
		t.Fatalf("pruned %d buckets, want 1", n)
	}
}
