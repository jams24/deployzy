package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/db"
)

const blogUploadDir = "/opt/serverme-blog-uploads"

// ── Public blog endpoints ────────────────────────────────────────────────────

// handleListBlogPosts returns all published posts (public).
func (s *Server) handleListBlogPosts(w http.ResponseWriter, r *http.Request) {
	posts, err := s.db.ListPublishedBlogPosts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list posts")
		return
	}
	if posts == nil {
		posts = []db.BlogPost{}
	}
	writeJSON(w, http.StatusOK, posts)
}

// handleGetBlogPost returns a single published post by slug (public).
func (s *Server) handleGetBlogPost(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	post, err := s.db.GetBlogPostBySlug(r.Context(), slug)
	if err != nil || post == nil {
		writeError(w, http.StatusNotFound, "post not found")
		return
	}
	writeJSON(w, http.StatusOK, post)
}

// handleServeBlogImage serves an uploaded blog image (public).
func (s *Server) handleServeBlogImage(w http.ResponseWriter, r *http.Request) {
	filename := chi.URLParam(r, "filename")
	// Strip path traversal attempts
	filename = filepath.Base(filename)
	if strings.Contains(filename, "..") || filename == "" || filename == "." {
		writeError(w, http.StatusBadRequest, "invalid filename")
		return
	}
	path := filepath.Join(blogUploadDir, filename)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		writeError(w, http.StatusNotFound, "image not found")
		return
	}
	// Set a long cache header — images are content-addressed
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, path)
}

// ── Admin blog endpoints ─────────────────────────────────────────────────────

// handleAdminListBlogPosts returns all posts including drafts.
func (s *Server) handleAdminListBlogPosts(w http.ResponseWriter, r *http.Request) {
	posts, err := s.db.ListAllBlogPosts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list posts")
		return
	}
	if posts == nil {
		posts = []db.BlogPost{}
	}
	writeJSON(w, http.StatusOK, posts)
}

// handleAdminGetBlogPost returns a single post by ID.
func (s *Server) handleAdminGetBlogPost(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	post, err := s.db.GetBlogPostByID(r.Context(), id)
	if err != nil || post == nil {
		writeError(w, http.StatusNotFound, "post not found")
		return
	}
	writeJSON(w, http.StatusOK, post)
}

// handleAdminCreateBlogPost creates a new blog post.
func (s *Server) handleAdminCreateBlogPost(w http.ResponseWriter, r *http.Request) {
	var req db.BlogPost
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title required")
		return
	}
	if req.Slug == "" {
		req.Slug = slugify(req.Title)
	}
	if req.Status == "" {
		req.Status = "draft"
	}

	post, err := s.db.CreateBlogPost(r.Context(), req)
	if err != nil {
		s.log.Error().Err(err).Msg("create blog post")
		writeError(w, http.StatusInternalServerError, "failed to create post: "+err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, post)
}

// handleAdminUpdateBlogPost updates a post's content and metadata.
func (s *Server) handleAdminUpdateBlogPost(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req db.BlogPost
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	req.ID = id
	if req.Slug == "" {
		req.Slug = slugify(req.Title)
	}

	post, err := s.db.UpdateBlogPost(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update post: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, post)
}

// handleAdminPublishBlogPost publishes a post.
func (s *Server) handleAdminPublishBlogPost(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.db.PublishBlogPost(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to publish")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "published"})
}

// handleAdminUnpublishBlogPost reverts a post to draft.
func (s *Server) handleAdminUnpublishBlogPost(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.db.UnpublishBlogPost(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to unpublish")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "draft"})
}

// handleAdminDeleteBlogPost deletes a post.
func (s *Server) handleAdminDeleteBlogPost(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.db.DeleteBlogPost(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// handleAdminUploadBlogImage handles image uploads for blog posts.
// Accepts multipart/form-data with field "image".
// Returns {"url": "/api/v1/blog/images/{filename}"}
func (s *Server) handleAdminUploadBlogImage(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil { // 10 MB max
		writeError(w, http.StatusBadRequest, "file too large (max 10 MB)")
		return
	}
	file, header, err := r.FormFile("image")
	if err != nil {
		writeError(w, http.StatusBadRequest, "image field required")
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	allowed := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true, ".svg": true}
	if !allowed[ext] {
		writeError(w, http.StatusBadRequest, "only jpg, png, webp, gif, svg allowed")
		return
	}

	if err := os.MkdirAll(blogUploadDir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "cannot create upload dir")
		return
	}

	filename := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	dest := filepath.Join(blogUploadDir, filename)
	out, err := os.Create(dest)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "cannot save file")
		return
	}
	defer out.Close()

	if _, err := io.Copy(out, file); err != nil {
		writeError(w, http.StatusInternalServerError, "write failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"url":      fmt.Sprintf("/api/v1/blog/images/%s", filename),
		"filename": filename,
	})
}

// slugify converts a title to a URL-safe slug.
func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	prevDash := false
	for _, r := range s {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			prevDash = false
		case r == ' ' || r == '-' || r == '_':
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	result := strings.TrimRight(b.String(), "-")
	if result == "" {
		result = fmt.Sprintf("post-%d", time.Now().UnixNano())
	}
	return result
}
