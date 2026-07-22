package db

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type Template struct {
	ID          string         `json:"id"`
	Slug        string         `json:"slug"`
	Name        string         `json:"name"`
	Tagline     string         `json:"tagline"`
	Description string         `json:"description"`
	Category    string         `json:"category"`
	Tags        []string       `json:"tags"`
	Icon        string         `json:"icon"`
	// LogoSlug is a Simple Icons slug for the brand mark. Set from the admin
	// UI so adding a template with a real logo needs no code change.
	LogoSlug    string         `json:"logo_slug"`
	Color       string         `json:"color"`
	SourceRepo  *string        `json:"source_repo,omitempty"`
	DockerImage *string        `json:"docker_image,omitempty"`
	EnvVars     []EnvVarSchema `json:"env_vars"`
	Ports       []int          `json:"ports"`
	MinMemoryMB int            `json:"min_memory_mb"`
	PostDeploy  string         `json:"post_deploy"`
	IsOfficial  bool           `json:"is_official"`
	IsFeatured  bool           `json:"is_featured"`
	IsActive    bool           `json:"is_active"`
	DeployCount int            `json:"deploy_count"`
	StarCount   int            `json:"star_count"`
	IsStarred   bool           `json:"is_starred"`
	CreatedAt   time.Time      `json:"created_at"`
}

type EnvVarSchema struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Description string   `json:"description"`
	Required    bool     `json:"required"`
	Type        string   `json:"type"` // text | secret | select | auto
	Options     []string `json:"options,omitempty"`
	Default     string   `json:"default"`
	Placeholder string   `json:"placeholder"`
}

type TemplateFilter struct {
	Category string
	Search   string
	Sort     string // popular | newest | stars | featured
	Limit    int
	Offset   int
}

// buildTemplateFilters returns (whereSQL, args) for filter-only predicates
// with args starting at $1. Used for both count and list queries.
func buildTemplateFilters(f TemplateFilter) (string, []any) {
	clauses := []string{"t.is_active = true"}
	args := []any{}
	n := 1

	if f.Category != "" && f.Category != "all" {
		clauses = append(clauses, fmt.Sprintf("t.category = $%d", n))
		args = append(args, f.Category)
		n++
	}
	if f.Search != "" {
		p := fmt.Sprintf("$%d", n)
		clauses = append(clauses, fmt.Sprintf(
			"(t.name ILIKE %s OR t.tagline ILIKE %s OR t.description ILIKE %s OR EXISTS(SELECT 1 FROM unnest(t.tags) tag WHERE tag ILIKE %s))",
			p, p, p, p,
		))
		args = append(args, "%"+f.Search+"%")
		n++
	}
	_ = n
	return "WHERE " + strings.Join(clauses, " AND "), args
}

func (d *DB) ListTemplates(ctx context.Context, f TemplateFilter, userID string) ([]Template, int, error) {
	if f.Limit <= 0 {
		f.Limit = 20
	}

	whereSQL, filterArgs := buildTemplateFilters(f)

	var total int
	if err := d.Pool.QueryRow(ctx,
		fmt.Sprintf("SELECT COUNT(*) FROM templates t %s", whereSQL),
		filterArgs...,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	orderBy := "t.deploy_count DESC, t.is_featured DESC"
	switch f.Sort {
	case "newest":
		orderBy = "t.created_at DESC"
	case "stars":
		orderBy = "star_count DESC, t.deploy_count DESC"
	case "featured":
		orderBy = "t.is_featured DESC, t.deploy_count DESC"
	}

	// For the main query, prepend userID as $1 so the starred JOIN can use it.
	// Filter args shift up by 1 when userID is present.
	var mainArgs []any
	var userRef string
	if userID != "" {
		mainArgs = append([]any{userID}, filterArgs...)
		userRef = "$1"
		// Rewrite filter placeholders: $1→$2, $2→$3, etc.
		for i := len(filterArgs); i >= 1; i-- {
			whereSQL = strings.ReplaceAll(whereSQL, fmt.Sprintf("$%d", i), fmt.Sprintf("$%d", i+1))
		}
	} else {
		mainArgs = filterArgs
		userRef = "NULL::uuid"
	}

	n := len(mainArgs) + 1
	mainArgs = append(mainArgs, f.Limit, f.Offset)

	query := fmt.Sprintf(`
		SELECT t.id, t.slug, t.name, t.tagline, t.description, t.category, t.tags,
		       t.icon, COALESCE(t.logo_slug, ''), t.color, t.source_repo, t.docker_image, t.env_vars, t.ports,
		       t.min_memory_mb, t.post_deploy, t.is_official, t.is_featured, t.is_active,
		       t.deploy_count, t.created_at,
		       COUNT(ts.user_id)::int AS star_count,
		       COALESCE(BOOL_OR(ts2.user_id IS NOT NULL), false) AS is_starred
		FROM templates t
		LEFT JOIN template_stars ts  ON ts.template_id = t.id
		LEFT JOIN template_stars ts2 ON ts2.template_id = t.id AND ts2.user_id = %s
		%s
		GROUP BY t.id
		ORDER BY %s
		LIMIT $%d OFFSET $%d`,
		userRef, whereSQL, orderBy, n, n+1,
	)

	rows, err := d.Pool.Query(ctx, query, mainArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []Template
	for rows.Next() {
		var t Template
		var envVarsRaw []byte
		if err := rows.Scan(
			&t.ID, &t.Slug, &t.Name, &t.Tagline, &t.Description, &t.Category, &t.Tags,
			&t.Icon, &t.LogoSlug, &t.Color, &t.SourceRepo, &t.DockerImage, &envVarsRaw, &t.Ports,
			&t.MinMemoryMB, &t.PostDeploy, &t.IsOfficial, &t.IsFeatured, &t.IsActive,
			&t.DeployCount, &t.CreatedAt,
			&t.StarCount, &t.IsStarred,
		); err != nil {
			d.log.Error().Err(err).Msg("scan template row")
			return nil, 0, err
		}
		json.Unmarshal(envVarsRaw, &t.EnvVars)
		out = append(out, t)
	}
	return out, total, nil
}

func (d *DB) GetTemplate(ctx context.Context, slug, userID string) (*Template, error) {
	var userRef string
	args := []any{slug}
	if userID != "" {
		args = append(args, userID)
		userRef = "$2"
	} else {
		userRef = "NULL::uuid"
	}

	var t Template
	var envVarsRaw []byte
	err := d.Pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT t.id, t.slug, t.name, t.tagline, t.description, t.category, t.tags,
		       t.icon, COALESCE(t.logo_slug, ''), t.color, t.source_repo, t.docker_image, t.env_vars, t.ports,
		       t.min_memory_mb, t.post_deploy, t.is_official, t.is_featured, t.is_active,
		       t.deploy_count, t.created_at,
		       COUNT(ts.user_id)::int AS star_count,
		       COALESCE(BOOL_OR(ts2.user_id IS NOT NULL), false) AS is_starred
		FROM templates t
		LEFT JOIN template_stars ts  ON ts.template_id = t.id
		LEFT JOIN template_stars ts2 ON ts2.template_id = t.id AND ts2.user_id = %s
		WHERE t.slug = $1 AND t.is_active = true
		GROUP BY t.id`, userRef),
		args...,
	).Scan(
		&t.ID, &t.Slug, &t.Name, &t.Tagline, &t.Description, &t.Category, &t.Tags,
		&t.Icon, &t.LogoSlug, &t.Color, &t.SourceRepo, &t.DockerImage, &envVarsRaw, &t.Ports,
		&t.MinMemoryMB, &t.PostDeploy, &t.IsOfficial, &t.IsFeatured, &t.IsActive,
		&t.DeployCount, &t.CreatedAt,
		&t.StarCount, &t.IsStarred,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	json.Unmarshal(envVarsRaw, &t.EnvVars)
	return &t, nil
}

// ToggleTemplateStar stars or unstars; returns (isNowStarred, newCount, error).
func (d *DB) ToggleTemplateStar(ctx context.Context, templateID, userID string) (bool, int, error) {
	var exists bool
	d.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM template_stars WHERE template_id=$1 AND user_id=$2)`,
		templateID, userID,
	).Scan(&exists)

	if exists {
		if _, err := d.Pool.Exec(ctx,
			`DELETE FROM template_stars WHERE template_id=$1 AND user_id=$2`,
			templateID, userID,
		); err != nil {
			return false, 0, err
		}
	} else {
		if _, err := d.Pool.Exec(ctx,
			`INSERT INTO template_stars (template_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			templateID, userID,
		); err != nil {
			return false, 0, err
		}
	}

	var count int
	d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM template_stars WHERE template_id=$1`, templateID,
	).Scan(&count)

	return !exists, count, nil
}

// IncrementTemplateDeployCount atomically bumps the counter.
func (d *DB) IncrementTemplateDeployCount(ctx context.Context, templateID string) {
	d.Pool.Exec(ctx,
		`UPDATE templates SET deploy_count = deploy_count + 1, updated_at = NOW() WHERE id = $1`,
		templateID,
	)
}

// ─── Admin CRUD ──────────────────────────────────────────────────────────────

type TemplateUpsert struct {
	Slug        string         `json:"slug"`
	Name        string         `json:"name"`
	Tagline     string         `json:"tagline"`
	Description string         `json:"description"`
	Category    string         `json:"category"`
	Tags        []string       `json:"tags"`
	Icon        string         `json:"icon"`
	// LogoSlug is a Simple Icons slug for the brand mark. Set from the admin
	// UI so adding a template with a real logo needs no code change.
	LogoSlug    string         `json:"logo_slug"`
	Color       string         `json:"color"`
	SourceRepo  *string        `json:"source_repo"`
	DockerImage *string        `json:"docker_image"`
	EnvVars     []EnvVarSchema `json:"env_vars"`
	Ports       []int          `json:"ports"`
	MinMemoryMB int            `json:"min_memory_mb"`
	PostDeploy  string         `json:"post_deploy"`
	IsOfficial  bool           `json:"is_official"`
	IsFeatured  bool           `json:"is_featured"`
	IsActive    bool           `json:"is_active"`
}

func (d *DB) AdminListTemplates(ctx context.Context) ([]Template, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT t.id, t.slug, t.name, t.tagline, t.description, t.category, t.tags,
		       t.icon, COALESCE(t.logo_slug, ''), t.color, t.source_repo, t.docker_image, t.env_vars, t.ports,
		       t.min_memory_mb, t.post_deploy, t.is_official, t.is_featured, t.is_active,
		       t.deploy_count, t.created_at,
		       COUNT(ts.user_id)::int AS star_count,
		       false AS is_starred
		FROM templates t
		LEFT JOIN template_stars ts ON ts.template_id = t.id
		GROUP BY t.id
		ORDER BY t.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Template
	for rows.Next() {
		var t Template
		var envVarsRaw []byte
		if err := rows.Scan(
			&t.ID, &t.Slug, &t.Name, &t.Tagline, &t.Description, &t.Category, &t.Tags,
			&t.Icon, &t.LogoSlug, &t.Color, &t.SourceRepo, &t.DockerImage, &envVarsRaw, &t.Ports,
			&t.MinMemoryMB, &t.PostDeploy, &t.IsOfficial, &t.IsFeatured, &t.IsActive,
			&t.DeployCount, &t.CreatedAt, &t.StarCount, &t.IsStarred,
		); err != nil {
			d.log.Error().Err(err).Msg("AdminListTemplates scan")
			return nil, err
		}
		json.Unmarshal(envVarsRaw, &t.EnvVars)
		out = append(out, t)
	}
	return out, nil
}

func (d *DB) AdminCreateTemplate(ctx context.Context, u TemplateUpsert) (*Template, error) {
	envJSON, _ := json.Marshal(u.EnvVars)
	if u.Tags == nil {
		u.Tags = []string{}
	}
	if u.Ports == nil {
		u.Ports = []int{}
	}
	if u.MinMemoryMB <= 0 {
		u.MinMemoryMB = 256
	}

	var t Template
	var envVarsRaw []byte
	err := d.Pool.QueryRow(ctx, `
		INSERT INTO templates
		  (slug, name, tagline, description, category, tags, icon, logo_slug, color,
		   source_repo, docker_image, env_vars, ports, min_memory_mb,
		   post_deploy, is_official, is_featured, is_active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
		RETURNING id, slug, name, tagline, description, category, tags,
		          icon, COALESCE(logo_slug, ''), color, source_repo, docker_image, env_vars, ports,
		          min_memory_mb, post_deploy, is_official, is_featured, is_active,
		          deploy_count, created_at`,
		u.Slug, u.Name, u.Tagline, u.Description, u.Category, u.Tags, u.Icon, u.LogoSlug, u.Color,
		u.SourceRepo, u.DockerImage, envJSON, u.Ports, u.MinMemoryMB,
		u.PostDeploy, u.IsOfficial, u.IsFeatured, u.IsActive,
	).Scan(
		&t.ID, &t.Slug, &t.Name, &t.Tagline, &t.Description, &t.Category, &t.Tags,
		&t.Icon, &t.LogoSlug, &t.Color, &t.SourceRepo, &t.DockerImage, &envVarsRaw, &t.Ports,
		&t.MinMemoryMB, &t.PostDeploy, &t.IsOfficial, &t.IsFeatured, &t.IsActive,
		&t.DeployCount, &t.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(envVarsRaw, &t.EnvVars)
	return &t, nil
}

func (d *DB) AdminUpdateTemplate(ctx context.Context, id string, u TemplateUpsert) (*Template, error) {
	envJSON, _ := json.Marshal(u.EnvVars)
	if u.Tags == nil {
		u.Tags = []string{}
	}
	if u.Ports == nil {
		u.Ports = []int{}
	}

	var t Template
	var envVarsRaw []byte
	err := d.Pool.QueryRow(ctx, `
		UPDATE templates SET
		  slug=$2, name=$3, tagline=$4, description=$5, category=$6, tags=$7,
		  icon=$8, logo_slug=$9, color=$10, source_repo=$11, docker_image=$12, env_vars=$13,
		  ports=$14, min_memory_mb=$15, post_deploy=$16, is_official=$17,
		  is_featured=$18, is_active=$19, updated_at=NOW()
		WHERE id=$1
		RETURNING id, slug, name, tagline, description, category, tags,
		          icon, COALESCE(logo_slug, ''), color, source_repo, docker_image, env_vars, ports,
		          min_memory_mb, post_deploy, is_official, is_featured, is_active,
		          deploy_count, created_at`,
		id,
		u.Slug, u.Name, u.Tagline, u.Description, u.Category, u.Tags, u.Icon, u.LogoSlug, u.Color,
		u.SourceRepo, u.DockerImage, envJSON, u.Ports, u.MinMemoryMB,
		u.PostDeploy, u.IsOfficial, u.IsFeatured, u.IsActive,
	).Scan(
		&t.ID, &t.Slug, &t.Name, &t.Tagline, &t.Description, &t.Category, &t.Tags,
		&t.Icon, &t.LogoSlug, &t.Color, &t.SourceRepo, &t.DockerImage, &envVarsRaw, &t.Ports,
		&t.MinMemoryMB, &t.PostDeploy, &t.IsOfficial, &t.IsFeatured, &t.IsActive,
		&t.DeployCount, &t.CreatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	json.Unmarshal(envVarsRaw, &t.EnvVars)
	return &t, nil
}

func (d *DB) AdminDeleteTemplate(ctx context.Context, id string) error {
	cmd, err := d.Pool.Exec(ctx, `DELETE FROM templates WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return fmt.Errorf("template not found")
	}
	return nil
}

// ListTemplateCategories returns distinct active categories with their counts.
func (d *DB) ListTemplateCategories(ctx context.Context) ([]map[string]any, error) {
	rows, err := d.Pool.Query(ctx,
		`SELECT category, COUNT(*)::int FROM templates WHERE is_active=true GROUP BY category ORDER BY COUNT(*) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var cat string
		var cnt int
		if err := rows.Scan(&cat, &cnt); err != nil {
			continue
		}
		out = append(out, map[string]any{"category": cat, "count": cnt})
	}
	return out, nil
}
