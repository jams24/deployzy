package deploy

import (
	"strings"
	"testing"
	"time"
)

func TestContainerExitDescribe(t *testing.T) {
	start := time.Date(2026, 10, 29, 10, 0, 0, 0, time.UTC)
	cases := []struct {
		name     string
		x        containerExit
		external bool
		want     []string
		notWant  []string
	}{
		{
			name:    "oom",
			x:       containerExit{ExitCode: 137, OOMKilled: true, MemoryBytes: 512 << 20},
			want:    []string{"out of memory", "limit 512 MB", "OOM-killed: true"},
			notWant: []string{"Crashed"},
		},
		{
			name: "restart budget exhausted",
			x:    containerExit{ExitCode: 1, RestartCount: 5},
			want: []string{"Crashed 6 times", "restarted automatically 5 times", "Exit code: 1", "5/5"},
		},
		{
			name:    "clean exit",
			x:       containerExit{ExitCode: 0},
			want:    []string{"exited on its own (exit code 0)"},
			notWant: []string{"Crashed"},
		},
		{
			name:     "sigterm from host restart",
			x:        containerExit{ExitCode: 143, StartedAt: start, FinishedAt: start.Add(90 * time.Minute)},
			external: true,
			want:     []string{"SIGTERM", "Last run: 1h30m0s"},
		},
		{
			name:     "sigkill not oom",
			x:        containerExit{ExitCode: 137},
			external: true,
			want:     []string{"SIGKILL", "not by the app's memory limit"},
		},
		{
			name: "sigterm after restarts is a crash loop, not external",
			x:    containerExit{ExitCode: 143, RestartCount: 2},
			want: []string{"SIGTERM", "2/5"},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := c.x.describe()
			for _, w := range c.want {
				if !strings.Contains(got, w) {
					t.Errorf("describe() missing %q in:\n%s", w, got)
				}
			}
			for _, w := range c.notWant {
				if strings.Contains(got, w) {
					t.Errorf("describe() should not contain %q:\n%s", w, got)
				}
			}
			if c.x.externalStop() != c.external {
				t.Errorf("externalStop() = %v, want %v", c.x.externalStop(), c.external)
			}
		})
	}
}
