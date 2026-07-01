package commands

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

func NewAuthTokenCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "authtoken [token]",
		Short: "Save an authentication token",
		Long:  "Saves the authentication token to ~/.deployzy/authtoken for future use.",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			token := args[0]

			dir := configDir()
			if err := os.MkdirAll(dir, 0700); err != nil {
				return fmt.Errorf("create config dir: %w", err)
			}

			path := filepath.Join(dir, "authtoken")
			if err := os.WriteFile(path, []byte(token), 0600); err != nil {
				return fmt.Errorf("write token: %w", err)
			}

			fmt.Printf("Auth token saved to %s\n", path)
			return nil
		},
	}
}

func configDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".deployzy"
	}
	return filepath.Join(home, ".deployzy")
}

func loadSavedToken() string {
	path := filepath.Join(configDir(), "authtoken")
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
