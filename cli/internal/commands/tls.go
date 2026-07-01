package commands

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/cli/internal/client"
	"github.com/serverme/serverme/proto"
	"github.com/spf13/cobra"
)

func NewTLSCmd() *cobra.Command {
	var (
		subdomain string
		hostname  string
		name      string
	)

	cmd := &cobra.Command{
		Use:   "tls [port]",
		Short: "Start a TLS passthrough tunnel",
		Long:  "Expose a local TLS service to the internet. TLS traffic is passed through without termination.",
		Args:  cobra.ExactArgs(1),
		Example: `  deployzy tls 443
  deployzy tls 8443 --subdomain myapp`,
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
				Protocol:  proto.ProtoTLS,
				LocalAddr: localAddr,
				Subdomain: subdomain,
				Hostname:  hostname,
				Name:      name,
			}

			printBanner()
			printConnecting(serverAddr)

			cl := client.New(serverAddr, token, tlsSkip, []client.TunnelConfig{tunnelCfg}, log)
			if err := cl.Connect(); err != nil {
				printDisconnected(err)
				return fmt.Errorf("connect: %w", err)
			}
			printConnected()
			printTunnelInfo(cl.ActiveTunnels(), localAddr, "", false)
			return waitForShutdown(cl)
		},
	}

	cmd.Flags().StringVar(&subdomain, "subdomain", "", "Request a custom subdomain")
	cmd.Flags().StringVar(&hostname, "hostname", "", "Request a custom hostname")
	cmd.Flags().StringVar(&name, "name", "", "Tunnel name/label")

	return cmd
}
