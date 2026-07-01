package commands

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

var subdomainSanitize = regexp.MustCompile(`[^a-z0-9-]+`)

func sanitizeSubdomain(s string) string {
	s = strings.ToLower(s)
	s = subdomainSanitize.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

func NewDeployCmd() *cobra.Command {
	var (
		repo      string
		image     string
		name      string
		subdomain string
		branch    string
		envPairs  []string
		noFollow  bool
	)

	cmd := &cobra.Command{
		Use:   "deploy [dir]",
		Short: "Deploy a project to Deployzy",
		Long: `Deploy a project from a git repo, a prebuilt image, or a local directory.

Examples:
  deployzy deploy --repo jams24/api --name api       # build from GitHub
  deployzy deploy --image nginx:alpine --name proxy  # run a prebuilt image
  deployzy deploy ./                                  # upload + build the current dir`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			api, err := newAPIClient()
			if err != nil {
				return err
			}

			dir := ""
			if len(args) == 1 {
				dir = args[0]
			}

			// Exactly one source.
			sources := 0
			for _, s := range []string{repo, image, dir} {
				if s != "" {
					sources++
				}
			}
			if sources == 0 {
				return fmt.Errorf("provide a source: --repo OWNER/NAME, --image REF, or a directory")
			}
			if sources > 1 {
				return fmt.Errorf("use only one of --repo, --image, or [dir]")
			}

			// Derive a name if not given.
			if name == "" {
				switch {
				case repo != "":
					name = strings.TrimSuffix(filepath.Base(repo), ".git")
				case image != "":
					name = strings.SplitN(filepath.Base(image), ":", 2)[0]
				case dir != "":
					abs, _ := filepath.Abs(dir)
					name = filepath.Base(abs)
				}
			}
			if subdomain == "" {
				subdomain = sanitizeSubdomain(name)
			}

			// Build the create body.
			body := map[string]any{"name": name, "subdomain": subdomain}
			switch {
			case image != "":
				body["image"] = image
				body["deploy_source"] = "image"
			case repo != "":
				if strings.HasPrefix(repo, "http://") || strings.HasPrefix(repo, "https://") {
					body["repo_url"] = repo
				} else {
					body["repo_url"] = "https://github.com/" + repo + ".git"
					body["github_repo"] = repo
				}
				body["branch"] = branch
			case dir != "":
				body["deploy_source"] = "upload"
			}

			fmt.Printf("Creating project %q (%s.deployzy.com)...\n", name, subdomain)
			var project cliProject
			if err := api.do("POST", "/api/v1/projects", body, &project); err != nil {
				return fmt.Errorf("create project: %w", err)
			}

			// Env vars.
			if len(envPairs) > 0 {
				env := map[string]string{}
				for _, p := range envPairs {
					kv := strings.SplitN(p, "=", 2)
					if len(kv) == 2 {
						env[kv[0]] = kv[1]
					}
				}
				if err := api.do("PUT", "/api/v1/projects/"+project.ID, map[string]any{"env_vars": env}, nil); err != nil {
					return fmt.Errorf("set env: %w", err)
				}
			}

			// Upload the directory as the build context.
			if dir != "" {
				fmt.Println("Uploading build context...")
				if err := api.uploadTar(project.ID, dir); err != nil {
					return err
				}
			}

			// Kick off the deploy.
			if err := api.do("POST", "/api/v1/projects/"+project.ID+"/deploy", nil, nil); err != nil {
				return fmt.Errorf("trigger deploy: %w", err)
			}
			fmt.Println("Deploy started.")

			if noFollow {
				fmt.Printf("Track it at https://deployzy.com/projects (id: %s)\n", project.ID)
				return nil
			}
			return streamDeploy(api, project.ID, subdomain)
		},
	}

	cmd.Flags().StringVar(&repo, "repo", "", "GitHub repo to build (OWNER/NAME or https URL)")
	cmd.Flags().StringVar(&image, "image", "", "Prebuilt image to run (e.g. nginx:alpine)")
	cmd.Flags().StringVar(&name, "name", "", "Project name (defaults to repo/image/dir name)")
	cmd.Flags().StringVar(&subdomain, "subdomain", "", "Public subdomain (defaults to a slug of name)")
	cmd.Flags().StringVar(&branch, "branch", "main", "Git branch (for --repo)")
	cmd.Flags().StringArrayVarP(&envPairs, "env", "e", nil, "Environment variable KEY=VALUE (repeatable)")
	cmd.Flags().BoolVar(&noFollow, "no-follow", false, "Don't stream deploy logs")
	return cmd
}

// streamDeploy polls deploy logs + status until the project is running or failed.
func streamDeploy(api *apiClient, projectID, subdomain string) error {
	seen := 0
	deadline := time.Now().Add(15 * time.Minute)
	for time.Now().Before(deadline) {
		var detail projectDetail
		if err := api.do("GET", "/api/v1/projects/"+projectID, nil, &detail); err != nil {
			return err
		}
		// Logs come newest-first from the API; print oldest-first.
		if len(detail.Logs) > seen {
			fresh := detail.Logs[:len(detail.Logs)-seen]
			for i := len(fresh) - 1; i >= 0; i-- {
				fmt.Printf("  %s\n", fresh[i].Message)
			}
			seen = len(detail.Logs)
		}
		switch detail.Project.Status {
		case "running":
			fmt.Printf("\n✓ Deployed → https://%s.deployzy.com\n", subdomain)
			return nil
		case "failed":
			return fmt.Errorf("deploy failed — see logs above")
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("timed out waiting for deploy")
}
