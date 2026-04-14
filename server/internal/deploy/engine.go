package deploy

import (
	"bufio"
	"context"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
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
			e.db.AllocateServerResources(ctx, server.ID, 0.5, 512)
			project.WorkerServerID = server.ID
		}
	}

	if assignedServer != nil {
		runner = NewRemoteRunner(assignedServer)
		e.logMsg(ctx, project.ID, fmt.Sprintf("Deploying to server: %s (%s)", assignedServer.Label, assignedServer.Host), "deploy")
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

	// Resource limits: user override > defaults (512m / 0.5 CPU)
	memLimit := "512m"
	if project.MemoryMB > 0 {
		memLimit = fmt.Sprintf("%dm", project.MemoryMB)
	}
	cpuLimit := "0.5"
	if project.CPUs > 0 {
		cpuLimit = strconv.FormatFloat(project.CPUs, 'f', -1, 64)
	}
	args = append(args, "--restart", "unless-stopped", "--memory", memLimit, "--cpus", cpuLimit)

	// Add data volume for persistence
	args = append(args, "-v", fmt.Sprintf("/opt/serverme/project-data/%s:/app/data", project.ID[:8]))
	args = append(args, envFlags...)

	// Release command: runs once before the app container starts (e.g. migrations).
	// Uses the same image + env vars, in a one-shot --rm container. If it fails, we
	// abort the deploy so broken migrations don't take the running site down.
	if project.ReleaseCmd != "" {
		e.logMsg(ctx, project.ID, fmt.Sprintf("Running release command: %s", project.ReleaseCmd), "deploy")
		releaseArgs := []string{"run", "--rm"}
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

// getRunner returns a local or remote runner based on the project's worker server.
func (e *Engine) getRunner(ctx context.Context, project *db.Project) *Runner {
	if project.WorkerServerID != "" {
		server, _ := e.db.GetWorkerServer(ctx, project.WorkerServerID)
		if server != nil {
			return NewRemoteRunner(server)
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
	if fileExists(dir + "/index.html") {
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
		installCmd := project.InstallCmd
		if installCmd == "" {
			installCmd = "npm ci --production"
		}
		startCmd := project.StartCmd
		if startCmd == "" {
			startCmd = "npm start"
		}
		// Build step is optional for plain Node
		buildLine := ""
		if project.BuildCmd != "" {
			buildLine = "RUN " + project.BuildCmd + "\n"
		}
		return fmt.Sprintf(`FROM node:%s-alpine
WORKDIR /app
COPY package*.json ./
RUN %s
COPY . .
RUN if [ -d "prisma" ]; then npx prisma generate; fi
%sEXPOSE 3000
CMD sh -c '%s && %s'`, nodeVer, installCmd, buildLine, prismaPush, startCmd)

	case "python":
		installCmd := project.InstallCmd
		if installCmd == "" {
			installCmd = "pip install --no-cache-dir -r requirements.txt 2>/dev/null || true"
		}
		startCmd := project.StartCmd
		if startCmd == "" {
			startCmd = "python app.py"
		}
		return fmt.Sprintf(`FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt* ./
RUN %s
COPY . .
EXPOSE 3000
CMD %s`, installCmd, formatCmd(startCmd))

	case "static":
		return `FROM nginx:alpine
COPY . /usr/share/nginx/html
RUN echo 'server { listen 80; root /usr/share/nginx/html; index index.html; location / { try_files $uri $uri.html $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]`

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
