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

func NewTCPCmd() *cobra.Command {
	var (
		remotePort int
		name       string
	)

	cmd := &cobra.Command{
		Use:   "tcp [port]",
		Short: "Start a TCP tunnel",
		Long:  "Expose a local TCP service to the internet via a public port.",
		Args:  cobra.ExactArgs(1),
		Example: `  deployzy tcp 5432
  deployzy tcp 3306 --remote-port 33060
  deployzy tcp 6379 --name redis`,
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
				Protocol:   proto.ProtoTCP,
				LocalAddr:  localAddr,
				RemotePort: remotePort,
				Name:       name,
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

	cmd.Flags().IntVar(&remotePort, "remote-port", 0, "Request a specific remote port")
	cmd.Flags().StringVar(&name, "name", "", "Tunnel name/label")

	return cmd
}
