package commands

import (
	"fmt"

	"github.com/spf13/cobra"
)

func NewStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show tunnel status",
		Long:  "Display the status of active tunnels. (Requires a running deployzy process.)",
		RunE: func(cmd *cobra.Command, args []string) error {
			// TODO: In Phase 4, this will query the local inspector API at localhost:4040
			fmt.Println("Status checking requires the local inspector (coming in a future release).")
			fmt.Println("For now, check the terminal where 'deployzy' is running.")
			return nil
		},
	}
}
