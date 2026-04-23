package deploy

import (
	"bufio"
	"context"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/server/internal/db"
)

// Engine handles building and deploying projects as Docker containers.
type Engine struct {
	db          *db.DB
	Domain      string
	GitHub      *GitHubApp
	log         zerolog.Logger
	deployLocks sync.Map // per-project mutex to prevent concurrent deploys
}

// NewEngine creates a new deploy engine.
func NewEngine(database *db.DB, domain string, github *GitHubApp, log zerolog.Logger) *Engine {
	return &Engine{
		db:     database,
		Domain: domain,
		GitHub: github,
		log:    log.With().Str("component", "deploy").Logger(),
	}
}

// Deploy builds and runs a project.
func (e *Engine) Deploy(ctx context.Context, project *db.Project) error {
	// Per-project lock: prevent concurrent deploys for the same project
	val, _ := e.deployLocks.LoadOrStore(project.ID, &sync.Mutex{})
	mu := val.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()

	e.logMsg(ctx, project.ID, "Starting deployment...", "deploy")
	e.db.UpdateProjectStatus(ctx, project.ID, "building", "", 0)

	// Determine if deploying locally or to a remote server
	var runner *Runner
	var assignedServer *db.WorkerServer

	if project.WorkerServerID != "" {
		// Project already assigned to a server (BYOC or previously assigned)
		server, _ := e.db.GetWorkerServer(ctx, project.WorkerServerID)
		if server != nil {
			assignedServer = server
		}
	}

	// If no server assigned, try to auto-select a platform server
	if assignedServer == nil {
		server, _ := e.db.SelectServerForProject(ctx, nil)
		if server != nil {
			assignedServer = server
			e.db.AssignProjectServer(ctx, project.ID, server.ID)
			// Reserve actual plan-aware resources, not a hard-coded 0.5/512
			planMemMax, planCPUMax := e.planResourceCeiling(ctx, project.UserID)
			reserveMem := 512
			if planMemMax > 0 && planMemMax < reserveMem {
				reserveMem = planMemMax
			}
			if project.MemoryMB > 0 {
				reserveMem = project.MemoryMB
				if planMemMax > 0 && reserveMem > planMemMax {
					reserveMem = planMemMax
				}
			}
			reserveCPU := 0.5
			if planCPUMax > 0 && planCPUMax < reserveCPU {
				reserveCPU = planCPUMax
			}
			if project.CPUs > 0 {
				reserveCPU = project.CPUs
				if planCPUMax > 0 && reserveCPU > planCPUMax {
					reserveCPU = planCPUMax
				}
			}
			project.WorkerServerID = server.ID
			// Allocation is recomputed from reality by ReconcileServerAllocation
			// at the end of this deploy, so no need to manually add here.
			_ = reserveCPU
			_ = reserveMem
		}
	}

	if assignedServer != nil {
		// Belt-and-braces: treat localhost as local regardless of the is_local
		// flag. Even if scanning ever leaves IsLocal=false, we must never
		// try to SSH to "localhost" because that requires root SSH-to-self
		// to be set up, which it isn't on our box.
		isLocalHost := assignedServer.IsLocal ||
			assignedServer.Host == "localhost" ||
			assignedServer.Host == "127.0.0.1" ||
			assignedServer.Host == ""
		if isLocalHost {
			runner = NewLocalRunner()
			e.logMsg(ctx, project.ID, fmt.Sprintf("Deploying to %s (local Docker)", assignedServer.Label), "deploy")
		} else {
			runner = NewRemoteRunner(assignedServer)
			e.logMsg(ctx, project.ID, fmt.Sprintf("Deploying to server: %s (%s)", assignedServer.Label, assignedServer.Host), "deploy")
		}
	} else {
		runner = NewLocalRunner()
	}

	// Stop and remove existing container
	containerName := fmt.Sprintf("sm-%s", project.ID[:8])
	runner.Exec(ctx, "docker", "stop", containerName)
	runner.Exec(ctx, "docker", "rm", "-f", containerName)

	// Ensure data directory exists for persistence
	runner.Exec(ctx, "mkdir", "-p", fmt.Sprintf("/opt/serverme/project-data/%s", project.ID[:8]))

	// Clean build directory
	buildDir := fmt.Sprintf("/tmp/serverme-build/%s", project.ID)
	runner.Exec(ctx, "rm", "-rf", buildDir)
	runner.Exec(ctx, "mkdir", "-p", buildDir)

	// Clone repo if URL provided
	buildCtx := buildDir
	if project.RepoURL != "" {
		e.logMsg(ctx, project.ID, fmt.Sprintf("Cloning %s (branch: %s)...", maskToken(project.RepoURL), project.Branch), "build")

		cloneDir := buildDir + "/app"
		// If a specific commit is pinned we need full history; otherwise shallow clone is plenty.
		cloneArgs := []string{"clone", "--branch", project.Branch, project.RepoURL, cloneDir}
		if project.CommitSHA == "" {
			cloneArgs = []string{"clone", "--depth", "1", "--branch", project.Branch, project.RepoURL, cloneDir}
		}
		output, err := runner.Run(ctx, "git", cloneArgs...)
		if err != nil {
			e.logMsg(ctx, project.ID, fmt.Sprintf("Clone failed: %s", string(output)), "error")
			e.db.UpdateProjectStatus(ctx, project.ID, "failed", "", 0)
			return fmt.Errorf("git clone: %w", err)
		}
		buildCtx = cloneDir

		// Check out a specific commit if requested (rollbacks / pinned deploys).
		if project.CommitSHA != "" {
			e.logMsg(ctx, project.ID, fmt.Sprintf("Checking out commit %s...", project.CommitSHA[:min(8, len(project.CommitSHA))]), "build")
			// Validate SHA is hex only before interpolating into a shell command.
			// A SHA like "'; touch /tmp/pwned; '" would otherwise run on the host.
			if !isValidCommitSHA(project.CommitSHA) {
				e.logMsg(ctx, project.ID, "Invalid commit SHA format — aborting", "error")
				e.db.UpdateProjectStatus(ctx, project.ID, "failed", "", 0)
				return fmt.Errorf("invalid commit SHA")
			}
			out, err := runner.RunShell(ctx, fmt.Sprintf("cd %s && git checkout %s", cloneDir, project.CommitSHA))
			if err != nil {
				e.logMsg(ctx, project.ID, fmt.Sprintf("Checkout failed: %s", string(out)), "error")
				e.db.UpdateProjectStatus(ctx, project.ID, "failed", "", 0)
				return fmt.Errorf("git checkout: %w", err)
			}
		}

		// Record the SHA we actually built (HEAD after checkout) so the UI can show it.
		if shaOut, err := runner.RunShell(ctx, fmt.Sprintf("cd %s && git rev-parse HEAD", cloneDir)); err == nil {
			if sha := strings.TrimSpace(string(shaOut)); sha != "" {
				e.db.UpdateProjectCommitSHA(ctx, project.ID, sha)
			}
		}
	}

	// Apply root_dir (for monorepos: build from a subdirectory of the repo)
	if project.RootDir != "" {
		trimmed := strings.Trim(project.RootDir, "/")
		if trimmed != "" {
			buildCtx = buildCtx + "/" + trimmed
			e.logMsg(ctx, project.ID, fmt.Sprintf("Root directory: %s", trimmed), "build")
		}
	}

	// Determine framework — for remote, check via runner; for local, use filesystem
	var framework string
	// ignore_dockerfile: pretend the repo's Dockerfile doesn't exist. Useful when
	// a project's checked-in Dockerfile is stale or wrong and the user wants
	// ServerMe's auto-generated one (with the configured node version, install
	// command, prisma auto-push, etc.) to take over.
	ignoreRepoDockerfile := project.BuildMode == "ignore_dockerfile"

	if runner.IsRemote() {
		// Remote: check files via SSH
		out, _ := runner.RunShell(ctx, fmt.Sprintf("ls %s/Dockerfile %s/next.config.* %s/package.json %s/requirements.txt %s/go.mod %s/index.html 2>/dev/null", buildCtx, buildCtx, buildCtx, buildCtx, buildCtx, buildCtx))
		files := string(out)
		if !ignoreRepoDockerfile && strings.Contains(files, "Dockerfile") {
			framework = "docker"
		} else if strings.Contains(files, "next.config") {
			framework = "nextjs"
		} else if strings.Contains(files, "package.json") {
			framework = "node"
		} else if strings.Contains(files, "requirements.txt") {
			framework = "python"
		} else if strings.Contains(files, "index.html") {
			framework = "static"
		} else {
			framework = "node"
		}
	} else {
		if ignoreRepoDockerfile {
			framework = e.detectFrameworkIgnoreDocker(buildCtx)
		} else {
			framework = e.detectFramework(buildCtx)
		}
	}
	if framework == "node" && project.Framework != "" && project.Framework != "node" {
		framework = project.Framework
	}
	e.logMsg(ctx, project.ID, fmt.Sprintf("Framework: %s", framework), "build")
	if ignoreRepoDockerfile {
		e.logMsg(ctx, project.ID, "Ignoring repo Dockerfile (build_mode=ignore_dockerfile)", "build")
	}

	// Generate Dockerfile if repo doesn't have one, OR if user asked us to ignore theirs.
	if runner.IsRemote() {
		out, _ := runner.RunShell(ctx, fmt.Sprintf("test -f %s/Dockerfile && echo yes || echo no", buildCtx))
		exists := strings.TrimSpace(string(out)) == "yes"
		if !exists || ignoreRepoDockerfile {
			dockerfile := e.generateDockerfile(project, framework)
			if dockerfile != "" {
				runner.RunShell(ctx, fmt.Sprintf("cat > %s/Dockerfile << 'SMEOF'\n%s\nSMEOF", buildCtx, dockerfile))
			}
		}
	} else {
		if !fileExists(buildCtx+"/Dockerfile") || ignoreRepoDockerfile {
			dockerfile := e.generateDockerfile(project, framework)
			if dockerfile != "" {
				os.WriteFile(buildCtx+"/Dockerfile", []byte(dockerfile), 0644)
			}
		}
	}

	// Verify Dockerfile exists
	if runner.IsRemote() {
		out, _ := runner.RunShell(ctx, fmt.Sprintf("test -f %s/Dockerfile && echo yes || echo no", buildCtx))
		if strings.TrimSpace(string(out)) != "yes" {
			e.logMsg(ctx, project.ID, "No Dockerfile found in repository.", "error")
			e.db.UpdateProjectStatus(ctx, project.ID, "failed", "", 0)
			return fmt.Errorf("no Dockerfile")
		}
	} else if !fileExists(buildCtx + "/Dockerfile") {
		e.logMsg(ctx, project.ID, "No Dockerfile found in repository.", "error")
		e.db.UpdateProjectStatus(ctx, project.ID, "failed", "", 0)
		return fmt.Errorf("no Dockerfile")
	}

	// Determine container port: user override > Dockerfile EXPOSE > default 3000
	containerPort := 3000
	if runner.IsRemote() {
		out, _ := runner.RunShell(ctx, fmt.Sprintf("grep -i '^EXPOSE' %s/Dockerfile | head -1 | grep -oE '[0-9]+'", buildCtx))
		if p := strings.TrimSpace(string(out)); p != "" {
			if pp, err := strconv.Atoi(p); err == nil {
				containerPort = pp
			}
		}
	} else {
		containerPort = detectExposedPort(buildCtx + "/Dockerfile")
	}
	if project.PortOverride > 0 {
		containerPort = project.PortOverride
		e.logMsg(ctx, project.ID, fmt.Sprintf("Using custom port: %d", containerPort), "build")
	} else {
		e.logMsg(ctx, project.ID, fmt.Sprintf("Detected container port: %d", containerPort), "build")
	}

	// Build Docker image with a 20-minute cap so a hung build can't wedge the project in "building" forever.
	imageName := fmt.Sprintf("sm-project-%s", project.ID[:8])
	e.logMsg(ctx, project.ID, "Building Docker image (this may take a few minutes)...", "build")

	buildCtx2, cancelBuild := context.WithTimeout(ctx, 20*time.Minute)
	output, err := runner.Run(buildCtx2, "docker", "build", "--no-cache", "--memory=2g", "-t", imageName, buildCtx)
	cancelBuild()
	if err != nil {
		errMsg := extractBuildError(string(output))
		if buildCtx2.Err() == context.DeadlineExceeded {
			errMsg = "build timed out after 20 minutes"
		}
		e.logMsg(ctx, project.ID, fmt.Sprintf("Build failed: %s", errMsg), "error")
		e.db.UpdateProjectStatus(ctx, project.ID, "failed", "", 0)
		return fmt.Errorf("docker build: %w", err)
	}
	e.logMsg(ctx, project.ID, "Build successful", "build")

	// Find available host port
	hostPort := 10100 + rand.Intn(900)
	for i := 0; i < 50; i++ {
		if !isPortInUse(hostPort) {
			break
		}
		hostPort = 10100 + rand.Intn(900)
	}

	// Auto-inject DATABASE_URL if project has a managed database
	projDB, _ := e.db.GetProjectDatabase(ctx, project.ID)
	if projDB != nil {
		if project.EnvVars == nil {
			project.EnvVars = make(map[string]string)
		}
		project.EnvVars["DATABASE_URL"] = projDB.ConnectionURL()
	}

	// Build env var flags (skip comments, strip quotes)
	var envFlags []string
	for k, v := range project.EnvVars {
		if strings.HasPrefix(k, "#") || strings.TrimSpace(k) == "" {
			continue
		}
		// Strip surrounding quotes that users often copy from .env files
		v = strings.TrimPrefix(v, "\"")
		v = strings.TrimSuffix(v, "\"")
		v = strings.TrimPrefix(v, "'")
		v = strings.TrimSuffix(v, "'")
		envFlags = append(envFlags, "-e", fmt.Sprintf("%s=%s", k, v))
	}
	// Always set PORT env var
	envFlags = append(envFlags, "-e", fmt.Sprintf("PORT=%d", containerPort))

	// Detect all exposed ports and map them
	allPorts := detectAllExposedPorts(buildCtx + "/Dockerfile")

	// Run container
	e.logMsg(ctx, project.ID, "Starting container...", "deploy")
	args := []string{"run", "-d", "--name", containerName}

	// Map primary port
	args = append(args, "-p", fmt.Sprintf("%d:%d", hostPort, containerPort))

	// Map additional ports
	for _, p := range allPorts {
		if p != containerPort {
			extraHost := 10100 + rand.Intn(900)
			for isPortInUse(extraHost) || extraHost == hostPort {
				extraHost = 10100 + rand.Intn(900)
			}
			args = append(args, "-p", fmt.Sprintf("%d:%d", extraHost, p))
		}
	}

	// Resource limits: clamp against the user's plan ceiling ONLY when
	// deploying to a platform-owned server. If this project lives on the
	// user's own BYOC VPS, they're paying for that compute themselves — plan
	// caps don't apply, use the whole box if they want it.
	planMemMax, planCPUMax := e.planResourceCeiling(ctx, project.UserID)
	if assignedServer != nil && assignedServer.UserID != nil && *assignedServer.UserID == project.UserID {
		planMemMax, planCPUMax = 0, 0
	}
	// Default to the plan ceiling when the user didn't specify — matches what
	// the billing page advertises, and avoids the old behaviour of starting
	// at 512/0.5 and silently clamping free users down to 256/0.25.
	memMB := 512
	if planMemMax > 0 && planMemMax < memMB {
		memMB = planMemMax
	}
	if project.MemoryMB > 0 {
		memMB = project.MemoryMB
	}
	if planMemMax > 0 && memMB > planMemMax {
		e.logMsg(ctx, project.ID, fmt.Sprintf("Memory clamped to plan ceiling: %d MB (requested %d)", planMemMax, memMB), "build")
		memMB = planMemMax
	}
	cpus := 0.5
	if planCPUMax > 0 && planCPUMax < cpus {
		cpus = planCPUMax
	}
	if project.CPUs > 0 {
		cpus = project.CPUs
	}
	if planCPUMax > 0 && cpus > planCPUMax {
		e.logMsg(ctx, project.ID, fmt.Sprintf("CPU clamped to plan ceiling: %.2f vCPU (requested %.2f)", planCPUMax, cpus), "build")
		cpus = planCPUMax
	}
	args = append(args, "--restart", "unless-stopped",
		"--memory", fmt.Sprintf("%dm", memMB),
		"--cpus", strconv.FormatFloat(cpus, 'f', -1, 64),
		// Container hardening — prevents privilege escalation and raw-socket
		// based attacks (ARP spoof, port scanning tricks) while staying
		// compatible with the overwhelming majority of user apps.
		"--security-opt", "no-new-privileges=true",
		"--cap-drop", "NET_RAW",
	)

	// Add data volume for persistence
	args = append(args, "-v", fmt.Sprintf("/opt/serverme/project-data/%s:/app/data", project.ID[:8]))
	args = append(args, envFlags...)

	// Release command: runs once before the app container starts (e.g. migrations).
	// Uses the same image + env vars, in a one-shot --rm container. If it fails, we
	// abort the deploy so broken migrations don't take the running site down.
	if project.ReleaseCmd != "" {
		e.logMsg(ctx, project.ID, fmt.Sprintf("Running release command: %s", project.ReleaseCmd), "deploy")
		// Release containers get the same hardening as the main container.
		releaseArgs := []string{"run", "--rm",
			"--security-opt", "no-new-privileges=true",
			"--cap-drop", "NET_RAW",
		}
		releaseArgs = append(releaseArgs, envFlags...)
		releaseArgs = append(releaseArgs, imageName, "sh", "-c", project.ReleaseCmd)
		relCtx, relCancel := context.WithTimeout(ctx, 10*time.Minute)
		relOut, relErr := runner.Run(relCtx, "docker", releaseArgs...)
		relCancel()
		if relErr != nil {
			e.logMsg(ctx, project.ID, fmt.Sprintf("Release command failed:\n%s", trimLogs(string(relOut), 2000)), "error")
			e.db.UpdateProjectStatus(ctx, project.ID, "failed", "", 0)
			return fmt.Errorf("release cmd: %w", relErr)
		}
		if out := strings.TrimSpace(string(relOut)); out != "" {
			e.logMsg(ctx, project.ID, fmt.Sprintf("Release output:\n%s", trimLogs(out, 1000)), "build")
		}
		e.logMsg(ctx, project.ID, "Release command succeeded", "deploy")
	}

	args = append(args, imageName)

	containerOutput, err := runner.Run(ctx, "docker", args...)
	if err != nil {
		e.logMsg(ctx, project.ID, fmt.Sprintf("Run failed: %s", string(containerOutput)), "error")
		e.db.UpdateProjectStatus(ctx, project.ID, "failed", "", 0)
		return fmt.Errorf("docker run: %w", err)
	}

	containerID := strings.TrimSpace(string(containerOutput))
	if len(containerID) > 12 {
		containerID = containerID[:12]
	}

	// Health check: poll the app until it responds 2xx (or timeout).
	// If health_check_path is set, we HTTP-probe that path on the host port.
	// Otherwise we fall back to the old "container still running after 5s" check.
	healthy := e.waitForHealthy(ctx, project, runner, containerName, hostPort)

	if healthy {
		e.db.UpdateProjectStatus(ctx, project.ID, "running", containerID, hostPort)
		e.logMsg(ctx, project.ID, fmt.Sprintf("Deployed at https://%s.%s (port: %d)", project.Subdomain, e.Domain, hostPort), "deploy")
	} else {
		crashOut, _ := runner.Run(ctx, "docker", "logs", "--tail", "20", containerName)
		e.logMsg(ctx, project.ID, fmt.Sprintf("Container unhealthy — check logs:\n%s", trimLogs(string(crashOut), 2000)), "error")
		e.db.UpdateProjectStatus(ctx, project.ID, "failed", containerID, hostPort)
	}
	// Recompute the server's resource allocation from the actual set of
	// running projects. Works for both platform + BYOC servers.
	if assignedServer != nil {
		e.db.ReconcileServerAllocation(ctx, assignedServer.ID)
	}

	e.registerRoute(project.Subdomain, hostPort)

	// Cleanup
	runner.Exec(ctx, "rm", "-rf", buildDir)

	return nil
}

// Stop stops a project's container.
func (e *Engine) Stop(ctx context.Context, project *db.Project) error {
	runner := e.getRunner(ctx, project)
	containerName := fmt.Sprintf("sm-%s", project.ID[:8])
	runner.Exec(ctx, "docker", "stop", containerName)
	runner.Exec(ctx, "docker", "rm", "-f", containerName)
	e.db.UpdateProjectStatus(ctx, project.ID, "stopped", "", 0)
	e.logMsg(ctx, project.ID, "Project stopped", "deploy")
	return nil
}

// Delete stops and removes a project completely.
func (e *Engine) Delete(ctx context.Context, project *db.Project) error {
	e.Stop(ctx, project)
	runner := e.getRunner(ctx, project)
	runner.Exec(ctx, "docker", "rmi", fmt.Sprintf("sm-project-%s", project.ID[:8]))
	return nil
}

// getRunner returns a local or remote runner based on the project's worker
// server. Projects on the local platform row (is_local=true) use LocalRunner
// — SSH-to-self would hang on credential lookup since the local row has no
// SSH password.
func (e *Engine) getRunner(ctx context.Context, project *db.Project) *Runner {
	if project.WorkerServerID != "" {
		server, _ := e.db.GetWorkerServer(ctx, project.WorkerServerID)
		if server != nil {
			isLocalHost := server.IsLocal ||
				server.Host == "localhost" ||
				server.Host == "127.0.0.1" ||
				server.Host == ""
			if !isLocalHost {
				return NewRemoteRunner(server)
			}
		}
	}
	return NewLocalRunner()
}

// GetProjectPort returns the container port for a deployed project by subdomain.
func (e *Engine) GetProjectPort(subdomain string) (int, bool) {
	port, _, ok := e.GetProjectRouting(subdomain)
	return port, ok
}

// GetProjectRouting returns port + project ID in one query — used by the proxy
// so it can both forward the request AND emit an analytics event tagged with
// the right project without a second DB round trip.
func (e *Engine) GetProjectRouting(subdomain string) (int, string, bool) {
	ctx := context.Background()
	rows, err := e.db.Pool.Query(ctx,
		`SELECT container_port, id FROM projects WHERE subdomain = $1 AND status = 'running' AND container_port > 0`,
		subdomain,
	)
	if err != nil {
		return 0, "", false
	}
	defer rows.Close()
	if rows.Next() {
		var port int
		var id string
		rows.Scan(&port, &id)
		return port, id, port > 0
	}
	return 0, "", false
}

func (e *Engine) registerRoute(subdomain string, port int) {
	e.log.Info().Str("subdomain", subdomain).Int("port", port).Msg("route registered")
}

func (e *Engine) logMsg(ctx context.Context, projectID, message, level string) {
	e.db.AddDeployLog(ctx, projectID, message, level)
	e.log.Info().Str("project", projectID).Str("level", level).Msg(message)
}

// --- Helpers ---

// detectFramework auto-detects the project framework from files.
func (e *Engine) detectFramework(dir string) string {
	if fileExists(dir + "/Dockerfile") {
		return "docker"
	}
	return e.detectFrameworkIgnoreDocker(dir)
}

// detectFrameworkIgnoreDocker is like detectFramework but never returns "docker"
// for the Dockerfile case — used when build_mode=ignore_dockerfile so we fall
// back to our auto-generated Dockerfile instead of the repo's.
func (e *Engine) detectFrameworkIgnoreDocker(dir string) string {
	if fileExists(dir + "/next.config.js") || fileExists(dir + "/next.config.ts") || fileExists(dir + "/next.config.mjs") {
		return "nextjs"
	}
	if fileExists(dir + "/package.json") {
		return "node"
	}
	if fileExists(dir + "/requirements.txt") || fileExists(dir + "/Pipfile") {
		return "python"
	}
	if fileExists(dir + "/go.mod") {
		return "docker"
	}
	if fileExists(dir + "/index.html") || hasAnyFile(dir, "*.html") {
		return "static"
	}
	return "node"
}

// detectAllExposedPorts returns all EXPOSE ports from a Dockerfile.
func detectAllExposedPorts(dockerfilePath string) []int {
	f, err := os.Open(dockerfilePath)
	if err != nil {
		return nil
	}
	defer f.Close()

	re := regexp.MustCompile(`\d+`)
	scanner := bufio.NewScanner(f)
	var ports []int

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(strings.ToUpper(line), "EXPOSE") {
			for _, match := range re.FindAllString(line, -1) {
				if p, err := strconv.Atoi(match); err == nil && p > 0 {
					ports = append(ports, p)
				}
			}
		}
	}
	return ports
}

// detectExposedPort reads the Dockerfile and finds the first EXPOSE port.
func detectExposedPort(dockerfilePath string) int {
	f, err := os.Open(dockerfilePath)
	if err != nil {
		return 3000 // default
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	re := regexp.MustCompile(`(?i)^EXPOSE\s+(\d+)`)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if matches := re.FindStringSubmatch(line); len(matches) > 1 {
			if port, err := strconv.Atoi(matches[1]); err == nil {
				return port
			}
		}
	}
	return 3000
}

// checkContainerHealth checks if a container is running (not restarting).
func (e *Engine) checkContainerHealth(name string) bool {
	output, err := exec.Command("docker", "inspect", "--format", "{{.State.Status}}", name).Output()
	if err != nil {
		return false
	}
	status := strings.TrimSpace(string(output))
	return status == "running"
}

// getContainerLogs returns the last N lines of container logs.
func getContainerLogs(name string, lines int) string {
	output, _ := exec.Command("docker", "logs", "--tail", strconv.Itoa(lines), name).CombinedOutput()
	return strings.TrimSpace(string(output))
}

// extractBuildError extracts the meaningful error from Docker build output.
func extractBuildError(output string) string {
	lines := strings.Split(output, "\n")
	// Find lines with "error", "ERROR", "failed", "FAILED"
	var errorLines []string
	for _, line := range lines {
		lower := strings.ToLower(line)
		if strings.Contains(lower, "error") || strings.Contains(lower, "failed") || strings.Contains(lower, "not found") {
			errorLines = append(errorLines, strings.TrimSpace(line))
		}
	}
	if len(errorLines) > 0 {
		// Return last 3 error lines
		start := len(errorLines) - 3
		if start < 0 {
			start = 0
		}
		return strings.Join(errorLines[start:], "\n")
	}
	// Fallback: last 5 lines
	start := len(lines) - 5
	if start < 0 {
		start = 0
	}
	return strings.Join(lines[start:], "\n")
}

// planResourceCeiling returns (max_memory_mb, max_cpus) for a user's plan, or
// (0, 0) for "unlimited" (admin / -1 sentinel) so the caller skips clamping.
func (e *Engine) planResourceCeiling(ctx context.Context, userID string) (int, float64) {
	if userID == "" {
		return 0, 0
	}
	if isAdmin, _ := e.db.IsUserAdmin(ctx, userID); isAdmin {
		return 0, 0
	}
	user, err := e.db.GetUserByID(ctx, userID)
	if err != nil || user == nil {
		return 0, 0
	}
	limits, err := e.db.GetPlanLimits(ctx, user.Plan)
	if err != nil || limits == nil {
		return 0, 0
	}
	memMax, cpuMax := limits.MaxMemoryMB, limits.MaxCPUs
	if db.Unlimited(memMax) {
		memMax = 0
	}
	if cpuMax < 0 {
		cpuMax = 0
	}
	return memMax, cpuMax
}

// isValidCommitSHA accepts only hex strings (7-64 chars) — anything else
// would be a shell injection attempt when interpolated into `git checkout`.
var validCommitSHARe = regexp.MustCompile(`^[a-fA-F0-9]{7,64}$`)

func isValidCommitSHA(s string) bool {
	return validCommitSHARe.MatchString(s)
}

// trimLogs truncates a log string to at most n characters, keeping the tail
// (where errors usually are).
func trimLogs(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return "... (truncated) ...\n" + s[len(s)-n:]
}

// waitForHealthy polls the project until it's healthy, or returns false on timeout.
// If a health_check_path is configured we HTTP-probe the host port; otherwise we
// fall back to the previous behaviour of "container is in 'running' state after 5s".
func (e *Engine) waitForHealthy(ctx context.Context, project *db.Project, runner *Runner, containerName string, hostPort int) bool {
	deadline := time.Now().Add(60 * time.Second)

	// Quick sanity: if the container exited within the first 2s, no point polling HTTP.
	time.Sleep(2 * time.Second)
	statusOut, _ := runner.Run(ctx, "docker", "inspect", "--format", "{{.State.Status}}", containerName)
	status := strings.TrimSpace(string(statusOut))
	if status != "running" {
		return false
	}

	// No path configured → keep the old, lenient "container still up after 5s" behaviour.
	if project.HealthCheckPath == "" {
		time.Sleep(3 * time.Second) // total ~5s, matches previous behaviour
		statusOut, _ := runner.Run(ctx, "docker", "inspect", "--format", "{{.State.Status}}", containerName)
		return strings.TrimSpace(string(statusOut)) == "running"
	}

	// HTTP health check: poll the path until it responds 2xx or we run out of time.
	e.logMsg(ctx, project.ID, fmt.Sprintf("Health-checking %s ...", project.HealthCheckPath), "deploy")
	healthClient := &http.Client{Timeout: 3 * time.Second}
	url := fmt.Sprintf("http://127.0.0.1:%d%s", hostPort, project.HealthCheckPath)

	for time.Now().Before(deadline) {
		// Abort fast if the container has already crashed.
		statusOut, _ := runner.Run(ctx, "docker", "inspect", "--format", "{{.State.Status}}", containerName)
		if strings.TrimSpace(string(statusOut)) != "running" {
			return false
		}
		resp, err := healthClient.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 400 {
				e.logMsg(ctx, project.ID, fmt.Sprintf("Health check passed (%d)", resp.StatusCode), "deploy")
				return true
			}
		}
		time.Sleep(2 * time.Second)
	}

	e.logMsg(ctx, project.ID, "Health check timed out after 60s", "error")
	return false
}

// maskToken hides tokens in URLs for logging.
func maskToken(url string) string {
	if idx := strings.Index(url, "@"); idx > 0 {
		prefix := url[:strings.Index(url, "://")+3]
		suffix := url[idx:]
		return prefix + "***" + suffix
	}
	return url
}

// isPortInUse checks if a port is already in use.
func isPortInUse(port int) bool {
	output, _ := exec.Command("ss", "-tlnp", fmt.Sprintf("sport = :%d", port)).Output()
	return strings.Contains(string(output), strconv.Itoa(port))
}

// fileExists checks if a file exists.
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// hasAnyFile returns true if at least one file matching `pattern` exists
// directly inside `dir`. Used so a repo with only foo.html (no index.html)
// still gets classified as "static" during auto-detect.
func hasAnyFile(dir, pattern string) bool {
	matches, _ := filepath.Glob(filepath.Join(dir, pattern))
	return len(matches) > 0
}

// generateDockerfile creates a Dockerfile based on framework.
func (e *Engine) generateDockerfile(project *db.Project, framework string) string {
	// Node version (default 20)
	nodeVer := "20"
	if project.NodeVersion != "" {
		nodeVer = project.NodeVersion
	}

	// Prisma push snippet — reused by node + nextjs
	prismaPush := `if [ -d "prisma" ] && [ -n "$DATABASE_URL" ]; then echo "[serverme] pushing Prisma schema..."; npx prisma db push --accept-data-loss || echo "[serverme] prisma db push failed — continuing anyway"; fi`

	switch framework {
	case "nextjs":
		installCmd := project.InstallCmd
		if installCmd == "" {
			installCmd = "npm ci"
		}
		buildCmd := project.BuildCmd
		if buildCmd == "" {
			buildCmd = "npm run build"
		}
		startCmd := project.StartCmd
		if startCmd == "" {
			startCmd = "npm start"
		}
		return fmt.Sprintf(`FROM node:%s-alpine
WORKDIR /app
COPY package*.json ./
RUN %s
COPY . .
RUN if [ -d "prisma" ]; then npx prisma generate; fi
ENV NODE_OPTIONS="--max-old-space-size=1536"
RUN %s
EXPOSE 3000
CMD sh -c '%s && %s'`, nodeVer, installCmd, buildCmd, prismaPush, startCmd)

	case "node":
		// Install full deps (incl. dev) so TypeScript, bundlers, prisma, etc.
		// are available for the build step. `--ignore-scripts` skips the
		// user's `postinstall` hook — otherwise a common pattern like
		// `postinstall: npm run build` fires before COPY . . and fails
		// because source files aren't in the layer yet. We run the build
		// explicitly below after all files are copied.
		installCmd := project.InstallCmd
		if installCmd == "" {
			installCmd = "npm ci --ignore-scripts"
		}
		startCmd := project.StartCmd
		if startCmd == "" {
			startCmd = "npm start"
		}
		// Auto-detect build: explicit BuildCmd wins; otherwise run `npm run
		// build` if package.json has one. Covers the 90% case of TypeScript
		// repos whose start script references a compiled dist/.
		buildLine := "RUN if grep -q '\"build\"' package.json 2>/dev/null; then npm run build; fi"
		if project.BuildCmd != "" {
			buildLine = "RUN " + project.BuildCmd
		}
		return fmt.Sprintf(`FROM node:%s-alpine
WORKDIR /app
# Native module build toolchain. Alpine is tiny but misses gcc/python used by
# packages like bcrypt, node-gyp, sharp. Installed here (not apk del'd later)
# because prune gets them out of the final stage anyway.
RUN apk add --no-cache --virtual .build-deps python3 make g++ 2>/dev/null || true
COPY package*.json ./
# --ignore-scripts skips user lifecycle hooks (preinstall/postinstall/install)
# so a common pattern like "postinstall: npm run build" can't fire before
# COPY . . — source files aren't in the layer yet.
RUN %s
COPY . .
# Rebuild native modules now that build tools AND source are present.
# Handles bcrypt, better-sqlite3, sharp, canvas, etc.
RUN npm rebuild 2>/dev/null || true
# Prisma schema autodetect — finds it anywhere (prisma/, src/prisma/, db/, …).
RUN SCHEMA=$(find . -name schema.prisma -not -path "./node_modules/*" 2>/dev/null | head -1); \
    if [ -n "$SCHEMA" ]; then npx prisma generate --schema="$SCHEMA" || true; fi
ENV NODE_OPTIONS="--max-old-space-size=1536"
%s
RUN npm prune --production 2>/dev/null || true
EXPOSE 3000
CMD sh -c '%s && %s'`, nodeVer, installCmd, buildLine, prismaPush, startCmd)

	case "python":
		// Install strategy:
		//   • requirements.txt present → pip install it (most common)
		//   • pyproject.toml present   → pip install . (PEP-621 projects)
		//   • neither                  → no-op (script-only repos still run)
		// The COPY-all-first approach means missing requirements.txt doesn't
		// fail the build (the old `COPY requirements.txt* ./` glob failed
		// with "no source files were specified" on script-only repos).
		installCmd := project.InstallCmd
		if installCmd == "" {
			installCmd = `if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; ` +
				`elif [ -f pyproject.toml ]; then pip install --no-cache-dir .; ` +
				`else echo "[serverme] no requirements.txt or pyproject.toml — skipping pip install"; fi`
		}
		startCmd := project.StartCmd
		if startCmd == "" {
			// Entry-point detection, in priority order:
			//   1. app.py          (Flask/FastAPI convention)
			//   2. main.py         (common name)
			//   3. run.py          (older Flask convention)
			//   4. manage.py       (Django)
			//   5. __main__.py     (Python package convention)
			//   6. A single runnable *.py file at repo root (excluding setup.py,
			//      conftest.py, test_*.py, *_test.py — which aren't entry points)
			//   7. Error with a listing of what was found so users can debug.
			startCmd = `` +
				`if [ -f app.py ]; then python app.py; ` +
				`elif [ -f main.py ]; then python main.py; ` +
				`elif [ -f run.py ]; then python run.py; ` +
				`elif [ -f manage.py ]; then python manage.py runserver 0.0.0.0:3000; ` +
				`elif [ -f __main__.py ]; then python .; ` +
				`else ` +
				`  CANDIDATES=""; ` +
				`  for f in *.py; do ` +
				`    [ -f "$f" ] || continue; ` +
				`    case "$f" in setup.py|conftest.py|test_*.py|*_test.py) continue;; esac; ` +
				`    CANDIDATES="$CANDIDATES $f"; ` +
				`  done; ` +
				`  set -- $CANDIDATES; ` +
				`  if [ "$#" = "1" ]; then ` +
				`    echo "[serverme] auto-detected single script: $1"; exec python "$1"; ` +
				`  else ` +
				`    echo "[serverme] No entry point found."; ` +
				`    echo "[serverme] Contents of /app:"; ls -la /app | sed "s/^/[serverme]   /"; ` +
				`    echo "[serverme] Expected one of: app.py, main.py, run.py, manage.py, __main__.py, or a single runnable *.py at repo root."; ` +
				`    echo "[serverme] Candidates found: [$CANDIDATES ]"; ` +
				`    echo "[serverme] Set a custom Start Command in project settings (e.g., python emailchk.py)."; ` +
				`    exit 1; ` +
				`  fi; ` +
				`fi`
		}
		return fmt.Sprintf(`FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN %s
EXPOSE 3000
CMD sh -c %q`, installCmd, startCmd)

	case "static":
		// Two fallbacks so users don't hit the nginx welcome page:
		//   1. nginx's default /usr/share/nginx/html is wiped before COPY so
		//      the stock "Welcome to nginx!" index.html never wins.
		//   2. If the repo has no index.html but exactly one *.html, we
		//      symlink it as index.html so that single file is served at /.
		//   3. If the repo has many .html files and no index, we generate a
		//      tiny directory listing so the site at least shows something
		//      useful instead of a 403/welcome page.
		// BusyBox-compatible (alpine has no GNU find -printf). Using shell
		// globs + basename keeps it portable across nginx:alpine versions.
		return "FROM nginx:alpine\n" +
			"RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf\n" +
			"COPY . /usr/share/nginx/html\n" +
			"RUN set -e; cd /usr/share/nginx/html; \\\n" +
			"    if [ ! -f index.html ]; then \\\n" +
			"      files=''; count=0; \\\n" +
			"      for f in *.html; do \\\n" +
			"        [ -e \"$f\" ] || continue; \\\n" +
			"        files=\"$files $f\"; count=$((count + 1)); \\\n" +
			"      done; \\\n" +
			"      if [ \"$count\" = \"1\" ]; then \\\n" +
			"        only=$(echo $files | tr -d ' '); \\\n" +
			"        ln -s \"$only\" index.html; \\\n" +
			"      elif [ \"$count\" -gt \"1\" ]; then \\\n" +
			"        { \\\n" +
			"          echo '<!doctype html><meta charset=utf-8><title>Index</title>'; \\\n" +
			"          echo '<style>body{font:14px system-ui;padding:40px;max-width:600px;margin:auto}a{display:block;padding:8px 0;color:#0969da}</style><h1>Pages</h1>'; \\\n" +
			"          for f in $files; do printf '<a href=\"%s\">%s</a>\\n' \"$f\" \"$f\"; done; \\\n" +
			"        } > index.html; \\\n" +
			"      fi; \\\n" +
			"    fi\n" +
			"RUN printf 'server { listen 80; root /usr/share/nginx/html; index index.html; location / { try_files $uri $uri.html $uri/ /index.html =404; } }\\n' > /etc/nginx/conf.d/default.conf\n" +
			"EXPOSE 80\n" +
			"CMD [\"nginx\", \"-g\", \"daemon off;\"]"

	default:
		return ""
	}
}

func formatCmd(cmd string) string {
	parts := strings.Fields(cmd)
	quoted := make([]string, len(parts))
	for i, p := range parts {
		quoted[i] = fmt.Sprintf(`"%s"`, p)
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}
