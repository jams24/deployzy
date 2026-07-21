package main

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/proto"
	"github.com/serverme/serverme/server/internal/api"
	"github.com/serverme/serverme/server/internal/auth"
	cf "github.com/serverme/serverme/server/internal/cloudflare"
	"github.com/serverme/serverme/server/internal/control"
	"github.com/serverme/serverme/server/internal/db"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/deploy"
	"github.com/serverme/serverme/server/internal/analytics"
	"github.com/serverme/serverme/server/internal/inspect"
	"github.com/serverme/serverme/server/internal/notify"
	"github.com/serverme/serverme/server/internal/policy"
	"github.com/serverme/serverme/server/internal/proxy"
	"github.com/serverme/serverme/server/internal/tunnel"
	"github.com/xtaci/smux"
)

func main() {
	// Flags
	domain := flag.String("domain", "localhost", "Base domain for tunnels (e.g., serverme.dev)")
	controlAddr := flag.String("addr", ":8443", "Control/tunnel listener address (TLS)")
	httpAddr := flag.String("http-addr", ":8080", "HTTP proxy listener address")
	apiAddr := flag.String("api-addr", ":8081", "REST API listener address")
	tlsCert := flag.String("tls-cert", "", "TLS certificate file")
	tlsKey := flag.String("tls-key", "", "TLS private key file")
	authToken := flag.String("auth-token", "dev-token", "Required auth token for clients (legacy, use DB auth in production)")
	jwtSecret := flag.String("jwt-secret", "serverme-dev-secret-change-me", "JWT signing secret")
	databaseURL := flag.String("database-url", "", "PostgreSQL connection URL (optional, enables user auth)")
	googleClientID := flag.String("google-client-id", "", "Google OAuth Client ID")
	googleClientSecret := flag.String("google-client-secret", "", "Google OAuth Client Secret")
	frontendURL := flag.String("frontend-url", "https://deployzy.com", "Frontend URL for OAuth redirects")
	telegramToken := flag.String("telegram-token", "", "Telegram bot token")
	brevoSMTPKey := flag.String("brevo-smtp-key", "", "Brevo SMTP key for transactional email")
	inventpayKey := flag.String("inventpay-key", "", "InventPay API key")
	githubAppID := flag.String("github-app-id", "", "GitHub App ID")
	githubClientID := flag.String("github-client-id", "", "GitHub App Client ID")
	githubClientSecret := flag.String("github-client-secret", "", "GitHub App Client Secret")
	githubWebhookSecret := flag.String("github-webhook-secret", "", "GitHub App Webhook Secret")
	githubPrivateKey := flag.String("github-private-key", "", "GitHub App Private Key PEM file path")
	inventpayWebhookSecret := flag.String("inventpay-webhook-secret", "", "InventPay webhook secret")
	polarToken := flag.String("polar-token", "", "Polar.sh access token (card payments)")
	polarWebhookSecret := flag.String("polar-webhook-secret", "", "Polar.sh webhook signing secret")
	polarHobbyProduct := flag.String("polar-hobby-product", "", "Polar product ID for the Hobby plan")
	polarProProduct := flag.String("polar-pro-product", "", "Polar product ID for the Pro plan")
	polarTeamProduct := flag.String("polar-team-product", "", "Polar product ID for the Team plan")
	polarSandbox := flag.Bool("polar-sandbox", false, "Use the Polar sandbox API")
	telegramBotUsername := flag.String("telegram-bot", "serverme_alerts_bot", "Telegram bot username")
	logLevel := flag.String("log-level", "info", "Log level (debug, info, warn, error)")
	serviceHost := flag.String("service-host", "", "Public hostname/IP for TCP services (DB, Redis). Defaults to --domain if unset. Override when --domain is behind a proxy like Cloudflare that blocks non-HTTP ports.")
	cfToken := flag.String("cloudflare-token", "", "Cloudflare API token (DNS edit permission) for auto-creating DNS records when servers are added")
	cfZoneID := flag.String("cloudflare-zone-id", "", "Cloudflare Zone ID for the base domain")
	flag.Parse()

	// Logger
	level, _ := zerolog.ParseLevel(*logLevel)
	log := zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339}).
		With().Timestamp().Logger().Level(level)

	log.Info().
		Str("version", proto.Version).
		Str("domain", *domain).
		Str("control_addr", *controlAddr).
		Str("http_addr", *httpAddr).
		Str("api_addr", *apiAddr).
		Msg("Deployzy server starting")

	// Components
	registry := tunnel.NewRegistry()
	manager := control.NewManager(log)
	var inspectStore *inspect.Store // initialized after DB
	var httpProxy *proxy.HTTPProxy  // initialized after inspectStore
	tcpProxy := proxy.NewTCPProxy(registry, manager, log)
	_ = proxy.NewTLSProxy(registry, manager, log)
	_ = policy.NewRateLimiter(20, 40) // default rate limiter
	startTime := time.Now()

	// Determine scheme and server host
	scheme := "https"
	if *tlsCert == "" {
		scheme = "http"
	}
	serverHost := *domain

	// JWT manager
	jwtMgr := auth.NewJWTManager(*jwtSecret, 30*24*time.Hour)

	// Database (optional)
	var database *db.DB
	if *databaseURL != "" {
		ctx := context.Background()
		var err error
		database, err = db.New(ctx, *databaseURL, log)
		if err != nil {
			log.Fatal().Err(err).Msg("failed to connect to database")
		}
		defer database.Close()
		log.Info().Msg("database connected, user auth enabled")
	} else {
		log.Warn().Msg("no database URL provided, running without user auth (dev mode)")
	}

	// Initialize inspect store and HTTP proxy (after DB is available)
	inspectStore = inspect.NewStore(database, log)
	httpProxy = proxy.NewHTTPProxy(registry, manager, inspectStore, log)

	// Site analytics collector — captures every request to a deployed project
	// for dashboards. Non-blocking; drops events if saturated.
	analyticsCollector := analytics.New(database.Pool, log)
	go analyticsCollector.Start(context.Background())
	httpProxy.SetAnalytics(analyticsCollector)
	// Unified retention sweeper — runs every hour, covers everything that
	// can grow unboundedly (analytics events, deploy logs, captured tunnel
	// requests, abandoned build dirs). Keeps disk/DB usage predictable
	// without needing manual intervention.
	go func() {
		run := func() {
			ctx := context.Background()
			now := time.Now()
			// Site analytics: 90-day retention (privacy + usefulness window).
			if err := database.PruneOldSiteEvents(ctx, now.AddDate(0, 0, -90)); err != nil {
				log.Warn().Err(err).Msg("prune site_events failed")
			}
			// Deploy logs: 14-day retention per project — most useful during a
			// recent build; older rows are just noise.
			if n, err := database.PruneOldDeployLogs(ctx, now.AddDate(0, 0, -14)); err != nil {
				log.Warn().Err(err).Msg("prune deploy_logs failed")
			} else if n > 0 {
				log.Debug().Int64("rows", n).Msg("pruned deploy_logs")
			}
			// Captured inspector requests: 7-day retention — bodies can be
			// large (up to 10KB each); keeping a week is plenty for debugging.
			if n, err := database.PruneOldCapturedRequests(ctx, now.AddDate(0, 0, -7)); err != nil {
				log.Warn().Err(err).Msg("prune captured_requests failed")
			} else if n > 0 {
				log.Debug().Int64("rows", n).Msg("pruned captured_requests")
			}
			// Lapsed subscriptions: mark expired and downgrade users whose
			// paid period ended back to free. Only touches users whose plan
			// came from a subscription — admin grants and referral rewards
			// are untouched.
			if n, err := database.SweepExpiredSubscriptions(ctx); err != nil {
				log.Warn().Err(err).Msg("subscription expiry sweep failed")
			} else if n > 0 {
				log.Info().Int64("users", n).Msg("downgraded users with expired subscriptions")
			}
			// Abandoned build dirs — cleaned on successful deploy, but a
			// crashed/interrupted build leaves /tmp/serverme-build/<id>/
			// behind. Remove anything older than 24h on the control plane
			// AND on every active worker (both platform and BYOC).
			pruneAbandonedBuildDirs(log)
			pruneAbandonedBuildDirsOnWorkers(ctx, database, log)
		}
		// Run once at startup so a freshly-started server immediately reclaims
		// anything an older version left behind.
		run()
		t := time.NewTicker(1 * time.Hour)
		defer t.Stop()
		for range t.C {
			run()
		}
	}()

	// Context for graceful shutdown
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Signal handling
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// Start HTTP proxy server (public-facing, for tunnel traffic)
	httpMux := http.NewServeMux()
	httpMux.HandleFunc("/health", proxy.HealthHandler(startTime))
	httpMux.Handle("/", httpProxy)

	httpServer := &http.Server{
		Addr:         *httpAddr,
		Handler:      httpMux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Info().Str("addr", *httpAddr).Msg("HTTP proxy listening")
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("HTTP server error")
		}
	}()

	// Start REST API server (for dashboard/SDK)
	if database != nil {
		var googleCfg *api.GoogleOAuthConfig
		if *googleClientID != "" {
			googleCfg = &api.GoogleOAuthConfig{
				ClientID:     *googleClientID,
				ClientSecret: *googleClientSecret,
				RedirectURL:  fmt.Sprintf("https://api.%s/api/v1/auth/google/callback", *domain),
				FrontendURL:  *frontendURL,
			}
			log.Info().Msg("Google OAuth enabled")
		}

		// Telegram bot
		var telegramBot *notify.TelegramBot
		if *telegramToken != "" {
			telegramBot = notify.NewTelegramBot(*telegramToken, log)
			webhookURL := fmt.Sprintf("https://api.%s/api/v1/telegram/webhook", *domain)
			if err := telegramBot.SetWebhook(webhookURL); err != nil {
				log.Warn().Err(err).Msg("failed to set telegram webhook")
			} else {
				log.Info().Msg("Telegram bot enabled")
			}
		}

		// Email service (Brevo SMTP)
		var emailSvc *notify.EmailService
		if *brevoSMTPKey != "" {
			emailSvc = notify.NewEmailService(
				"smtp-relay.brevo.com", "587",
				"9988d2001@smtp-brevo.com", *brevoSMTPKey,
				"noreply@deployzy.com", "Deployzy",
				log,
			)
			log.Info().Msg("Brevo email service enabled")
		}

		// Billing
		var billingClient *billing.InventPay
		if *inventpayKey != "" {
			billingClient = billing.NewInventPay(*inventpayKey, *inventpayWebhookSecret)
			log.Info().Msg("InventPay billing enabled")
		}
		var polarClient *billing.Polar
		if *polarToken != "" {
			products := map[string]string{}
			if *polarHobbyProduct != "" {
				products["hobby"] = *polarHobbyProduct
			}
			if *polarProProduct != "" {
				products["pro"] = *polarProProduct
			}
			if *polarTeamProduct != "" {
				products["team"] = *polarTeamProduct
			}
			polarClient = billing.NewPolar(*polarToken, *polarWebhookSecret, products, *polarSandbox)
			log.Info().Bool("sandbox", *polarSandbox).Int("products", len(products)).Msg("Polar card billing enabled")
		}

		// Deploy engine
		var deployEngine *deploy.Engine
		if database != nil {
			// GitHub App
			var githubApp *deploy.GitHubApp
			if *githubAppID != "" && *githubPrivateKey != "" {
				var err error
				githubApp, err = deploy.NewGitHubApp(*githubAppID, *githubClientID, *githubClientSecret, *githubWebhookSecret, *githubPrivateKey, log)
				if err != nil {
					log.Warn().Err(err).Msg("GitHub App init failed")
				} else {
					log.Info().Msg("GitHub App enabled")
				}
			}
			svcHost := *serviceHost
		if svcHost == "" {
			svcHost = *domain
		}
		deployEngine = deploy.NewEngine(database, *domain, svcHost, githubApp, emailSvc, log)
			// Reset any projects stuck in "building" from a previous process that was
			// killed mid-deploy — otherwise they'd show as building forever.
			if n, err := database.ResetStuckBuilds(context.Background()); err != nil {
				log.Warn().Err(err).Msg("reset stuck builds failed")
			} else if n > 0 {
				log.Info().Int64("count", n).Msg("reset stuck 'building' projects to 'failed'")
			}
			log.Info().Msg("Deploy engine enabled")
			httpProxy.SetProjectLookup(deployEngine)
		}

		// Enable custom domain routing
		httpProxy.SetDomainResolver(proxy.NewDBDomainResolver(database), *domain)

		// Start backup scheduler
		backupScheduler := deploy.NewBackupScheduler(database, log)
		go backupScheduler.Start(context.Background())

		// Start cron scheduler (only once a deploy engine is available — crons
		// run inside the project's built image and need the engine's runner).
		if deployEngine != nil {
			cronScheduler := deploy.NewCronScheduler(database, deployEngine, log)
			go cronScheduler.Start(context.Background())

			// Metrics scraper also needs the engine's runner.
			metricsScraper := deploy.NewMetricsScraper(database, deployEngine, log)
			go metricsScraper.Start(context.Background())

			// DB quota sweeper — enforces per-plan Postgres disk caps on
			// standalone services. Revokes INSERT/UPDATE when over quota.
			dbQuotaSweeper := deploy.NewDBQuotaSweeper(database, log)
			go dbQuotaSweeper.Start(context.Background())

			// Worker-health monitor: pings every active worker periodically
			// and marks dead ones offline so SelectServerForProject can't
			// schedule new deploys onto them. Also updates last_heartbeat
			// so admins can see at a glance when a worker was last alive.
			go monitorWorkerHealth(context.Background(), database, log)

			// Refresh the local platform row with real hardware values so the
			// scheduler knows what's actually available on this host.
			go refreshLocalServerCapacity(context.Background(), database, log)

			// Crash sweeper: containers deploy with --restart on-failure:5,
			// so a broken app stops instead of restart-looping forever. This
			// flips such projects to 'crashed' in the dashboard every 2 min.
			go func() {
				t := time.NewTicker(2 * time.Minute)
				defer t.Stop()
				for range t.C {
					deployEngine.SweepCrashedContainers(context.Background())
				}
			}()
		}

		cfClient := cf.New(*cfToken, *cfZoneID)
		apiRouter := api.NewRouter(database, jwtMgr, registry, inspectStore, googleCfg, telegramBot, *telegramBotUsername, emailSvc, billingClient, polarClient, deployEngine, manager, cfClient, *domain, log)
		apiServer := &http.Server{
			Addr:         *apiAddr,
			Handler:      apiRouter,
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 30 * time.Second,
			IdleTimeout:  120 * time.Second,
		}

		go func() {
			log.Info().Str("addr", *apiAddr).Msg("REST API listening")
			if err := apiServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Fatal().Err(err).Msg("API server error")
			}
		}()
	}

	// Start TLS control listener
	go func() {
		if err := listenControl(*controlAddr, *tlsCert, *tlsKey, *authToken, *domain, scheme, serverHost, registry, manager, tcpProxy, database, jwtMgr, log); err != nil {
			log.Fatal().Err(err).Msg("control listener error")
		}
	}()

	// Wait for shutdown signal
	sig := <-sigCh
	log.Info().Str("signal", sig.String()).Msg("shutting down")
	cancel()

	// Graceful shutdown
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	httpServer.Shutdown(shutdownCtx)
	manager.CloseAll()

	log.Info().Msg("server stopped")
}

func listenControl(addr, certFile, keyFile, authToken, domain, scheme, serverHost string, registry *tunnel.Registry, manager *control.Manager, tcpProxy *proxy.TCPProxy, database *db.DB, jwtMgr *auth.JWTManager, log zerolog.Logger) error {
	var listener net.Listener
	var err error

	if certFile != "" && keyFile != "" {
		cert, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return fmt.Errorf("load TLS cert: %w", err)
		}

		tlsConfig := &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS12,
		}

		listener, err = tls.Listen("tcp", addr, tlsConfig)
		if err != nil {
			return fmt.Errorf("TLS listen: %w", err)
		}
		log.Info().Str("addr", addr).Msg("TLS control listener started")
	} else {
		listener, err = net.Listen("tcp", addr)
		if err != nil {
			return fmt.Errorf("TCP listen: %w", err)
		}
		log.Warn().Str("addr", addr).Msg("control listener started WITHOUT TLS (dev mode)")
	}
	defer listener.Close()

	smuxConfig := smux.DefaultConfig()
	smuxConfig.MaxReceiveBuffer = 4 * 1024 * 1024
	smuxConfig.KeepAliveInterval = 30 * time.Second
	smuxConfig.KeepAliveTimeout = 60 * time.Second

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Error().Err(err).Msg("accept error")
			continue
		}

		go handleClient(conn, smuxConfig, authToken, domain, scheme, serverHost, registry, manager, tcpProxy, database, jwtMgr, log)
	}
}

func handleClient(conn net.Conn, smuxConfig *smux.Config, authToken, domain, scheme, serverHost string, registry *tunnel.Registry, manager *control.Manager, tcpProxy *proxy.TCPProxy, database *db.DB, jwtMgr *auth.JWTManager, log zerolog.Logger) {
	clientLog := log.With().Str("remote", conn.RemoteAddr().String()).Logger()
	clientLog.Debug().Msg("new connection")

	session, err := smux.Server(conn, smuxConfig)
	if err != nil {
		clientLog.Error().Err(err).Msg("smux session error")
		conn.Close()
		return
	}

	ctrlConn, err := control.NewConn(session, registry, tcpProxy, database, domain, scheme, serverHost, clientLog)
	if err != nil {
		clientLog.Error().Err(err).Msg("control connection error")
		session.Close()
		return
	}

	// Authenticate: try DB auth first, fall back to static token
	if err := ctrlConn.AuthenticateWithDB(authToken, database, jwtMgr); err != nil {
		clientLog.Warn().Err(err).Msg("authentication failed")
		ctrlConn.Close()
		return
	}

	manager.Add(ctrlConn)
	defer manager.Remove(ctrlConn.ID())

	if err := ctrlConn.Run(); err != nil {
		clientLog.Debug().Err(err).Msg("control connection ended")
	}
}

// pruneAbandonedBuildDirsOnWorkers runs the same 24h cleanup as the local
// control-plane sweep but against every active worker (platform + BYOC) via
// the same SSH runner used for deploys. Prevents worker disks from silently
// filling up when a remote deploy is interrupted.
func pruneAbandonedBuildDirsOnWorkers(ctx context.Context, database *db.DB, log zerolog.Logger) {
	workers, err := database.ListAllActiveWorkers(ctx)
	if err != nil {
		return
	}
	for i := range workers {
		w := workers[i]
		runner := deploy.NewRemoteRunner(&w)
		// find /tmp/serverme-build -maxdepth 1 -type d -mmin +1440 -exec rm -rf {} +
		// 1440 min = 24h. Older than our control-plane retention keeps things
		// in sync across the whole fleet.
		if _, err := runner.RunShell(ctx, "find /tmp/serverme-build -maxdepth 1 -mindepth 1 -type d -mmin +1440 -exec rm -rf {} + 2>/dev/null || true"); err != nil {
			log.Debug().Err(err).Str("worker", w.Label).Msg("remote build dir cleanup failed")
		}
	}
}

// monitorWorkerHealth pings every active worker every 2 minutes. After 3
// consecutive failures it marks the worker as 'offline' so new deploys don't
// get scheduled onto it; once SSH starts responding again the check on next
// tick updates last_heartbeat and an admin can flip it back to 'active'.
//
// Uses the per-worker SSH config that's already stored for deploys, so no
// extra credentials are required.
// refreshLocalServerCapacity reads this host's CPU and memory and writes them
// to the worker_servers row marked is_local=true so the scheduler can do
// real overflow accounting (instead of relying on the placeholder values
// from the migration). Runs once at startup; cheap enough to not need a
// loop unless we add hot-add/remove of CPUs.
func refreshLocalServerCapacity(ctx context.Context, database *db.DB, log zerolog.Logger) {
	cpuOut, _ := exec.Command("nproc").Output()
	memOut, _ := exec.Command("bash", "-c", `awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo`).Output()
	var cpus float64
	var memMB int
	fmt.Sscanf(strings.TrimSpace(string(cpuOut)), "%f", &cpus)
	fmt.Sscanf(strings.TrimSpace(string(memOut)), "%d", &memMB)
	if cpus <= 0 || memMB <= 0 {
		log.Warn().Msg("refreshLocalServerCapacity: probe returned 0 — leaving placeholders")
		return
	}
	// Derive an honest project ceiling from RAM instead of the 1000 placeholder.
	// ~256MB baseline per project; the 85%-RAM guard in SelectServerForProject is
	// the real limiter, this is just so the "X/Y projects" display isn't fiction.
	maxProj := memMB / 256
	if maxProj < 3 {
		maxProj = 3
	}
	if _, err := database.Pool.Exec(ctx,
		`UPDATE worker_servers
		 SET total_cpu = $1, total_memory_mb = $2, max_projects = $3
		 WHERE is_local = true`, cpus, memMB, maxProj); err != nil {
		log.Warn().Err(err).Msg("refreshLocalServerCapacity: update failed")
		return
	}
	log.Info().Float64("cpus", cpus).Int("memory_mb", memMB).Int("max_projects", maxProj).Msg("local platform server capacity refreshed")

	// Also reconcile allocations now that capacity is correct, so the admin
	// page shows accurate "X / Y MB" right after startup rather than waiting
	// for the next deploy to trigger reconciliation.
	var localID string
	database.Pool.QueryRow(ctx, `SELECT id FROM worker_servers WHERE is_local = true LIMIT 1`).Scan(&localID)
	if localID != "" {
		database.ReconcileServerAllocation(ctx, localID)
	}
}

func monitorWorkerHealth(ctx context.Context, database *db.DB, log zerolog.Logger) {
	log.Info().Msg("worker health monitor started")
	fails := map[string]int{}
	const failThreshold = 3
	check := func() {
		workers, err := database.ListAllActiveWorkers(ctx)
		if err != nil {
			return
		}
		for i := range workers {
			w := workers[i]
			runner := deploy.NewRemoteRunner(&w)
			pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			_, err := runner.RunShell(pingCtx, "echo ok")
			cancel()
			if err != nil {
				fails[w.ID]++
				if fails[w.ID] >= failThreshold {
					log.Warn().Str("worker", w.Label).Str("host", w.Host).Int("fails", fails[w.ID]).Msg("worker offline — marking inactive")
					database.UpdateWorkerServerStatus(ctx, w.ID, "offline")
					delete(fails, w.ID) // reset so it can come back online later
				}
			} else {
				database.UpdateWorkerHeartbeat(ctx, w.ID)
				delete(fails, w.ID)
				// Self-heal: a worker previously marked offline that answers
				// again comes back automatically. Offline used to be a
				// one-way door — a transient SSH timeout (e.g. control host
				// under load) stranded healthy workers offline forever.
				if w.Status == "offline" {
					log.Info().Str("worker", w.Label).Str("host", w.Host).Msg("worker responding again — marking active")
					database.UpdateWorkerServerStatus(ctx, w.ID, "active")
				}
				// Refresh real hardware capacity + live usage on each
				// heartbeat so the Servers/Admin pages show measured values
				// (used RAM, load) rather than allocation sums, and totals
				// track reality instead of the add-time snapshot.
				probeCtx, pcancel := context.WithTimeout(ctx, 15*time.Second)
				// SMPROBE marker: SSH sessions can prepend noise (locale
				// warnings, MOTD) to combined output — parse only our line.
				out, perr := runner.RunShell(probeCtx,
					`echo "SMPROBE $(nproc) $(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo) $(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo) $(cut -d' ' -f1 /proc/loadavg)"`)
				pcancel()
				if perr == nil {
					for _, line := range strings.Split(string(out), "\n") {
						parts := strings.Fields(strings.TrimSpace(line))
						if len(parts) == 5 && parts[0] == "SMPROBE" {
							cpu, _ := strconv.ParseFloat(parts[1], 64)
							memTotal, _ := strconv.Atoi(parts[2])
							memAvail, _ := strconv.Atoi(parts[3])
							load, _ := strconv.ParseFloat(parts[4], 64)
							if cpu > 0 && memTotal > 0 {
								database.UpdateWorkerServerCapacity(ctx, w.ID, cpu, memTotal)
								database.UpdateWorkerServerLiveMetrics(ctx, w.ID, memTotal-memAvail, load)
							}
							break
						}
					}
				}
			}
		}
		// Recount projects/allocations on every server each cycle so moves,
		// crashes, and deletions can't leave the Servers page showing stale
		// project counts or allocation bars.
		database.ReconcileAllServerAllocations(ctx)
	}
	check()
	t := time.NewTicker(2 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			check()
		}
	}
}

// pruneAbandonedBuildDirs removes any /tmp/serverme-build/<project-id>/
// directory that hasn't been touched in 24h. The happy-path deploy cleans
// up its own dir, so anything left this long was interrupted mid-build
// (server restart, OOM, crashed docker daemon).
func pruneAbandonedBuildDirs(log zerolog.Logger) {
	const base = "/tmp/serverme-build"
	entries, err := os.ReadDir(base)
	if err != nil {
		return // dir doesn't exist yet — nothing to clean
	}
	cutoff := time.Now().Add(-24 * time.Hour)
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		p := base + "/" + e.Name()
		if err := os.RemoveAll(p); err == nil {
			log.Debug().Str("path", p).Msg("pruned abandoned build dir")
		}
	}
}
