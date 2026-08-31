package db

import "context"

// Density + idle-sleep analytics for the admin dashboard. Surfaces the payoff of
// the two density levers: real-vs-reserved memory per box (how much reservation
// is idle headroom we can pack into) and the idle sleep/wake activity.

type DensityServer struct {
	ID              string  `json:"id"`
	Label           string  `json:"label"`
	Region          string  `json:"region"`
	IsLocal         bool    `json:"is_local"`
	Status          string  `json:"status"`
	TotalMemoryMB   int     `json:"total_memory_mb"`
	AllocatedMemMB  int     `json:"allocated_memory_mb"`
	UsedMemoryMB    int     `json:"used_memory_mb"`
	LoadAvg         float64 `json:"load_avg"`
	CurrentProjects int     `json:"current_projects"`
	MaxProjects     int     `json:"max_projects"`
	ReservedPct     float64 `json:"reserved_pct"`
	UsedPct         float64 `json:"used_pct"`
	ReclaimableMB   int     `json:"reclaimable_mb"` // reserved but not actually used
	SleepingCount   int     `json:"sleeping_count"`
}

type SleepingProject struct {
	ID            string  `json:"id"`
	Subdomain     string  `json:"subdomain"`
	Email         string  `json:"email"`
	MemoryMB      int     `json:"memory_mb"`
	SleptAt       *string `json:"slept_at"`
	LastRequestAt *string `json:"last_request_at"`
}

type DensityStats struct {
	Servers []DensityServer `json:"servers"`

	// Idle sleep summary.
	SleepingCount     int               `json:"sleeping_count"`
	SleepingMemoryMB  int               `json:"sleeping_memory_mb"`  // reserved RAM freed by sleeping
	EligibleAwake     int               `json:"eligible_awake"`      // free/local apps idle >30m but still awake (e.g. admin-owned)
	TotalRunning      int               `json:"total_running"`
	SleepingProjects  []SleepingProject `json:"sleeping_projects"`

	// Platform-wide memory rollup.
	TotalMemoryMB     int     `json:"total_memory_mb"`
	AllocatedMemoryMB int     `json:"allocated_memory_mb"`
	UsedMemoryMB      int     `json:"used_memory_mb"`
	ReservedPct       float64 `json:"reserved_pct"`
	UsedPct           float64 `json:"used_pct"`
}

// AdminDensityStats gathers per-server memory reality vs reservation plus idle
// sleep activity. Read-only, admin-scoped.
func (d *DB) AdminDensityStats(ctx context.Context) (*DensityStats, error) {
	out := &DensityStats{Servers: []DensityServer{}, SleepingProjects: []SleepingProject{}}

	// Per-server memory + project counts, with a per-server sleeping-project count.
	rows, err := d.Pool.Query(ctx, `
		SELECT ws.id, ws.label, COALESCE(ws.region, ''), COALESCE(ws.is_local, false), ws.status,
		       ws.total_memory_mb, ws.allocated_memory_mb, COALESCE(ws.used_memory_mb, 0), COALESCE(ws.load_avg, 0),
		       ws.current_projects, ws.max_projects,
		       (SELECT count(*) FROM projects p WHERE p.worker_server_id = ws.id AND p.sleeping = true)
		  FROM worker_servers ws
		 WHERE ws.user_id IS NULL
		 ORDER BY COALESCE(ws.priority, 100) ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var s DensityServer
		if err := rows.Scan(&s.ID, &s.Label, &s.Region, &s.IsLocal, &s.Status,
			&s.TotalMemoryMB, &s.AllocatedMemMB, &s.UsedMemoryMB, &s.LoadAvg,
			&s.CurrentProjects, &s.MaxProjects, &s.SleepingCount); err != nil {
			return nil, err
		}
		if s.TotalMemoryMB > 0 {
			s.ReservedPct = round1(float64(s.AllocatedMemMB) / float64(s.TotalMemoryMB) * 100)
			s.UsedPct = round1(float64(s.UsedMemoryMB) / float64(s.TotalMemoryMB) * 100)
		}
		s.ReclaimableMB = s.AllocatedMemMB - s.UsedMemoryMB
		if s.ReclaimableMB < 0 {
			s.ReclaimableMB = 0
		}
		out.TotalMemoryMB += s.TotalMemoryMB
		out.AllocatedMemoryMB += s.AllocatedMemMB
		out.UsedMemoryMB += s.UsedMemoryMB
		out.Servers = append(out.Servers, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out.TotalMemoryMB > 0 {
		out.ReservedPct = round1(float64(out.AllocatedMemoryMB) / float64(out.TotalMemoryMB) * 100)
		out.UsedPct = round1(float64(out.UsedMemoryMB) / float64(out.TotalMemoryMB) * 100)
	}

	// Sleeping projects (with owner + reserved memory, default 512 when unset).
	sr, err := d.Pool.Query(ctx, `
		SELECT p.id, p.subdomain, u.email,
		       CASE WHEN p.memory_mb > 0 THEN p.memory_mb ELSE 512 END,
		       to_char(p.slept_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(p.last_request_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		  FROM projects p JOIN users u ON u.id = p.user_id
		 WHERE p.sleeping = true
		 ORDER BY p.slept_at DESC NULLS LAST`)
	if err != nil {
		return nil, err
	}
	defer sr.Close()
	for sr.Next() {
		var p SleepingProject
		if err := sr.Scan(&p.ID, &p.Subdomain, &p.Email, &p.MemoryMB, &p.SleptAt, &p.LastRequestAt); err != nil {
			return nil, err
		}
		out.SleepingCount++
		out.SleepingMemoryMB += p.MemoryMB
		out.SleepingProjects = append(out.SleepingProjects, p)
	}
	if err := sr.Err(); err != nil {
		return nil, err
	}

	// Counts: total running, and free/local apps idle >30m still awake (would be
	// slept if not admin-owned) — a hint at further reclaimable capacity.
	d.Pool.QueryRow(ctx, `SELECT count(*) FROM projects WHERE status = 'running'`).Scan(&out.TotalRunning)
	d.Pool.QueryRow(ctx, `
		SELECT count(*)
		  FROM projects p JOIN users u ON u.id = p.user_id
		  LEFT JOIN worker_servers ws ON ws.id = p.worker_server_id
		 WHERE p.status = 'running' AND p.container_port > 0 AND p.sleeping = false
		   AND p.sleep_enabled = true
		   AND (p.worker_server_id IS NULL OR COALESCE(ws.is_local, false) = true)
		   AND COALESCE(u.plan, 'free') IN ('', 'free')
		   AND p.parent_project_id IS NULL
		   AND p.last_request_at IS NOT NULL
		   AND p.last_request_at < now() - interval '30 minutes'`).Scan(&out.EligibleAwake)

	return out, nil
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}
