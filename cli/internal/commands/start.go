package commands

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/cli/internal/client"
	"github.com/serverme/serverme/cli/internal/config"
	"github.com/serverme/serverme/proto"
	"github.com/spf13/cobra"
)

func NewStartCmd() *cobra.Command {
	var configPath string

	cmd := &cobra.Command{
		Use:   "start",
		Short: "Start tunnels from config file",
		Long:  "Start all tunnels defined in the config file (~/.deployzy/deployzy.yml by default).",
		Example: `  deployzy start
  deployzy start --config ./deployzy.yml`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if configPath == "" {
				configPath = config.DefaultPath()
			}

			cfg, err := config.Load(configPath)
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			if len(cfg.Tunnels) == 0 {
				return fmt.Errorf("no tunnels defined in config file %s", configPath)
			}

			// Override with flags if set
			srv := cfg.Server
			if serverAddr != "localhost:8443" && serverAddr != "" {
				srv = serverAddr
			}

			token := cfg.AuthToken
			if authToken != "" {
				token = authToken
			}
			if token == "" {
				token = loadSavedToken()
			}
			if token == "" {
				token = "dev-token"
			}

			lvl := cfg.LogLevel
			if logLevel != "info" {
				lvl = logLevel
			}

			level, _ := zerolog.ParseLevel(lvl)
			log := zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339}).
				With().Timestamp().Logger().Level(level)

			// Build tunnel configs
			var tunnelCfgs []client.TunnelConfig
			for name, entry := range cfg.Tunnels {
				tc := client.TunnelConfig{
					Protocol:   entry.Proto,
					LocalAddr:  normalizeAddr(entry.Addr),
					Subdomain:  entry.Subdomain,
					Hostname:   entry.Hostname,
					RemotePort: entry.RemotePort,
					Name:       name,
					Inspect:    entry.Inspect,
					Auth:       entry.Auth,
				}
				tunnelCfgs = append(tunnelCfgs, tc)
			}

			c := client.New(srv, token, tlsSkip, tunnelCfgs, log)

			if err := c.Connect(); err != nil {
				return fmt.Errorf("connect: %w", err)
			}

			fmt.Println()
			fmt.Println("Deployzy                               (Ctrl+C to quit)")
			fmt.Printf("%-20s %s\n", "Config", configPath)
			fmt.Printf("%-20s %s\n", "Version", proto.Version)
			fmt.Println()

			for _, t := range c.ActiveTunnels() {
				localAddr := ""
				for _, tc := range tunnelCfgs {
					if tc.Name == t.Name {
						localAddr = tc.LocalAddr
						break
					}
				}
				fmt.Printf("%-20s %s -> %s\n", "Forwarding", t.URL, localAddr)
			}
			fmt.Println()

			sigCh := make(chan os.Signal, 1)
			signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

			errCh := make(chan error, 1)
			go func() { errCh <- c.RunWithReconnect() }()

			select {
			case sig := <-sigCh:
				fmt.Printf("\nReceived %s, shutting down...\n", sig)
				c.Close()
				return nil
			case err := <-errCh:
				return err
			}
		},
	}

	cmd.Flags().StringVarP(&configPath, "config", "c", "", "Config file path (default: ~/.deployzy/deployzy.yml)")

	return cmd
}

func normalizeAddr(addr string) string {
	for _, c := range addr {
		if c == ':' {
			return addr
		}
	}
	return "localhost:" + addr
}
