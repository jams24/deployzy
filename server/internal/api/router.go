package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/deploy"
	"github.com/serverme/serverme/server/internal/db"
	"github.com/serverme/serverme/server/internal/inspect"
	"github.com/serverme/serverme/server/internal/notify"
	"github.com/serverme/serverme/server/internal/tunnel"
)

// GoogleOAuthConfig holds Google OAuth credentials.
type GoogleOAuthConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	FrontendURL  string
}

// Server holds dependencies for API handlers.
type Server struct {
	db                  *db.DB
	jwt                 *auth.JWTManager
	registry            *tunnel.Registry
	inspect             *inspect.Store
	google              *GoogleOAuthConfig
	telegram            *notify.TelegramBot
	telegramBotUsername string
	billing            *billing.InventPay
	deployer           *deploy.Engine
	log                 zerolog.Logger
}

// NewRouter creates the REST API router.
func NewRouter(database *db.DB, jwtMgr *auth.JWTManager, registry *tunnel.Registry, inspectStore *inspect.Store, google *GoogleOAuthConfig, telegramBot *notify.TelegramBot, telegramUsername string, billingClient *billing.InventPay, deployEngine *deploy.Engine, log zerolog.Logger) http.Handler {
	s := &Server{
		db:                  database,
		jwt:                 jwtMgr,
		registry:            registry,
		inspect:             inspectStore,
		google:              google,
		telegram:            telegramBot,
		telegramBotUsername: telegramUsername,
		billing:            billingClient,
		deployer:           deployEngine,
		log:                 log.With().Str("component", "api").Logger(),
	}

	r := chi.NewRouter()

	// Global middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(corsMiddleware)

	// Public routes
	r.Route("/api/v1", func(r chi.Router) {
		// Auth (no auth required)
		r.Post("/auth/register", s.handleRegister)
		r.Post("/auth/login", s.handleLogin)

		// Google OAuth
		r.Get("/auth/google", s.handleGoogleLogin)
		r.Get("/auth/google/callback", s.handleGoogleCallback)

		// Health
		r.Get("/health", s.handleHealth)

		// Protected routes
		r.Group(func(r chi.Router) {
			r.Use(auth.SmartAuthMiddleware(jwtMgr, database))

			// User
			r.Get("/users/me", s.handleGetMe)
			r.Delete("/users/me", s.handleDeleteMe)

			// API Keys
			r.Get("/api-keys", s.handleListAPIKeys)
			r.Post("/api-keys", s.handleCreateAPIKey)
			r.Delete("/api-keys/{id}", s.handleDeleteAPIKey)

			// Domains
			r.Get("/domains", s.handleListDomains)
			r.Post("/domains", s.handleCreateDomain)
			r.Delete("/domains/{id}", s.handleDeleteDomain)
			r.Post("/domains/{id}/verify", s.handleVerifyDomain)
			r.Put("/domains/{id}/bind", s.handleBindDomain)

			// Tunnels
			r.Get("/tunnels", s.handleListTunnels)

			// Inspection
			r.Get("/tunnels/{url}/requests", s.handleListRequests)
			r.Get("/tunnels/{url}/requests/{reqId}", s.handleGetRequest)
			r.Post("/tunnels/{url}/replay/{reqId}", s.handleReplayRequest)

			// Analytics
			r.Get("/analytics", s.handleAnalytics)

			// Teams
			r.Get("/teams", s.handleListTeams)
			r.Post("/teams", s.handleCreateTeam)
			r.Get("/teams/{teamId}", s.handleGetTeam)
			r.Delete("/teams/{teamId}", s.handleDeleteTeam)
			r.Post("/teams/{teamId}/invite", s.handleInviteMember)
			r.Delete("/teams/{teamId}/invitations/{inviteId}", s.handleCancelInvitation)
			r.Post("/invitations/{token}/accept", s.handleAcceptInvitation)
			r.Delete("/teams/{teamId}/members/{userId}", s.handleRemoveMember)
			r.Put("/teams/{teamId}/members/{userId}/role", s.handleUpdateMemberRole)

			// Telegram
			r.Post("/telegram/link", s.handleTelegramLinkCode)
			r.Get("/telegram/status", s.handleTelegramStatus)
			r.Put("/telegram/preferences", s.handleTelegramUpdatePrefs)
			r.Delete("/telegram", s.handleTelegramDisconnect)

			// Billing
			r.Post("/billing/checkout", s.handleCreateCheckout)
			r.Get("/billing/status", s.handleBillingStatus)
			r.Get("/billing/check", s.handleCheckPayment)

			// GitHub
			r.Get("/github/status", s.handleGitHubStatus)
			r.Post("/github/connect", s.handleGitHubSaveConnection)
			r.Delete("/github", s.handleGitHubDisconnect)
			r.Get("/github/repos", s.handleGitHubRepos)
			r.Get("/github/commits", s.handleGitHubCommits)

			// Deploy / Projects
			r.Get("/projects", s.handleListProjects)
			r.Post("/projects", s.handleCreateProject)
			r.Get("/projects/{projectId}", s.handleGetProject)
			r.Put("/projects/{projectId}", s.handleUpdateProject)
			r.Put("/projects/{projectId}/build-config", s.handleUpdateBuildConfig)
			r.Put("/projects/{projectId}/labels", s.handleUpdateLabels)
			r.Post("/projects/{projectId}/deploy", s.handleDeployProject)
			r.Put("/projects/{projectId}/auto-deploy", s.handleToggleAutoDeploy)
			r.Post("/projects/{projectId}/stop", s.handleStopProject)
			r.Delete("/projects/{projectId}", s.handleDeleteProject)
			r.Get("/projects/{projectId}/logs", s.handleGetDeployLogs)

			// Project Databases
			r.Post("/projects/{projectId}/database", s.handleCreateProjectDatabase)
			r.Get("/projects/{projectId}/database", s.handleGetProjectDatabase)
			r.Delete("/projects/{projectId}/database", s.handleDeleteProjectDatabase)

			// Database Backups
			r.Post("/projects/{projectId}/backups", s.handleCreateBackup)
			r.Get("/projects/{projectId}/backups", s.handleListBackups)
			r.Get("/projects/{projectId}/backups/{backupId}/download", s.handleDownloadBackup)
			r.Post("/projects/{projectId}/backups/{backupId}/restore", s.handleRestoreBackup)
			r.Delete("/projects/{projectId}/backups/{backupId}", s.handleDeleteBackup)
			r.Get("/projects/{projectId}/backup-schedule", s.handleGetBackupSchedule)
			r.Put("/projects/{projectId}/backup-schedule", s.handleUpdateBackupSchedule)

			// Subdomains
			r.Get("/subdomains", s.handleListSubdomains)
			r.Post("/subdomains", s.handleAddSubdomain)
			r.Delete("/subdomains", s.handleReleaseSubdomain)
			r.Get("/subdomains/check", s.handleCheckSubdomain)

			// Standalone Services (databases, Redis, etc.)
			r.Get("/services", s.handleListServices)
			r.Post("/services", s.handleCreateService)
			r.Get("/services/{serviceId}", s.handleGetService)
			r.Delete("/services/{serviceId}", s.handleDeleteService)

			// User BYOC Servers
			r.Get("/servers", s.handleListUserServers)
			r.Post("/servers", s.handleAddUserServer)
			r.Delete("/servers/{serverId}", s.handleDeleteUserServer)

			// Admin routes
			r.Route("/admin", func(r chi.Router) {
				r.Use(s.adminOnly)
				r.Get("/stats", s.handleAdminStats)
				r.Get("/users", s.handleAdminListUsers)
				r.Put("/users/{userId}", s.handleAdminUpdateUser)
				r.Delete("/users/{userId}", s.handleAdminDeleteUser)

				// Infrastructure management
				r.Get("/servers", s.handleAdminListServers)
				r.Post("/servers", s.handleAdminAddServer)
				r.Delete("/servers/{serverId}", s.handleAdminDeleteServer)
				r.Put("/servers/{serverId}/status", s.handleAdminUpdateServerStatus)
			})
		})
	})

	// Telegram webhook (public, no auth — Telegram sends here)
	r.Post("/api/v1/telegram/webhook", s.handleTelegramWebhook)

	// Billing webhook (public — InventPay sends here)
	r.Post("/api/v1/billing/webhook", s.handleBillingWebhook)

	// GitHub (public routes)
	r.Get("/api/v1/github/connect", s.handleGitHubConnect)
	r.Get("/api/v1/github/callback", s.handleGitHubCallback)
	r.Post("/api/v1/github/webhook", s.handleGitHubWebhook)

	// WebSocket (separate auth via query param)
	r.Get("/api/v1/ws/traffic/{url}", s.handleTrafficWebSocket)

	return r
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
