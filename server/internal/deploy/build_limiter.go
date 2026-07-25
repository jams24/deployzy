package deploy

import (
	"context"
	"strconv"
	"sync"
	"time"
)

// buildLimiter caps how many docker builds run concurrently across the WHOLE
// platform, regardless of plan — a from-scratch build already strains the host,
// so several at once wears the VPS out (and starves live containers). The limit
// is read live from the `max_concurrent_builds` app setting (default 1) so an
// admin can raise it once the platform moves to a bigger box, no redeploy.
type buildLimiter struct {
	mu     sync.Mutex
	cond   *sync.Cond
	active int
	limit  func() int
}

func newBuildLimiter(limit func() int) *buildLimiter {
	b := &buildLimiter{limit: limit}
	b.cond = sync.NewCond(&b.mu)
	return b
}

// Acquire blocks until a build slot is free (or ctx is cancelled). Returns true
// if a slot was acquired (caller must Release), false if ctx ended while waiting.
func (b *buildLimiter) Acquire(ctx context.Context) bool {
	// Wake any waiter if the context is cancelled so it can bail out.
	stop := context.AfterFunc(ctx, func() {
		b.mu.Lock()
		b.cond.Broadcast()
		b.mu.Unlock()
	})
	defer stop()

	b.mu.Lock()
	defer b.mu.Unlock()
	for b.active >= b.currentLimit() {
		if ctx.Err() != nil {
			return false
		}
		b.cond.Wait()
	}
	b.active++
	return true
}

func (b *buildLimiter) Release() {
	b.mu.Lock()
	if b.active > 0 {
		b.active--
	}
	b.cond.Broadcast()
	b.mu.Unlock()
}

func (b *buildLimiter) currentLimit() int {
	n := 1
	if b.limit != nil {
		if v := b.limit(); v > 0 {
			n = v
		}
	}
	return n
}

// settingBuildLimit returns a cached reader for the max_concurrent_builds
// setting so the DB isn't hit on every queued build. Default 1.
func settingBuildLimit(database interface {
	GetSetting(ctx context.Context, key string) (string, error)
}) func() int {
	var (
		mu     sync.Mutex
		cached = 1
		at     time.Time
	)
	return func() int {
		mu.Lock()
		defer mu.Unlock()
		if time.Since(at) < 10*time.Second {
			return cached
		}
		v, _ := database.GetSetting(context.Background(), "max_concurrent_builds")
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cached = n
		} else {
			cached = 1
		}
		at = time.Now()
		return cached
	}
}
