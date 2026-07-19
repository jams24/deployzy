package commands

import (
	"fmt"
	"os"

	"github.com/serverme/serverme/proto"
	"github.com/spf13/cobra"
)

var (
	serverAddr string
	authToken  string
	tlsSkip    bool
	logLevel   string
)

func NewRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "deployzy",
		Short: "Deployzy — expose your local servers to the internet",
		Long: `Deployzy is an open-source tunnel that exposes local servers to the internet.
Similar to ngrok, but open source and self-hostable.

Examples:
  deployzy http 8080              # HTTP tunnel to localhost:8080
  deployzy http 3000 --subdomain myapp  # Custom subdomain
  deployzy tcp 5432               # TCP tunnel
  deployzy authtoken <TOKEN>      # Save auth token`,
		Version: proto.Version,
		CompletionOptions: cobra.CompletionOptions{
			HiddenDefaultCmd: true,
		},
	}

	// Global flags
	root.PersistentFlags().StringVarP(&serverAddr, "server", "s", "ctrl.deployzy.com:8443", "Deployzy server address")
	root.PersistentFlags().StringVar(&authToken, "authtoken", "", "Authentication token")
	root.PersistentFlags().BoolVar(&tlsSkip, "tls-skip-verify", true, "Skip TLS certificate verification")
	root.PersistentFlags().StringVar(&logLevel, "log-level", "info", "Log level (debug, info, warn, error)")

	// Subcommands
	root.AddCommand(NewHTTPCmd())
	root.AddCommand(NewTCPCmd())
	root.AddCommand(NewTLSCmd())
	root.AddCommand(NewStartCmd())
	root.AddCommand(NewStatusCmd())
	root.AddCommand(NewLoginCmd())
	root.AddCommand(NewLoginEmailCmd())
	root.AddCommand(NewAuthTokenCmd())
	root.AddCommand(NewVersionCmd())
	// Deploy / project management (REST API).
	root.AddCommand(NewDeployCmd())
	root.AddCommand(NewProjectsCmd())
	root.AddCommand(NewLogsCmd())
	root.AddCommand(NewEnvCmd())

	return root
}

func Execute() {
	if err := NewRootCmd().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
