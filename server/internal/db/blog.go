package db

import (
	"context"
	"encoding/json"
	"time"
)

// BlogPost is a database blog post record.
type BlogPost struct {
	ID          string          `json:"id"`
	Slug        string          `json:"slug"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Excerpt     string          `json:"excerpt"`
	Content     json.RawMessage `json:"content"`
	CoverImage  *string         `json:"cover_image"`
	Category    string          `json:"category"`
	Tags        []string        `json:"tags"`
	Author      string          `json:"author"`
	ReadTime    string          `json:"read_time"`
	Status      string          `json:"status"`
	PublishedAt *time.Time      `json:"published_at"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

// ListPublishedBlogPosts returns all published posts newest-first.
func (d *DB) ListPublishedBlogPosts(ctx context.Context) ([]BlogPost, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT id, slug, title, description, excerpt, content, cover_image,
		       category, tags, author, read_time, status, published_at, created_at, updated_at
		FROM blog_posts
		WHERE status = 'published'
		ORDER BY published_at DESC, created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBlogPosts(rows)
}

// ListAllBlogPosts returns all posts (admin).
func (d *DB) ListAllBlogPosts(ctx context.Context) ([]BlogPost, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT id, slug, title, description, excerpt, content, cover_image,
		       category, tags, author, read_time, status, published_at, created_at, updated_at
		FROM blog_posts
		ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBlogPosts(rows)
}

// GetBlogPostBySlug returns a published post by slug.
func (d *DB) GetBlogPostBySlug(ctx context.Context, slug string) (*BlogPost, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT id, slug, title, description, excerpt, content, cover_image,
		       category, tags, author, read_time, status, published_at, created_at, updated_at
		FROM blog_posts WHERE slug = $1`, slug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	posts, err := scanBlogPosts(rows)
	if err != nil || len(posts) == 0 {
		return nil, err
	}
	return &posts[0], nil
}

// GetBlogPostByID returns a post by ID (admin).
func (d *DB) GetBlogPostByID(ctx context.Context, id string) (*BlogPost, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT id, slug, title, description, excerpt, content, cover_image,
		       category, tags, author, read_time, status, published_at, created_at, updated_at
		FROM blog_posts WHERE id = $1`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	posts, err := scanBlogPosts(rows)
	if err != nil || len(posts) == 0 {
		return nil, err
	}
	return &posts[0], nil
}

// CreateBlogPost inserts a new blog post.
func (d *DB) CreateBlogPost(ctx context.Context, p BlogPost) (*BlogPost, error) {
	content := p.Content
	if len(content) == 0 {
		content = json.RawMessage("[]")
	}
	rows, err := d.Pool.Query(ctx, `
		INSERT INTO blog_posts (slug, title, description, excerpt, content, cover_image,
		                        category, tags, author, read_time, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING id, slug, title, description, excerpt, content, cover_image,
		          category, tags, author, read_time, status, published_at, created_at, updated_at`,
		p.Slug, p.Title, p.Description, p.Excerpt, content, p.CoverImage,
		p.Category, p.Tags, p.Author, p.ReadTime, p.Status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	posts, err := scanBlogPosts(rows)
	if err != nil || len(posts) == 0 {
		return nil, err
	}
	return &posts[0], nil
}

// UpdateBlogPost updates all editable fields of a post.
func (d *DB) UpdateBlogPost(ctx context.Context, p BlogPost) (*BlogPost, error) {
	content := p.Content
	if len(content) == 0 {
		content = json.RawMessage("[]")
	}
	rows, err := d.Pool.Query(ctx, `
		UPDATE blog_posts SET
		    slug=$2, title=$3, description=$4, excerpt=$5, content=$6,
		    cover_image=$7, category=$8, tags=$9, author=$10, read_time=$11,
		    updated_at=NOW()
		WHERE id=$1
		RETURNING id, slug, title, description, excerpt, content, cover_image,
		          category, tags, author, read_time, status, published_at, created_at, updated_at`,
		p.ID, p.Slug, p.Title, p.Description, p.Excerpt, content,
		p.CoverImage, p.Category, p.Tags, p.Author, p.ReadTime)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	posts, err := scanBlogPosts(rows)
	if err != nil || len(posts) == 0 {
		return nil, err
	}
	return &posts[0], nil
}

// PublishBlogPost sets a post's status to published.
func (d *DB) PublishBlogPost(ctx context.Context, id string) error {
	_, err := d.Pool.Exec(ctx, `
		UPDATE blog_posts
		SET status='published', published_at=COALESCE(published_at, NOW()), updated_at=NOW()
		WHERE id=$1`, id)
	return err
}

// UnpublishBlogPost sets a post's status to draft.
func (d *DB) UnpublishBlogPost(ctx context.Context, id string) error {
	_, err := d.Pool.Exec(ctx, `
		UPDATE blog_posts SET status='draft', updated_at=NOW() WHERE id=$1`, id)
	return err
}

// DeleteBlogPost removes a post.
func (d *DB) DeleteBlogPost(ctx context.Context, id string) error {
	_, err := d.Pool.Exec(ctx, `DELETE FROM blog_posts WHERE id=$1`, id)
	return err
}

func scanBlogPosts(rows interface {
	Next() bool
	Scan(...any) error
}) ([]BlogPost, error) {
	var posts []BlogPost
	for rows.Next() {
		var p BlogPost
		var tagsRaw []string
		if err := rows.Scan(
			&p.ID, &p.Slug, &p.Title, &p.Description, &p.Excerpt, &p.Content,
			&p.CoverImage, &p.Category, &tagsRaw, &p.Author, &p.ReadTime,
			&p.Status, &p.PublishedAt, &p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, err
		}
		p.Tags = tagsRaw
		if p.Tags == nil {
			p.Tags = []string{}
		}
		posts = append(posts, p)
	}
	return posts, nil
}
