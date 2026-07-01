package commands

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

func NewLoginCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "login",
		Short: "Log in to Deployzy via browser",
		Long:  "Opens your browser to log in with Google. Your auth token is saved automatically.",
		Example: `  deployzy login
  deployzy login --server custom.server.com:8443`,
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println()
			fmt.Printf("  %s\n", c(bold+cyan, "Deployzy Login"))
			fmt.Printf("  %s\n", c(dim, "──────────────────────────"))

			// Generate a random state token the CLI will poll for
			b := make([]byte, 16)
			rand.Read(b)
			cliState := hex.EncodeToString(b)

			apiBase := deriveAPIBase(serverAddr)
			loginURL := fmt.Sprintf("%s/api/v1/auth/google?cli_state=%s", apiBase, cliState)
			pollURL := fmt.Sprintf("%s/api/v1/auth/poll/%s", apiBase, cliState)

			fmt.Println()
			fmt.Printf("  Opening browser...\n")
			fmt.Printf("  %s\n", c(dim, "If it doesn't open, visit:"))
			fmt.Printf("  %s\n", c(cyan, loginURL))
			fmt.Println()

			openBrowser(loginURL)

			fmt.Printf("  %s\n", c(dim, "Waiting for authentication..."))
			fmt.Println()

			client := &http.Client{Timeout: 10 * time.Second}
			deadline := time.Now().Add(2 * time.Minute)

			for time.Now().Before(deadline) {
				time.Sleep(2 * time.Second)

				resp, err := client.Get(pollURL)
				if err != nil {
					continue
				}

				if resp.StatusCode == http.StatusOK {
					var result struct {
						Token string `json:"token"`
					}
					json.NewDecoder(resp.Body).Decode(&result)
					resp.Body.Close()

					if result.Token != "" {
						saveToken(result.Token)
						fmt.Printf("  %s Logged in successfully!\n", c(green, "✓"))
						fmt.Println()
						fmt.Printf("  Now run: %s\n", c(white, "deployzy http 3000"))
						fmt.Println()
						return nil
					}
				}
				resp.Body.Close()
			}

			return fmt.Errorf("login timed out")
		},
	}
}

func NewLoginEmailCmd() *cobra.Command {
	var email string
	var password string

	cmd := &cobra.Command{
		Use:   "login:email",
		Short: "Log in with email and password",
		Example: `  deployzy login:email --email you@example.com --password yourpass`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if email == "" || password == "" {
				return fmt.Errorf("--email and --password are required")
			}

			fmt.Printf("\n  %s Logging in as %s...\n", c(yellow, "●"), email)

			apiBase := deriveAPIBase(serverAddr)
			payload := fmt.Sprintf(`{"email":"%s","password":"%s"}`, email, password)

			req, _ := http.NewRequest("POST", apiBase+"/api/v1/auth/login", strings.NewReader(payload))
			req.Header.Set("Content-Type", "application/json")

			resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
			if err != nil {
				return fmt.Errorf("request failed: %w", err)
			}
			defer resp.Body.Close()

			var result struct {
				Token string `json:"token"`
				User  struct {
					Email string `json:"email"`
				} `json:"user"`
				Error string `json:"error,omitempty"`
			}
			json.NewDecoder(resp.Body).Decode(&result)

			if result.Error != "" {
				return fmt.Errorf("%s", result.Error)
			}
			if result.Token == "" {
				return fmt.Errorf("no token received")
			}

			saveToken(result.Token)
			fmt.Printf("  %s Logged in as %s\n\n", c(green, "✓"), result.User.Email)
			fmt.Printf("  Now run: %s\n\n", c(white, "deployzy http 3000"))
			return nil
		},
	}

	cmd.Flags().StringVar(&email, "email", "", "Email address")
	cmd.Flags().StringVar(&password, "password", "", "Password")
	cmd.MarkFlagRequired("email")
	cmd.MarkFlagRequired("password")

	return cmd
}

func deriveAPIBase(server string) string {
	host := strings.Split(server, ":")[0]
	return "https://api." + host
}

func saveToken(token string) {
	dir := configDir()
	os.MkdirAll(dir, 0700)
	os.WriteFile(filepath.Join(dir, "authtoken"), []byte(token), 0600)
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	}
	if cmd != nil {
		cmd.Start()
	}
}
