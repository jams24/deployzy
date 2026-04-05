package deploy

import (
	"bufio"
	"context"
	"fmt"
	"math/rand"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/server/internal/db"
)

// Engine handles building and deploying projects as Docker containers.
type Engine struct {
	db     *db.DB
	Domain string
	GitHub *GitHubApp
	log    zerolog.Logger
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
	e.logMsg(ctx, project.ID, "Starting deployment...", "deploy")
	e.db.UpdateProjectStatus(ctx, project.ID, "building", "", 0)

	// Stop existing container
	containerName := fmt.Sprintf("sm-%s", project.ID[:8])
	exec.Command("docker", "rm", "-f", containerName).Run()

	// Ensure data directory exists for persistence
	exec.Command("mkdir", "-p", fmt.Sprintf("/opt/serverme/project-data/%s", project.ID[:8])).Run()

	// Clean build directory
	buildDir := fmt.Sprintf("/tmp/serverme-build/%s", project.ID)
	exec.Command("rm", "-rf", buildDir).Run()
	exec.Command("mkdir", "-p", buildDir).Run()

	// Clone repo if URL provided
	buildCtx := buildDir
	if project.RepoURL != "" {
		e.logMsg(ctx, project.ID, fmt.Sprintf("Cloning %s (branch: %s)...", maskToken(project.RepoURL), project.Branch), "build")

		cloneDir := buildDir + "/app"
		cmd := exec.CommandContext(ctx, "git", "clone", "--depth", "1", "--branch", project.Branch, project.RepoURL, cloneDir)
		output, err := cmd.CombinedOutput()
		if err != nil {
			e.logMsg(ctx, project.ID, fmt.Sprintf("Clone failed: %s", string(output)), "error")
			e.db.UpdateProjectStatus(ctx, project.ID, "failed", "", 0)
			return fmt.Errorf("git clone: %w", err)
		}
		buildCtx = cloneDir
	}

	// Determine framework — always prefer existing Dockerfile
	framework := project.Framework
	if fileExists(buildCtx + "/Dockerfile") {
		framework = "docker"
	} else if framework == "" {
		framework = e.detectFramework(buildCtx)
	}
	e.logMsg(ctx, project.ID, fmt.Sprintf("Framework: %s", framework), "build")

	// Generate Dockerfile only if repo doesn't already have one
	if !fileExists(buildCtx + "/Dockerfile") {
		dockerfile := e.generateDockerfile(project, framework)
		if dockerfile != "" {
			os.WriteFile(buildCtx+"/Dockerfile", []byte(dockerfile), 0644)
		}
	}

	// Verify Dockerfile exists
	if !fileExists(buildCtx + "/Dockerfile") {
		e.logMsg(ctx, project.ID, "No Dockerfile found in repository. Add a Dockerfile or select a framework.", "error")
		e.db.UpdateProjectStatus(ctx, project.ID, "failed", "", 0)
		return fmt.Errorf("no Dockerfile")
	}

	// Auto-detect exposed port from Dockerfile
	containerPort := detectExposedPort(buildCtx + "/Dockerfile")
	e.logMsg(ctx, project.ID, fmt.Sprintf("Detected container port: %d", containerPort), "build")

	// Build Docker image — always --no-cache to avoid stale layers
	imageName := fmt.Sprintf("sm-project-%s", project.ID[:8])
	e.logMsg(ctx, project.ID, "Building Docker image (this may take a few minutes)...", "build")

	cmd := exec.CommandContext(ctx, "docker", "build", "--no-cache", "--memory=1g", "--cpu-quota=50000", "-t", imageName, buildCtx)
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Extract the actual error from build output
		errMsg := extractBuildError(string(output))
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

	// Build env var flags
	var envFlags []string
	for k, v := range project.EnvVars {
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

	args = append(args, "--restart", "unless-stopped", "--memory", "512m", "--cpus", "0.5")

	// Add data volume for persistence
	args = append(args, "-v", fmt.Sprintf("/opt/serverme/project-data/%s:/app/data", project.ID[:8]))
	args = append(args, envFlags...)
	args = append(args, imageName)

	cmd = exec.CommandContext(ctx, "docker", args...)
	containerOutput, err := cmd.CombinedOutput()
	if err != nil {
		e.logMsg(ctx, project.ID, fmt.Sprintf("Run failed: %s", string(containerOutput)), "error")
		e.db.UpdateProjectStatus(ctx, project.ID, "failed", "", 0)
		return fmt.Errorf("docker run: %w", err)
	}

	containerID := strings.TrimSpace(string(containerOutput))
	if len(containerID) > 12 {
		containerID = containerID[:12]
	}

	// Wait and check health
	time.Sleep(5 * time.Second)
	healthy := e.checkContainerHealth(containerName)

	if healthy {
		e.db.UpdateProjectStatus(ctx, project.ID, "running", containerID, hostPort)
		e.logMsg(ctx, project.ID, fmt.Sprintf("Deployed at https://%s.%s (port: %d)", project.Subdomain, e.Domain, hostPort), "deploy")
	} else {
		// Get crash logs
		crashLogs := getContainerLogs(containerName, 10)
		e.logMsg(ctx, project.ID, fmt.Sprintf("Container unhealthy — check logs:\n%s", crashLogs), "error")
		e.db.UpdateProjectStatus(ctx, project.ID, "failed", containerID, hostPort)
	}

	e.registerRoute(project.Subdomain, hostPort)

	// Cleanup
	exec.Command("rm", "-rf", buildDir).Run()

	return nil
}

// Stop stops a project's container.
func (e *Engine) Stop(ctx context.Context, project *db.Project) error {
	containerName := fmt.Sprintf("sm-%s", project.ID[:8])
	exec.Command("docker", "stop", containerName).Run()
	exec.Command("docker", "rm", "-f", containerName).Run()
	e.db.UpdateProjectStatus(ctx, project.ID, "stopped", "", 0)
	e.logMsg(ctx, project.ID, "Project stopped", "deploy")
	return nil
}

// Delete stops and removes a project completely.
func (e *Engine) Delete(ctx context.Context, project *db.Project) error {
	e.Stop(ctx, project)
	exec.Command("docker", "rmi", fmt.Sprintf("sm-project-%s", project.ID[:8])).Run()
	return nil
}

// GetProjectPort returns the container port for a deployed project by subdomain.
func (e *Engine) GetProjectPort(subdomain string) (int, bool) {
	ctx := context.Background()
	rows, err := e.db.Pool.Query(ctx,
		`SELECT container_port FROM projects WHERE subdomain = $1 AND status = 'running' AND container_port > 0`,
		subdomain,
	)
	if err != nil {
		return 0, false
	}
	defer rows.Close()
	if rows.Next() {
		var port int
		rows.Scan(&port)
		return port, port > 0
	}
	return 0, false
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
	switch framework {
	case "nextjs":
		return `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]`

	case "node":
		startCmd := project.StartCmd
		if startCmd == "" {
			startCmd = "npm start"
		}
		return fmt.Sprintf(`FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD %s`, formatCmd(startCmd))

	case "python":
		startCmd := project.StartCmd
		if startCmd == "" {
			startCmd = "python app.py"
		}
		return fmt.Sprintf(`FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt* ./
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || true
COPY . .
EXPOSE 3000
CMD %s`, formatCmd(startCmd))

	case "static":
		return `FROM nginx:alpine
COPY . /usr/share/nginx/html
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
