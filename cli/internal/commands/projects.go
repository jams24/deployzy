package commands

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

func NewProjectsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "projects",
		Aliases: []string{"ps"},
		Short:   "Manage deployed projects",
	}
	cmd.AddCommand(newProjectsLsCmd())
	cmd.AddCommand(newProjectsRmCmd())
	return cmd
}

func newProjectsLsCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "ls",
		Aliases: []string{"list"},
		Short:   "List your projects",
		RunE: func(cmd *cobra.Command, args []string) error {
			api, err := newAPIClient()
			if err != nil {
				return err
			}
			var list []cliProject
			if err := api.do("GET", "/api/v1/projects", nil, &list); err != nil {
				return err
			}
			if len(list) == 0 {
				fmt.Println("No projects yet. Deploy one with `deployzy deploy`.")
				return nil
			}
			fmt.Printf("%-24s %-12s %-8s %s\n", "NAME", "STATUS", "SOURCE", "URL")
			for _, p := range list {
				src := p.DeploySource
				if src == "" {
					src = "git"
				}
				fmt.Printf("%-24s %-12s %-8s https://%s.deployzy.com\n", trunc(p.Name, 24), p.Status, src, p.Subdomain)
			}
			return nil
		},
	}
}

func newProjectsRmCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "rm <project>",
		Short: "Delete a project (by name, subdomain, or id)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			api, err := newAPIClient()
			if err != nil {
				return err
			}
			p, err := api.resolveProject(args[0])
			if err != nil {
				return err
			}
			if err := api.do("DELETE", "/api/v1/projects/"+p.ID, nil, nil); err != nil {
				return err
			}
			fmt.Printf("Deleted %q.\n", p.Name)
			return nil
		},
	}
}

func NewLogsCmd() *cobra.Command {
	var follow bool
	cmd := &cobra.Command{
		Use:   "logs <project>",
		Short: "Show a project's deploy logs",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			api, err := newAPIClient()
			if err != nil {
				return err
			}
			p, err := api.resolveProject(args[0])
			if err != nil {
				return err
			}
			printLogs := func(seen int) (int, error) {
				var logs []cliLog
				if err := api.do("GET", "/api/v1/projects/"+p.ID+"/logs", nil, &logs); err != nil {
					return seen, err
				}
				// API returns newest-first; print oldest-first.
				if len(logs) > seen {
					fresh := logs[:len(logs)-seen]
					for i := len(fresh) - 1; i >= 0; i-- {
						fmt.Printf("%s\n", fresh[i].Message)
					}
				}
				return len(logs), nil
			}
			seen, err := printLogs(0)
			if err != nil {
				return err
			}
			if !follow {
				return nil
			}
			for {
				time.Sleep(2 * time.Second)
				seen, err = printLogs(seen)
				if err != nil {
					return err
				}
			}
		},
	}
	cmd.Flags().BoolVarP(&follow, "follow", "f", false, "Stream new log lines")
	return cmd
}

func NewEnvCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "env",
		Short: "Manage a project's environment variables",
	}
	cmd.AddCommand(newEnvLsCmd())
	cmd.AddCommand(newEnvSetCmd())
	return cmd
}

func newEnvLsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "ls <project>",
		Short: "List environment variables",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			api, err := newAPIClient()
			if err != nil {
				return err
			}
			p, err := api.resolveProject(args[0])
			if err != nil {
				return err
			}
			var detail struct {
				Project struct {
					EnvVars map[string]string `json:"env_vars"`
				} `json:"project"`
			}
			if err := api.do("GET", "/api/v1/projects/"+p.ID, nil, &detail); err != nil {
				return err
			}
			keys := make([]string, 0, len(detail.Project.EnvVars))
			for k := range detail.Project.EnvVars {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				fmt.Printf("%s=%s\n", k, detail.Project.EnvVars[k])
			}
			return nil
		},
	}
}

func newEnvSetCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "set <project> KEY=VALUE [KEY=VALUE...]",
		Short: "Set environment variables (merges with existing), then redeploy to apply",
		Args:  cobra.MinimumNArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			api, err := newAPIClient()
			if err != nil {
				return err
			}
			p, err := api.resolveProject(args[0])
			if err != nil {
				return err
			}
			// Merge into existing env so `env set` is additive.
			var detail struct {
				Project struct {
					EnvVars map[string]string `json:"env_vars"`
				} `json:"project"`
			}
			if err := api.do("GET", "/api/v1/projects/"+p.ID, nil, &detail); err != nil {
				return err
			}
			env := detail.Project.EnvVars
			if env == nil {
				env = map[string]string{}
			}
			for _, kv := range args[1:] {
				parts := strings.SplitN(kv, "=", 2)
				if len(parts) != 2 {
					return fmt.Errorf("invalid KEY=VALUE: %q", kv)
				}
				env[parts[0]] = parts[1]
			}
			if err := api.do("PUT", "/api/v1/projects/"+p.ID, map[string]any{"env_vars": env}, nil); err != nil {
				return err
			}
			fmt.Printf("Updated env for %q. Run `deployzy deploy` again or redeploy from the dashboard to apply.\n", p.Name)
			return nil
		},
	}
}

func trunc(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}
