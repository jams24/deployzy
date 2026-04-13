package main

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/proto"
	"github.com/serverme/serverme/server/internal/api"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/control"
	"github.com/serverme/serverme/server/internal/db"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/deploy"
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
	frontendURL := flag.String("frontend-url", "https://serverme.site", "Frontend URL for OAuth redirects")
	telegramToken := flag.String("telegram-token", "", "Telegram bot token")
	inventpayKey := flag.String("inventpay-key", "", "InventPay API key")
	githubAppID := flag.String("github-app-id", "", "GitHub App ID")
	githubClientID := flag.String("github-client-id", "", "GitHub App Client ID")
	githubClientSecret := flag.String("github-client-secret", "", "GitHub App Client Secret")
	githubWebhookSecret := flag.String("github-webhook-secret", "", "GitHub App Webhook Secret")
	githubPrivateKey := flag.String("github-private-key", "", "GitHub App Private Key PEM file path")
	inventpayWebhookSecret := flag.String("inventpay-webhook-secret", "", "InventPay webhook secret")
	telegramBotUsername := flag.String("telegram-bot", "serverme_alerts_bot", "Telegram bot username")
	logLevel := flag.String("log-level", "info", "Log level (debug, info, warn, error)")
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
		Msg("ServerMe server starting")

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
	jwtMgr := auth.NewJWTManager(*jwtSecret, 24*time.Hour)

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

		// Billing
		var billingClient *billing.InventPay
		if *inventpayKey != "" {
			billingClient = billing.NewInventPay(*inventpayKey, *inventpayWebhookSecret)
			log.Info().Msg("InventPay billing enabled")
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
			deployEngine = deploy.NewEngine(database, *domain, githubApp, log)
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
		}

		apiRouter := api.NewRouter(database, jwtMgr, registry, inspectStore, googleCfg, telegramBot, *telegramBotUsername, billingClient, deployEngine, log)
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
