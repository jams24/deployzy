package db

import (
	"context"
	"time"
)

// SEODailyRow is one aggregated bucket for a day.
type SEODailyRow struct {
	Day     string `json:"day"`
	Kind    string `json:"kind"`    // crawler | referral
	Channel string `json:"channel"` // ai|search|social|... or llm|search|social
	Name    string `json:"name"`
	Hits    int64  `json:"hits"`
}

// SEOIngestState is the log-reader cursor.
type SEOIngestState struct {
	Offset int64
	Inode  int64
}

// GetSEOIngestState returns the current log cursor (offset + inode).
func (d *DB) GetSEOIngestState(ctx context.Context) (SEOIngestState, error) {
	var s SEOIngestState
	err := d.Pool.QueryRow(ctx,
		`SELECT log_offset, log_inode FROM seo_ingest_state WHERE id = 1`,
	).Scan(&s.Offset, &s.Inode)
	return s, err
}

// SetSEOIngestState persists the cursor after a read.
func (d *DB) SetSEOIngestState(ctx context.Context, s SEOIngestState) error {
	_, err := d.Pool.Exec(ctx,
		`UPDATE seo_ingest_state SET log_offset = $1, log_inode = $2, updated_at = now() WHERE id = 1`,
		s.Offset, s.Inode)
	return err
}

// AddSEOCounts upserts a batch of daily counts. counts is keyed by a struct so
// one ingest pass writes all buckets in a single transaction. Increments are
// additive (ON CONFLICT … hits = hits + excluded.hits) so re-running is safe as
// long as each log line is only read once (guaranteed by the offset cursor).
type SEOCountKey struct {
	Day, Kind, Channel, Name string
}

func (d *DB) AddSEOCounts(ctx context.Context, counts map[SEOCountKey]int64) error {
	if len(counts) == 0 {
		return nil
	}
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for k, n := range counts {
		if _, err := tx.Exec(ctx,
			`INSERT INTO seo_daily (day, kind, channel, name, hits)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (day, kind, channel, name)
			 DO UPDATE SET hits = seo_daily.hits + EXCLUDED.hits`,
			k.Day, k.Kind, k.Channel, k.Name, n); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// GetSEODaily returns all aggregated rows in the last `days` days.
func (d *DB) GetSEODaily(ctx context.Context, days int) ([]SEODailyRow, error) {
	if days <= 0 {
		days = 30
	}
	since := time.Now().AddDate(0, 0, -days).Format("2006-01-02")
	rows, err := d.Pool.Query(ctx,
		`SELECT to_char(day, 'YYYY-MM-DD'), kind, channel, name, hits
		 FROM seo_daily WHERE day >= $1 ORDER BY day DESC`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SEODailyRow
	for rows.Next() {
		var r SEODailyRow
		if err := rows.Scan(&r.Day, &r.Kind, &r.Channel, &r.Name, &r.Hits); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
