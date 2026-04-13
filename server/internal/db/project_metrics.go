package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// MetricSample is one bucket of metrics for the API response. If no bucketing
// is applied (range ≤ 1h) it's a single raw 30-second sample.
type MetricSample struct {
	TS            time.Time `json:"ts"`
	CPUPct        float64   `json:"cpu_pct"`
	MemoryMB      int       `json:"memory_mb"`
	MemoryLimitMB int       `json:"memory_limit_mb"`
	NetRxBytes    int64     `json:"net_rx_bytes"`
	NetTxBytes    int64     `json:"net_tx_bytes"`
}

// InsertMetric records a single sample. Called by the scraper every ~30s per container.
func (d *DB) InsertMetric(ctx context.Context, projectID string, cpu float64, memMB, memLimitMB int, rx, tx int64) error {
	_, err := d.Pool.Exec(ctx,
		`INSERT INTO project_metrics (project_id, ts, cpu_pct, memory_mb, memory_limit_mb, net_rx_bytes, net_tx_bytes)
		 VALUES ($1, now(), $2, $3, $4, $5, $6)
		 ON CONFLICT DO NOTHING`,
		projectID, cpu, memMB, memLimitMB, rx, tx,
	)
	return err
}

// GetMetrics returns samples for the project within the window. `bucket` is the
// PostgreSQL interval string for down-sampling (e.g. '5 minutes'); pass "" to
// return raw samples.
func (d *DB) GetMetrics(ctx context.Context, projectID string, since time.Time, bucket string) ([]MetricSample, error) {
	var (
		rows pgx.Rows
		err  error
	)
	if bucket == "" {
		rows, err = d.Pool.Query(ctx,
			`SELECT ts, cpu_pct, memory_mb, memory_limit_mb, net_rx_bytes, net_tx_bytes
			 FROM project_metrics
			 WHERE project_id = $1 AND ts >= $2
			 ORDER BY ts ASC`,
			projectID, since,
		)
	} else {
		// date_bin is Postgres 14+; buckets align to epoch so ranges stitch together cleanly.
		rows, err = d.Pool.Query(ctx,
			`SELECT date_bin($3::interval, ts, TIMESTAMP '1970-01-01') AS b,
			        AVG(cpu_pct)::numeric(6,2),
			        MAX(memory_mb),
			        MAX(memory_limit_mb),
			        MAX(net_rx_bytes),
			        MAX(net_tx_bytes)
			 FROM project_metrics
			 WHERE project_id = $1 AND ts >= $2
			 GROUP BY b
			 ORDER BY b ASC`,
			projectID, since, bucket,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []MetricSample
	for rows.Next() {
		var s MetricSample
		if err := rows.Scan(&s.TS, &s.CPUPct, &s.MemoryMB, &s.MemoryLimitMB, &s.NetRxBytes, &s.NetTxBytes); err != nil {
			continue
		}
		out = append(out, s)
	}
	return out, nil
}

// PruneOldMetrics drops anything older than the cutoff. Called periodically by
// the scraper so the table can't grow unboundedly.
func (d *DB) PruneOldMetrics(ctx context.Context, cutoff time.Time) error {
	_, err := d.Pool.Exec(ctx,
		`DELETE FROM project_metrics WHERE ts < $1`, cutoff,
	)
	return err
}
