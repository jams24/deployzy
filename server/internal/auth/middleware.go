package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/serverme/serverme/server/internal/db"
)

type contextKey string

const UserContextKey contextKey = "user"

// AuthenticatedUser represents the user extracted from auth.
type AuthenticatedUser struct {
	ID    string
	Email string
	Plan  string
	// Scope is the auth scope: "read" | "deploy" | "full". JWT (dashboard)
	// sessions are always "full"; API keys carry the scope they were created with.
	Scope string
}

// GetUser extracts the authenticated user from the request context.
func GetUser(r *http.Request) *AuthenticatedUser {
	u, _ := r.Context().Value(UserContextKey).(*AuthenticatedUser)
	return u
}

// scopeRank orders scopes: read(1) < deploy(2) < full(3). Empty/unknown → full
// for legacy safety only on the read floor; RequireScope treats unknown as 0.
func scopeRank(s string) int {
	switch s {
	case "read":
		return 1
	case "deploy":
		return 2
	case "full", "":
		return 3
	default:
		return 0
	}
}

// RequireScope rejects (403) any request whose auth scope is below the required
// level. Apply to mutating ("deploy") and account-sensitive ("full") routes.
func RequireScope(required string) func(http.Handler) http.Handler {
	need := scopeRank(required)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := GetUser(r)
			if u == nil || scopeRank(u.Scope) < need {
				http.Error(w, `{"error":"this API key lacks the required scope for this action"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// SmartAuthMiddleware handles both JWT (Authorization: Bearer) and API key (X-API-Key) auth.
func SmartAuthMiddleware(jwtMgr *JWTManager, database *db.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var user *AuthenticatedUser

			// Try JWT first (Authorization: Bearer <token>)
			if authHeader := r.Header.Get("Authorization"); authHeader != "" {
				if strings.HasPrefix(authHeader, "Bearer ") {
					tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
					claims, err := jwtMgr.Validate(tokenStr)
					if err == nil {
						user = &AuthenticatedUser{
							ID:    claims.UserID,
							Email: claims.Email,
							Plan:  claims.Plan,
							Scope: "full", // dashboard sessions have full access
						}
					}
				}
			}

			// Try API key (X-API-Key: sm_live_...)
			if user == nil {
				if apiKey := r.Header.Get("X-API-Key"); apiKey != "" {
					if strings.HasPrefix(apiKey, "sm_live_") {
						dbUser, scope, err := database.ValidateAPIKey(r.Context(), apiKey)
						if err == nil && dbUser != nil {
							user = &AuthenticatedUser{
								ID:    dbUser.ID,
								Email: dbUser.Email,
								Plan:  dbUser.Plan,
								Scope: scope,
							}
						}
					}
				}
			}

			if user == nil {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), UserContextKey, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// OptionalAuthMiddleware extracts auth if present but doesn't require it.
func OptionalAuthMiddleware(jwtMgr *JWTManager, database *db.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var user *AuthenticatedUser

			if authHeader := r.Header.Get("Authorization"); authHeader != "" {
				if strings.HasPrefix(authHeader, "Bearer ") {
					tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
					claims, err := jwtMgr.Validate(tokenStr)
					if err == nil {
						user = &AuthenticatedUser{
							ID:    claims.UserID,
							Email: claims.Email,
							Plan:  claims.Plan,
							Scope: "full",
						}
					}
				}
			}

			if user == nil {
				if apiKey := r.Header.Get("X-API-Key"); apiKey != "" {
					if strings.HasPrefix(apiKey, "sm_live_") {
						dbUser, scope, err := database.ValidateAPIKey(r.Context(), apiKey)
						if err == nil && dbUser != nil {
							user = &AuthenticatedUser{
								ID:    dbUser.ID,
								Email: dbUser.Email,
								Plan:  dbUser.Plan,
								Scope: scope,
							}
						}
					}
				}
			}

			if user != nil {
				ctx := context.WithValue(r.Context(), UserContextKey, user)
				r = r.WithContext(ctx)
			}

			next.ServeHTTP(w, r)
		})
	}
}
