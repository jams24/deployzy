package api

import (
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	cf "github.com/serverme/serverme/server/internal/cloudflare"
	"github.com/serverme/serverme/server/internal/control"
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
	emailSvc            *notify.EmailService
	billing             *billing.InventPay
	polar               *billing.Polar // nil when card payments not configured
	deployer            *deploy.Engine
	ctrlManager         *control.Manager
	cfDNS               *cf.Client // nil when Cloudflare token not configured
	cfDomain            string     // base domain for auto-DNS (e.g. "deployzy.com")
	log                 zerolog.Logger
	cliPending          sync.Map // cli_state -> JWT token (set after OAuth, consumed by poll)
}

// NewRouter creates the REST API router.
func NewRouter(database *db.DB, jwtMgr *auth.JWTManager, registry *tunnel.Registry, inspectStore *inspect.Store, google *GoogleOAuthConfig, telegramBot *notify.TelegramBot, telegramUsername string, emailSvc *notify.EmailService, billingClient *billing.InventPay, polarClient *billing.Polar, deployEngine *deploy.Engine, ctrlManager *control.Manager, cfClient *cf.Client, cfDomain string, log zerolog.Logger) http.Handler {
	s := &Server{
		db:                  database,
		jwt:                 jwtMgr,
		registry:            registry,
		inspect:             inspectStore,
		google:              google,
		telegram:            telegramBot,
		telegramBotUsername: telegramUsername,
		emailSvc:            emailSvc,
		billing:             billingClient,
		polar:               polarClient,
		deployer:            deployEngine,
		ctrlManager:         ctrlManager,
		cfDNS:               cfClient,
		cfDomain:            cfDomain,
		log:                 log.With().Str("component", "api").Logger(),
	}

	r := chi.NewRouter()

	// Global middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(corsMiddleware)

	// Rate limiters for unauthenticated endpoints — blocks brute-force
	// password attempts and signup spam from a single IP. Per-IP, sliding
	// 1-minute window, 10 hits max (generous enough for legit users that
	// mistyped a password a few times).
	authRateLimiter := newIPRateLimiter(10, 1*time.Minute)

	// Public routes
	r.Route("/api/v1", func(r chi.Router) {
		// Auth (no auth required) — rate limited per IP
		r.Group(func(r chi.Router) {
			r.Use(rateLimitMiddleware(authRateLimiter))
			r.Post("/auth/register", s.handleRegister)
			r.Post("/auth/login", s.handleLogin)
			r.Post("/auth/verify-email", s.handleVerifyEmail)
			r.Post("/auth/resend-verification", s.handleResendVerification)
		})

		// Google OAuth
		r.Get("/auth/google", s.handleGoogleLogin)
		r.Get("/auth/google/callback", s.handleGoogleCallback)
		r.Get("/auth/poll/{state}", s.handleAuthPoll)

		// Health
		r.Get("/health", s.handleHealth)

		// Protected routes
		r.Group(func(r chi.Router) {
			r.Use(auth.SmartAuthMiddleware(jwtMgr, database))

			// Scope guards: read < deploy < full. JWT sessions are full; API
			// keys carry their own scope. GETs need only read (the floor, so no
			// guard); mutations need deploy; account/key/billing/team management
			// needs full so a leaked deploy key can't escalate or nuke the account.
			deployScope := auth.RequireScope("deploy")
			fullScope := auth.RequireScope("full")

			// User
			r.Get("/users/me", s.handleGetMe)
			r.Get("/users/me/limits", s.handleGetMyLimits)
			r.With(fullScope).Delete("/users/me", s.handleDeleteMe)

			// Referrals
			r.Get("/referrals", s.handleGetReferrals)

			// Webhooks (account-level outgoing webhooks)
			r.Get("/webhooks", s.handleListWebhooks)
			r.With(fullScope).Post("/webhooks", s.handleCreateWebhook)
			r.With(fullScope).Put("/webhooks/{id}", s.handleUpdateWebhook)
			r.With(fullScope).Delete("/webhooks/{id}", s.handleDeleteWebhook)
			r.With(fullScope).Post("/webhooks/{id}/test", s.handleTestWebhook)

			// API Keys
			r.Get("/api-keys", s.handleListAPIKeys)
			r.With(fullScope).Post("/api-keys", s.handleCreateAPIKey)
			r.With(fullScope).Delete("/api-keys/{id}", s.handleDeleteAPIKey)

			// Domains
			r.Get("/domains", s.handleListDomains)
			r.With(deployScope).Post("/domains", s.handleCreateDomain)
			r.With(deployScope).Delete("/domains/{id}", s.handleDeleteDomain)
			r.With(deployScope).Post("/domains/{id}/verify", s.handleVerifyDomain)
			r.With(deployScope).Put("/domains/{id}/bind", s.handleBindDomain)

			// Tunnels
			r.Get("/tunnels", s.handleListTunnels)

			// Inspection
			r.Get("/tunnels/{url}/requests", s.handleListRequests)
			r.Get("/tunnels/{url}/requests/{reqId}", s.handleGetRequest)
			r.Post("/tunnels/{url}/replay/{reqId}", s.handleReplayRequest)

			// Analytics
			r.Get("/analytics", s.handleAnalytics)

			// Teams (account-level → full)
			r.Get("/teams", s.handleListTeams)
			r.With(fullScope).Post("/teams", s.handleCreateTeam)
			r.Get("/teams/{teamId}", s.handleGetTeam)
			r.With(fullScope).Delete("/teams/{teamId}", s.handleDeleteTeam)
			r.With(fullScope).Post("/teams/{teamId}/invite", s.handleInviteMember)
			r.With(fullScope).Delete("/teams/{teamId}/invitations/{inviteId}", s.handleCancelInvitation)
			r.With(fullScope).Post("/invitations/{token}/accept", s.handleAcceptInvitation)
			r.With(fullScope).Delete("/teams/{teamId}/members/{userId}", s.handleRemoveMember)
			r.With(fullScope).Put("/teams/{teamId}/members/{userId}/role", s.handleUpdateMemberRole)

			// Telegram (account-level → full)
			r.With(fullScope).Post("/telegram/link", s.handleTelegramLinkCode)
			r.Get("/telegram/status", s.handleTelegramStatus)
			r.With(fullScope).Put("/telegram/preferences", s.handleTelegramUpdatePrefs)
			r.With(fullScope).Delete("/telegram", s.handleTelegramDisconnect)

			// Billing (account-level → full)
			r.With(fullScope).Post("/billing/checkout", s.handleCreateCheckout)
			r.Get("/billing/status", s.handleBillingStatus)
			r.Get("/billing/check", s.handleCheckPayment)

			// GitHub (connection is account-level → full; repo/commit reads are read)
			r.Get("/github/status", s.handleGitHubStatus)
			r.With(fullScope).Post("/github/connect", s.handleGitHubSaveConnection)
			r.With(fullScope).Delete("/github", s.handleGitHubDisconnect)
			r.Get("/github/repos", s.handleGitHubRepos)
			r.Get("/github/commits", s.handleGitHubCommits)
			r.Get("/github/contents", s.handleGitHubContents)

			// Deploy / Projects
			r.Get("/projects", s.handleListProjects)
			r.With(deployScope).Post("/projects", s.handleCreateProject)
			r.Get("/projects/{projectId}", s.handleGetProject)
			r.With(deployScope).Put("/projects/{projectId}", s.handleUpdateProject)
			r.With(deployScope).Put("/projects/{projectId}/build-config", s.handleUpdateBuildConfig)
			r.With(deployScope).Put("/projects/{projectId}/labels", s.handleUpdateLabels)
			// Preview deployments (one-per-PR)
			r.Get("/projects/{projectId}/previews", s.handleListPreviews)
			r.With(deployScope).Put("/projects/{projectId}/preview-enabled", s.handleTogglePreviewEnabled)
			// Metrics
			r.Get("/projects/{projectId}/metrics", s.handleGetMetrics)
			r.Get("/projects/{projectId}/bandwidth", s.handleGetBandwidth)
			// Site analytics (server-side, cookieless)
			r.Get("/projects/{projectId}/analytics", s.handleSiteOverview)
			r.Get("/projects/{projectId}/analytics/top", s.handleSiteTop)
			// Cron jobs
			r.Get("/projects/{projectId}/crons", s.handleListCrons)
			r.With(deployScope).Post("/projects/{projectId}/crons", s.handleCreateCron)
			r.With(deployScope).Put("/projects/{projectId}/crons/{cronId}", s.handleUpdateCron)
			r.With(deployScope).Delete("/projects/{projectId}/crons/{cronId}", s.handleDeleteCron)
			r.With(deployScope).Post("/projects/{projectId}/upload", s.handleUploadProject)
			r.With(deployScope).Post("/projects/{projectId}/deploy", s.handleDeployProject)
			r.With(deployScope).Post("/projects/{projectId}/move", s.handleMoveProject)
			r.With(deployScope).Put("/projects/{projectId}/auto-deploy", s.handleToggleAutoDeploy)
			r.With(deployScope).Post("/projects/{projectId}/stop", s.handleStopProject)
			r.With(deployScope).Delete("/projects/{projectId}", s.handleDeleteProject)
			r.Get("/projects/{projectId}/logs", s.handleGetDeployLogs)

			// Project Databases
			r.With(deployScope).Post("/projects/{projectId}/database", s.handleCreateProjectDatabase)
			// Database editor — SQL runner + table browser (query mutates → deploy)
			r.With(deployScope).Post("/projects/{projectId}/database/query", s.handleProjectDatabaseQuery)
			r.Get("/projects/{projectId}/database/tables", s.handleProjectDatabaseTables)
			r.Get("/projects/{projectId}/database/tables/{table}/columns", s.handleProjectDatabaseTableColumns)
			r.Get("/projects/{projectId}/database/tables/{table}/rows", s.handleProjectDatabaseTableRows)
			r.With(deployScope).Post("/services/{serviceId}/query", s.handleServiceQuery)
			r.Get("/services/{serviceId}/tables", s.handleServiceTables)
			r.Get("/services/{serviceId}/tables/{table}/columns", s.handleServiceTableColumns)
			r.Get("/services/{serviceId}/tables/{table}/rows", s.handleServiceTableRows)
			// Redis browser
			r.Get("/services/{serviceId}/redis/keys", s.handleRedisKeys)
			r.Post("/services/{serviceId}/redis/exec", s.handleRedisExec)
			r.Get("/services/{serviceId}/redis/value", s.handleRedisGetValue)
			r.With(deployScope).Put("/services/{serviceId}/redis/value", s.handleRedisSetValue)
			r.With(deployScope).Delete("/services/{serviceId}/redis/value", s.handleRedisDelValue)
			// MongoDB browser
			r.Get("/services/{serviceId}/mongo/collections", s.handleMongoCollections)
			r.Get("/services/{serviceId}/mongo/documents", s.handleMongoDocs)
			r.With(deployScope).Post("/services/{serviceId}/mongo/documents", s.handleMongoInsertDoc)
			r.With(deployScope).Put("/services/{serviceId}/mongo/documents", s.handleMongoUpdateDoc)
			r.With(deployScope).Delete("/services/{serviceId}/mongo/documents", s.handleMongoDeleteDoc)
			r.Post("/services/{serviceId}/mongo/shell", s.handleMongoShell)
			r.Get("/projects/{projectId}/database", s.handleGetProjectDatabase)
			r.With(deployScope).Delete("/projects/{projectId}/database", s.handleDeleteProjectDatabase)

			// Database Backups
			r.With(deployScope).Post("/projects/{projectId}/backups", s.handleCreateBackup)
			r.Get("/projects/{projectId}/backups", s.handleListBackups)
			r.Get("/projects/{projectId}/backups/{backupId}/download", s.handleDownloadBackup)
			r.With(deployScope).Post("/projects/{projectId}/backups/{backupId}/restore", s.handleRestoreBackup)
			r.With(deployScope).Delete("/projects/{projectId}/backups/{backupId}", s.handleDeleteBackup)
			r.Get("/projects/{projectId}/backup-schedule", s.handleGetBackupSchedule)
			r.With(deployScope).Put("/projects/{projectId}/backup-schedule", s.handleUpdateBackupSchedule)

			// Subdomains
			r.Get("/subdomains", s.handleListSubdomains)
			r.With(deployScope).Post("/subdomains", s.handleAddSubdomain)
			r.With(deployScope).Delete("/subdomains", s.handleReleaseSubdomain)
			r.Get("/subdomains/check", s.handleCheckSubdomain)

			// Unified database list — standalone services + per-project DBs
			// (used by the Services page since we removed the project-level DB UI).
			r.Get("/databases", s.handleListAllDatabases)

			// Standalone Services (databases, Redis, etc.)
			r.Get("/services", s.handleListServices)
			r.With(deployScope).Post("/services", s.handleCreateService)
			r.Get("/services/{serviceId}", s.handleGetService)
			r.With(deployScope).Delete("/services/{serviceId}", s.handleDeleteService)

			// Templates — star and deploy require auth
			r.Post("/templates/{slug}/star", s.handleToggleTemplateStar)
			r.With(deployScope).Post("/templates/{slug}/deploy", s.handleDeployFromTemplate)

			// Servers a user may deploy to (platform regions + own BYOC)
			r.Get("/servers/selectable", s.handleListSelectableServers)

			// User BYOC Servers (account-level infra → full)
			r.Get("/servers", s.handleListUserServers)
			r.With(fullScope).Post("/servers", s.handleAddUserServer)
			r.With(fullScope).Delete("/servers/{serverId}", s.handleDeleteUserServer)
			r.With(fullScope).Post("/servers/{serverId}/install-docker", s.handleInstallDocker)

			// Admin routes
			r.Route("/admin", func(r chi.Router) {
				r.Use(s.adminOnly)
				r.Get("/stats", s.handleAdminStats)
				r.Get("/users", s.handleAdminListUsers)
				r.Put("/users/{userId}", s.handleAdminUpdateUser)
				r.Delete("/users/{userId}", s.handleAdminDeleteUser)
				r.Post("/redeploy-all", s.handleAdminRedeployAll)

				// Infrastructure management
				r.Get("/servers", s.handleAdminListServers)
				r.Post("/servers", s.handleAdminAddServer)
				r.Delete("/servers/{serverId}", s.handleAdminDeleteServer)
				r.Put("/servers/{serverId}/status", s.handleAdminUpdateServerStatus)
				r.Put("/servers/{serverId}/selectable", s.handleAdminSetServerSelectable)
				// Live sessions
				r.Get("/sessions", s.handleAdminListSessions)
				r.Delete("/sessions/{clientId}", s.handleAdminKillSession)
				r.Delete("/tunnels/{encodedURL}", s.handleAdminKillTunnel)

				// Project management across all users
				r.Get("/projects", s.handleAdminListProjects)
				r.Get("/plans", s.handleAdminListPlans)
				r.Put("/plans/{plan}", s.handleAdminUpdatePlan)
				r.Get("/analytics", s.handleAdminAnalytics)
				r.Get("/projects/{projectId}/diagnostics", s.handleAdminProjectDiagnostics)
				r.Post("/projects/{projectId}/stop", s.handleAdminStopProject)
				r.Post("/projects/{projectId}/redeploy", s.handleAdminRedeployProject)
				r.Delete("/projects/{projectId}", s.handleAdminDeleteProject)

				// Platform backups (admin only)
				r.Get("/backups", s.handleListPlatformBackups)
				r.Post("/backups/run", s.handleRunPlatformBackup)
				r.Delete("/backups/{timestamp}", s.handleDeletePlatformBackup)
				r.Get("/backups/file/{filename}", s.handleDownloadPlatformBackup)

				// Email broadcasts (admin only)
				r.Get("/broadcast/preview", s.handleAdminBroadcastPreview)
				r.Post("/broadcast", s.handleAdminBroadcast)

				// Templates admin (admin only)
				r.Get("/templates", s.handleAdminListTemplates)
				r.Post("/templates", s.handleAdminCreateTemplate)
				r.Put("/templates/{templateId}", s.handleAdminUpdateTemplate)
				r.Delete("/templates/{templateId}", s.handleAdminDeleteTemplate)

				// Blog admin (admin only)
				r.Get("/blog/posts", s.handleAdminListBlogPosts)
				r.Get("/blog/posts/{id}", s.handleAdminGetBlogPost)
				r.Post("/blog/posts", s.handleAdminCreateBlogPost)
				r.Put("/blog/posts/{id}", s.handleAdminUpdateBlogPost)
				r.Delete("/blog/posts/{id}", s.handleAdminDeleteBlogPost)
				r.Post("/blog/posts/{id}/publish", s.handleAdminPublishBlogPost)
				r.Post("/blog/posts/{id}/unpublish", s.handleAdminUnpublishBlogPost)
				r.Post("/blog/upload", s.handleAdminUploadBlogImage)
			})
		})
	})

	// Public blog routes (no auth)
	r.Get("/api/v1/blog/posts", s.handleListBlogPosts)
	r.Get("/api/v1/blog/posts/{slug}", s.handleGetBlogPost)

	// Templates — list/detail public with optional auth for star state; star/deploy require login
	r.With(auth.OptionalAuthMiddleware(jwtMgr, database)).Get("/api/v1/templates", s.handleListTemplates)
	r.Get("/api/v1/templates/categories", s.handleListTemplateCategories)
	r.With(auth.OptionalAuthMiddleware(jwtMgr, database)).Get("/api/v1/templates/{slug}", s.handleGetTemplate)
	r.Get("/api/v1/blog/images/{filename}", s.handleServeBlogImage)

	// Telegram webhook (public, no auth — Telegram sends here)
	r.Post("/api/v1/telegram/webhook", s.handleTelegramWebhook)

	// Billing webhooks (public — payment providers call these; both verify
	// signatures and reject unsigned payloads)
	r.Post("/api/v1/billing/webhook", s.handleBillingWebhook)
	r.Post("/api/v1/billing/webhook/polar", s.handlePolarWebhook)

	// GitHub (public routes)
	r.Get("/api/v1/github/connect", s.handleGitHubConnect)
	r.Get("/api/v1/github/callback", s.handleGitHubCallback)
	r.Post("/api/v1/github/webhook", s.handleGitHubWebhook)

	// WebSocket (separate auth via query param)
	r.Get("/api/v1/ws/traffic/{url}", s.handleTrafficWebSocket)
	r.Get("/api/v1/ws/projects/{projectId}/logs", s.handleProjectLogsWS)

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
