package commands

import (
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/cli/internal/client"
	"github.com/serverme/serverme/cli/internal/inspector"
	"github.com/serverme/serverme/proto"
	"github.com/spf13/cobra"
)

func NewHTTPCmd() *cobra.Command {
	var (
		subdomain     string
		hostname      string
		name          string
		inspect       bool
		auth          string
		inspectorAddr string
	)

	cmd := &cobra.Command{
		Use:   "http [port]",
		Short: "Start an HTTP tunnel",
		Long:  "Expose a local HTTP server to the internet via a public URL.",
		Args:  cobra.ExactArgs(1),
		Example: `  deployzy http 8080
  deployzy http 3000 --subdomain myapp
  deployzy http 8080 --auth "user:pass"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			port := args[0]
			localAddr := port
			if !strings.Contains(port, ":") {
				localAddr = "localhost:" + port
			}

			token := resolveToken()
			level, _ := zerolog.ParseLevel(logLevel)
			log := zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339}).
				With().Timestamp().Logger().Level(level)

			tunnelCfg := client.TunnelConfig{
				Protocol:  proto.ProtoHTTP,
				LocalAddr: localAddr,
				Subdomain: subdomain,
				Hostname:  hostname,
				Name:      name,
				Inspect:   inspect,
				Auth:      auth,
			}

			printBanner()
			printConnecting(serverAddr)

			cl := client.New(serverAddr, token, tlsSkip, []client.TunnelConfig{tunnelCfg}, log)
			if err := cl.Connect(); err != nil {
				printDisconnected(err)
				return fmt.Errorf("connect: %w", err)
			}
			printConnected()

			if inspect {
				ins := inspector.New(inspectorAddr, log)
				cl.SetInspector(inspector.NewAdapter(ins))
				go ins.Start()
			}

			printTunnelInfo(cl.ActiveTunnels(), localAddr, inspectorAddr, inspect)
			return waitForShutdown(cl)
		},
	}

	cmd.Flags().StringVar(&subdomain, "subdomain", "", "Request a custom subdomain")
	cmd.Flags().StringVar(&hostname, "hostname", "", "Request a custom hostname")
	cmd.Flags().StringVar(&name, "name", "", "Tunnel name/label")
	cmd.Flags().BoolVar(&inspect, "inspect", true, "Enable request inspection")
	cmd.Flags().StringVar(&auth, "auth", "", "HTTP basic auth (user:pass)")
	cmd.Flags().StringVar(&inspectorAddr, "inspector-addr", "127.0.0.1:4040", "Local inspector address")

	return cmd
}

func resolveToken() string {
	if authToken != "" {
		return authToken
	}
	if t := loadSavedToken(); t != "" {
		return t
	}
	fmt.Println()
	fmt.Printf("  %s No authtoken set.\n", c(red, "ERROR"))
	fmt.Println()
	fmt.Printf("  Sign up at %s and get your token,\n", c(cyan, "https://deployzy.com/sign-up"))
	fmt.Printf("  then run:\n")
	fmt.Println()
	fmt.Printf("    %s\n", c(white, "deployzy authtoken <your-token>"))
	fmt.Println()
	os.Exit(1)
	return ""
}

func waitForShutdown(cl *client.Client) error {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	errCh := make(chan error, 1)
	go func() { errCh <- cl.RunWithReconnect() }()

	select {
	case <-sigCh:
		printShutdown()
		cl.Close()
		return nil
	case err := <-errCh:
		if err != nil {
			printDisconnected(err)
			return fmt.Errorf("tunnel error: %w", err)
		}
		return nil
	}
}
