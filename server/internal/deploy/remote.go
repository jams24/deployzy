package deploy

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/serverme/serverme/server/internal/db"
)

// Runner executes commands either locally or on a remote server via SSH.
type Runner struct {
	server *db.WorkerServer // nil = local
}

// NewLocalRunner creates a runner that executes commands locally.
func NewLocalRunner() *Runner {
	return &Runner{server: nil}
}

// NewRemoteRunner creates a runner that executes commands on a remote server.
func NewRemoteRunner(server *db.WorkerServer) *Runner {
	return &Runner{server: server}
}

// IsRemote returns true if commands run on a remote server.
func (r *Runner) IsRemote() bool {
	return r.server != nil
}

// Run executes a command and returns combined output.
func (r *Runner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	if r.server == nil {
		return exec.CommandContext(ctx, name, args...).CombinedOutput()
	}
	// Build the remote command
	remoteCmd := name
	for _, a := range args {
		remoteCmd += " " + shellQuote(a)
	}
	return r.sshExec(ctx, remoteCmd)
}

// RunShell executes a shell command string.
func (r *Runner) RunShell(ctx context.Context, cmd string) ([]byte, error) {
	if r.server == nil {
		return exec.CommandContext(ctx, "bash", "-c", cmd).CombinedOutput()
	}
	return r.sshExec(ctx, cmd)
}

// Exec runs a command without capturing output (fire and forget).
func (r *Runner) Exec(ctx context.Context, name string, args ...string) error {
	if r.server == nil {
		return exec.CommandContext(ctx, name, args...).Run()
	}
	remoteCmd := name
	for _, a := range args {
		remoteCmd += " " + shellQuote(a)
	}
	_, err := r.sshExec(ctx, remoteCmd)
	return err
}

func (r *Runner) sshExec(ctx context.Context, cmd string) ([]byte, error) {
	s := r.server
	var sshCmd string

	if s.SSHPassword != "" {
		sshCmd = fmt.Sprintf("sshpass -p '%s' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 -p %d %s@%s '%s'",
			s.SSHPassword, s.Port, s.SSHUser, s.Host, strings.ReplaceAll(cmd, "'", "'\\''"))
	} else if s.SSHKey != "" {
		// Write key to temp file, execute, cleanup
		sshCmd = fmt.Sprintf("echo '%s' > /tmp/sm_ssh_%s && chmod 600 /tmp/sm_ssh_%s && ssh -i /tmp/sm_ssh_%s -o StrictHostKeyChecking=no -o ConnectTimeout=15 -p %d %s@%s '%s'; rm -f /tmp/sm_ssh_%s",
			strings.ReplaceAll(s.SSHKey, "'", "'\\''"), s.ID[:8], s.ID[:8], s.ID[:8], s.Port, s.SSHUser, s.Host, strings.ReplaceAll(cmd, "'", "'\\''"), s.ID[:8])
	} else {
		return nil, fmt.Errorf("no SSH credentials for server %s", s.Label)
	}

	return exec.CommandContext(ctx, "bash", "-c", sshCmd).CombinedOutput()
}

// SCPTo copies a file to the remote server. No-op for local.
func (r *Runner) SCPTo(ctx context.Context, localPath, remotePath string) error {
	if r.server == nil {
		// Local: just copy
		return exec.CommandContext(ctx, "cp", "-r", localPath, remotePath).Run()
	}
	s := r.server
	var cmd string
	if s.SSHPassword != "" {
		cmd = fmt.Sprintf("sshpass -p '%s' scp -o StrictHostKeyChecking=no -P %d -r %s %s@%s:%s",
			s.SSHPassword, s.Port, localPath, s.SSHUser, s.Host, remotePath)
	} else {
		cmd = fmt.Sprintf("echo '%s' > /tmp/sm_scp_%s && chmod 600 /tmp/sm_scp_%s && scp -i /tmp/sm_scp_%s -o StrictHostKeyChecking=no -P %d -r %s %s@%s:%s; rm -f /tmp/sm_scp_%s",
			strings.ReplaceAll(s.SSHKey, "'", "'\\''"), s.ID[:8], s.ID[:8], s.ID[:8], s.Port, localPath, s.SSHUser, s.Host, remotePath, s.ID[:8])
	}
	return exec.CommandContext(ctx, "bash", "-c", cmd).Run()
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}
