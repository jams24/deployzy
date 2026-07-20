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
	"github.com/serverme/serverme/server/internal/notify"
)

// Engine handles building and deploying projects as Docker containers.
type Engine struct {
	db          *db.DB
	Domain      string
	ServiceHost string // public IP/host for raw TCP services (DB, Redis) — may differ from Domain when domain is behind Cloudflare
	GitHub      *GitHubApp
	emailSvc    notify.Mailer
	log         zerolog.Logger
	deployLocks sync.Map // per-project mutex to prevent concurrent deploys
}

// NewEngine creates a new deploy engine.
func NewEngine(database *db.DB, domain, serviceHost string, github *GitHubApp, emailSvc notify.Mailer, log zerolog.Logger) *Engine {
	if serviceHost == "" {
		serviceHost = domain
	}
	return &Engine{
		db:          database,
		Domain:      domain,
		ServiceHost: serviceHost,
		GitHub:      github,
		emailSvc:    emailSvc,
		log:         log.With().Str("component", "deploy").Logger(),
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

	// Determine if deploying locally or to a remote server.
	// This must happen BEFORE updating project status so we know whether the
	// runner is remote (BYOC) or local (platform).
	var runner *Runner
	var assignedServer *db.WorkerServer

	if project.WorkerServerID != "" {
		// Project already assigned to a server (BYOC or previously assigned)
		server, err := e.db.GetWorkerServer(ctx, project.WorkerServerID)
		if err != nil {
			e.log.Error().Err(err).Str("project", project.ID).Str("worker_server_id", project.WorkerServerID).Msg("failed to load assigned worker server — deploy may fall back to local")
		}
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

	// isRemoteBYOC is true when the project lives on a user's own server (not
	// a platform-local host). For remote projects the platform proxy cannot
	if assignedServer != nil {
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
		if project.WorkerServerID != "" {
			e.logMsg(ctx, project.ID, "Assigned server unavailable — building on the primary (local) host as a fallback.", "deploy")
		}
	}

	// Always mark "building" so the UI shows the correct state during a redeploy.
	// The proxy allows both 'building' and 'running', and we preserve the old
	// container_port, so traffic keeps flowing to the old container throughout
	// the build — both on local/platform and BYOC servers.
	e.db.UpdateProjectStatus(ctx, project.ID, "building", project.ContainerID, project.ContainerPort)

	// Blue-green: build new container while old one keeps serving traffic.
	containerName := fmt.Sprintf("sm-%s", project.ID[:8])
	newContainerName := containerName + "-next"
	oldContainerID := project.ContainerID
	oldHostPort := project.ContainerPort

	// Called on any failure path: restores old container to 'running' so the
	// service keeps serving if it was up before, or marks it failed if this
	// was a first deploy.
	restoreOldState := func() {
		if oldHostPort > 0 {
			e.db.UpdateProjectStatus(ctx, project.ID, "running", oldContainerID, oldHostPort)
		} else {
			e.db.UpdateProjectStatus(ctx, project.ID, "failed", "", 0)
		}
	}

	// Clean up any leftover "-next" container from a previous interrupted deploy
	runner.Exec(ctx, "docker", "stop", "-t", "2", newContainerName)
	runner.Exec(ctx, "docker", "rm", "-f", newContainerName)

	// Ensure data directory exists for persistence
	runner.Exec(ctx, "mkdir", "-p", fmt.Sprintf("/opt/serverme/project-data/%s", project.ID[:8]))

	// Clean build directory — defer ensures temp files are always removed,
	// even when an early failure path returns before the bottom of Deploy.
	buildDir := fmt.Sprintf("/tmp/serverme-build/%s", project.ID)
	runner.Exec(ctx, "rm", "-rf", buildDir)
	runner.Exec(ctx, "mkdir", "-p", buildDir)
	defer runner.Exec(ctx, "rm", "-rf", buildDir)

	// Deploy source flags (declared early — the clone step branches on upload).
	imageSource := project.DeploySource == "image" && project.ImageRef != ""
	uploadSource := project.DeploySource == "upload"

	// Build context: clone a repo, untar an upload, or (image) leave it empty.
	buildCtx := buildDir
	if uploadSource {
		// Local-directory upload: the API host staged a tarball; untar it as the
		// build context. Remote-worker uploads aren't wired yet (the tar lives on
		// the API host, not the worker).
		if runner.IsRemote() {
			e.logMsg(ctx, project.ID, "Upload deploys aren't supported on custom/remote servers yet — use a platform server.", "error")
			restoreOldState()
			return fmt.Errorf("upload deploy on remote worker")
		}
		tarPath := fmt.Sprintf("/tmp/serverme-uploads/%s.tar.gz", project.ID)
		if !fileExists(tarPath) {
			e.logMsg(ctx, project.ID, "No uploaded build context found — upload your directory before deploying.", "error")
			restoreOldState()
			return fmt.Errorf("no upload found")
		}
		cloneDir := buildDir + "/app"
		runner.Exec(ctx, "mkdir", "-p", cloneDir)
		e.logMsg(ctx, project.ID, "Extracting uploaded build context...", "build")
		if out, err := runner.Run(ctx, "tar", "xzf", tarPath, "-C", cloneDir); err != nil {
			e.logMsg(ctx, project.ID, fmt.Sprintf("Extract failed: %s", trimLogs(string(out), 1000)), "error")
			restoreOldState()
			return fmt.Errorf("untar upload: %w", err)
		}
		buildCtx = cloneDir
	} else if project.RepoURL != "" && !imageSource {
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
			restoreOldState()
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
				restoreOldState()
				return fmt.Errorf("invalid commit SHA")
			}
			out, err := runner.RunShell(ctx, fmt.Sprintf("cd %s && git checkout %s", cloneDir, project.CommitSHA))
			if err != nil {
				e.logMsg(ctx, project.ID, fmt.Sprintf("Checkout failed: %s", string(out)), "error")
				restoreOldState()
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

	// Bandwidth check — warn if the user is approaching or over their monthly limit.
	if project.UserID != "" {
		if accountBytes, err := e.db.GetUserMonthlyBandwidthBytes(ctx, project.UserID); err == nil {
			user, _ := e.db.GetUserByID(ctx, project.UserID)
			if user != nil {
				if limits, _ := e.db.GetPlanLimits(ctx, user.Plan); limits != nil && limits.MaxBandwidthGB > 0 && !db.Unlimited(limits.MaxBandwidthGB) {
					accountGB := float64(accountBytes) / (1024 * 1024 * 1024)
					limitGB := float64(limits.MaxBandwidthGB)
					pct := (accountGB / limitGB) * 100
					switch {
					case pct >= 100:
						e.logMsg(ctx, project.ID, fmt.Sprintf("⚠ Bandwidth limit reached: %.1f GB / %d GB used this month. Traffic may be blocked — upgrade your plan.", accountGB, limits.MaxBandwidthGB), "build")
					case pct >= 80:
						e.logMsg(ctx, project.ID, fmt.Sprintf("⚠ Bandwidth: %.1f GB / %d GB used this month (%.0f%%).", accountGB, limits.MaxBandwidthGB, pct), "build")
					}
				}
			}
		}
	}

	// repoRoot is the clone root before root_dir is applied. Multi-service builds
	// build from here so every service directory is in the Docker build context.
	repoRoot := buildCtx
	multiService := len(project.Services) > 0
	// imageSource (declared above) models a prebuilt registry image as a one-line
	// `FROM <ref>` Dockerfile so the rest of the build→run→route pipeline is reused.

	// Apply root_dir (for monorepos: build from a subdirectory of the repo).
	// For multi-service the primary app's root_dir is handled inside the
	// generated Dockerfile/entrypoint, so we keep buildCtx at the primary dir
	// only for framework detection below.
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
	// Deployzy's auto-generated one (with the configured node version, install
	// command, prisma auto-push, etc.) to take over.
	ignoreRepoDockerfile := project.BuildMode == "ignore_dockerfile"

	// effectiveDockerfile is the Dockerfile name to use. Defaults to "Dockerfile"
	// but can be overridden (e.g. "Dockerfile.bot", "Dockerfile.frontend").
	effectiveDockerfile := "Dockerfile"
	if project.DockerfilePath != "" {
		effectiveDockerfile = project.DockerfilePath
	}

	if imageSource {
		framework = "image"
	} else if runner.IsRemote() {
		// Remote: check files via SSH
		out, _ := runner.RunShell(ctx, fmt.Sprintf("ls %s/%s %s/next.config.* %s/package.json %s/requirements.txt %s/go.mod %s/index.html 2>/dev/null", buildCtx, effectiveDockerfile, buildCtx, buildCtx, buildCtx, buildCtx, buildCtx))
		files := string(out)
		if !ignoreRepoDockerfile && strings.Contains(files, effectiveDockerfile) {
			framework = "docker"
		} else if strings.Contains(files, "next.config") {
			framework = "nextjs"
		} else if strings.Contains(files, "package.json") {
			// next.config.* is optional in Next.js 14+ — also check package.json deps
			pkgOut, _ := runner.RunShell(ctx, fmt.Sprintf(`grep -l '"next"' %s/package.json 2>/dev/null || true`, buildCtx))
			if strings.Contains(string(pkgOut), "package.json") {
				framework = "nextjs"
			} else {
				framework = "node"
			}
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
		} else if effectiveDockerfile != "Dockerfile" && fileExists(buildCtx+"/"+effectiveDockerfile) {
			// Custom dockerfile_path set and file exists — treat as docker regardless of other files
			framework = "docker"
		} else {
			framework = e.detectFramework(buildCtx)
		}
	}
	if !imageSource && framework == "node" && project.Framework != "" && project.Framework != "node" {
		framework = project.Framework
	}
	e.logMsg(ctx, project.ID, fmt.Sprintf("Framework: %s", framework), "build")
	if ignoreRepoDockerfile {
		e.logMsg(ctx, project.ID, "Ignoring repo Dockerfile (build_mode=ignore_dockerfile)", "build")
	}

	// Determine container port: user override > Dockerfile EXPOSE > default 3000.
	// Set early because the multi-service path needs the primary port to build
	// the generated Dockerfile + entrypoint.
	containerPort := 3000

	if imageSource {
		// Prebuilt image: pull it, then model it as a one-line `FROM <ref>`
		// Dockerfile so build→run→route below is unchanged. We bake the image's
		// own EXPOSE into the Dockerfile so port detection picks it up.
		e.logMsg(ctx, project.ID, fmt.Sprintf("Deploying prebuilt image: %s", project.ImageRef), "build")
		if out, err := runner.Run(ctx, "docker", "pull", project.ImageRef); err != nil {
			e.logMsg(ctx, project.ID, fmt.Sprintf("Image pull failed: %s", trimLogs(string(out), 1000)), "error")
			restoreOldState()
			return fmt.Errorf("docker pull: %w", err)
		}
		df := "FROM " + project.ImageRef + "\n"
		if port := e.imageExposedPort(ctx, runner, project.ImageRef); port > 0 {
			df += fmt.Sprintf("EXPOSE %d\n", port)
			containerPort = port
		}
		e.writeBuildFile(ctx, runner, buildCtx, "Dockerfile", df)
		effectiveDockerfile = "Dockerfile"
	} else if multiService {
		// Multi-service: always use our generated Dockerfile, built from the repo
		// root so every service directory is reachable. The primary app keeps the
		// project's port + root subdomain; each service runs alongside it.
		if project.PortOverride > 0 {
			containerPort = project.PortOverride
		}
		buildCtx = repoRoot
		dockerfile, entrypoint := e.generateMultiServiceDockerfile(project, framework, containerPort)
		e.writeBuildFile(ctx, runner, repoRoot, "serverme-entrypoint.sh", entrypoint)
		e.writeBuildFile(ctx, runner, repoRoot, "Dockerfile", dockerfile)
		effectiveDockerfile = "Dockerfile"
		e.logMsg(ctx, project.ID, fmt.Sprintf("Multi-service build: primary on port %d + %d service(s)", containerPort, len(project.Services)), "build")
	} else {
		// Generate Dockerfile if repo doesn't have one, OR if user asked us to ignore theirs.
		if runner.IsRemote() {
			out, _ := runner.RunShell(ctx, fmt.Sprintf("test -f %s/%s && echo yes || echo no", buildCtx, effectiveDockerfile))
			exists := strings.TrimSpace(string(out)) == "yes"
			if !exists || ignoreRepoDockerfile {
				dockerfile := e.generateDockerfile(project, framework)
				if dockerfile != "" {
					runner.RunShell(ctx, fmt.Sprintf("cat > %s/Dockerfile << 'SMEOF'\n%s\nSMEOF", buildCtx, dockerfile))
					effectiveDockerfile = "Dockerfile"
				}
			}
		} else {
			if !fileExists(buildCtx+"/"+effectiveDockerfile) || ignoreRepoDockerfile {
				dockerfile := e.generateDockerfile(project, framework)
				if dockerfile != "" {
					os.WriteFile(buildCtx+"/Dockerfile", []byte(dockerfile), 0644)
					effectiveDockerfile = "Dockerfile"
				}
			}
		}

		// Verify Dockerfile exists
		if runner.IsRemote() {
			out, _ := runner.RunShell(ctx, fmt.Sprintf("test -f %s/%s && echo yes || echo no", buildCtx, effectiveDockerfile))
			if strings.TrimSpace(string(out)) != "yes" {
				e.logMsg(ctx, project.ID, fmt.Sprintf("No %s found in repository.", effectiveDockerfile), "error")
				restoreOldState()
				return fmt.Errorf("no Dockerfile")
			}
		} else if !fileExists(buildCtx + "/" + effectiveDockerfile) {
			e.logMsg(ctx, project.ID, fmt.Sprintf("No %s found in repository.", effectiveDockerfile), "error")
			restoreOldState()
			return fmt.Errorf("no Dockerfile")
		}

		if runner.IsRemote() {
			out, _ := runner.RunShell(ctx, fmt.Sprintf("grep -i '^EXPOSE' %s/%s | head -1 | grep -oE '[0-9]+'", buildCtx, effectiveDockerfile))
			if p := strings.TrimSpace(string(out)); p != "" {
				if pp, err := strconv.Atoi(p); err == nil {
					containerPort = pp
				}
			}
		} else {
			containerPort = detectExposedPort(buildCtx + "/" + effectiveDockerfile)
		}
	}
	if project.PortOverride > 0 {
		containerPort = project.PortOverride
		e.logMsg(ctx, project.ID, fmt.Sprintf("Using custom port: %d", containerPort), "build")
	} else if !multiService {
		e.logMsg(ctx, project.ID, fmt.Sprintf("%s container port: %d", map[bool]string{true: "Image", false: "Detected"}[imageSource], containerPort), "build")
	}

	// Build Docker image with a 20-minute cap so a hung build can't wedge the project in "building" forever.
	imageName := fmt.Sprintf("sm-project-%s", project.ID[:8])
	e.logMsg(ctx, project.ID, "Building Docker image (this may take a few minutes)...", "build")

	// Capacity gate + adaptive cap: right-size the build to the build HOST's free
	// RAM so it can't OOM the host. `docker --memory` bounds the container, not
	// the host — an unbounded build on a full box OOM-kills co-located services
	// (this took the platform down). Cap the build to available-512MB and only
	// refuse when the host genuinely can't spare that, so a small BYOC box still
	// builds (just with a smaller cap). The log names the host so it's clear
	// whether the build ran on the primary or the BYOC server.
	buildHost := "the primary server"
	if runner.IsRemote() {
		buildHost = "BYOC server " + runner.Host()
	}
	buildMemMB := 2048
	if availMB := availableMemoryMB(ctx, runner); availMB > 0 {
		if availMB-512 < buildMemMB { // leave a 512 MB host reserve
			buildMemMB = availMB - 512
		}
		if buildMemMB < 512 {
			e.logMsg(ctx, project.ID, fmt.Sprintf("Build paused — %s has only %d MB free (need ~1024 MB). Free up memory or use a bigger server, then redeploy.", buildHost, availMB), "error")
			restoreOldState()
			return fmt.Errorf("insufficient memory to build on %s: %d MB free", buildHost, availMB)
		}
		e.logMsg(ctx, project.ID, fmt.Sprintf("Building on %s — %d MB free, build capped at %d MB", buildHost, availMB, buildMemMB), "build")
	}

	buildCtx2, cancelBuild := context.WithTimeout(ctx, 20*time.Minute)
	// DOCKER_BUILDKIT=0 forces the legacy builder, which is required for
	// --memory to actually be honoured. BuildKit (default since Docker 23)
	// silently ignores --memory, letting an unbounded build exhaust the host
	// and trigger the OOM killer against co-located containers (e.g. the
	// previously-running version of this very project).
	buildShellCmd := fmt.Sprintf(
		"DOCKER_BUILDKIT=0 docker build --no-cache --memory=%dm -f %s -t %s %s",
		buildMemMB,
		shellQuote(buildCtx+"/"+effectiveDockerfile),
		shellQuote(imageName),
		shellQuote(buildCtx),
	)
	output, err := runner.RunShell(buildCtx2, buildShellCmd)
	cancelBuild()
	if err != nil {
		errMsg := extractBuildError(string(output))
		if buildCtx2.Err() == context.DeadlineExceeded {
			errMsg = "build timed out after 20 minutes"
		}
		e.logMsg(ctx, project.ID, fmt.Sprintf("Build failed: %s", errMsg), "error")
		restoreOldState()
		return fmt.Errorf("docker build: %w", err)
	}
	e.logMsg(ctx, project.ID, "Build successful", "build")

	// Find an available host port on the build target (local or remote BYOC).
	portFree := func(p int) bool { return !isPortInUseOn(ctx, runner, p) }
	hostPort := 10100 + rand.Intn(900)
	for i := 0; i < 50; i++ {
		if portFree(hostPort) {
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
	allPorts := detectAllExposedPorts(buildCtx + "/" + effectiveDockerfile)

	// Run new container under a temp name — old container keeps serving until health check passes
	e.logMsg(ctx, project.ID, "Starting container...", "deploy")
	args := []string{"run", "-d", "--name", newContainerName}

	// Map primary port
	args = append(args, "-p", fmt.Sprintf("%d:%d", hostPort, containerPort))

	// usedHostPorts tracks ports we've already chosen in THIS deploy so two
	// services can't collide on the same host port (isPortInUse can't see a port
	// we picked microseconds ago but haven't bound yet).
	usedHostPorts := map[int]bool{hostPort: true}
	pickHostPort := func() int {
		p := 10100 + rand.Intn(900)
		for !portFree(p) || usedHostPorts[p] {
			p = 10100 + rand.Intn(900)
		}
		usedHostPorts[p] = true
		return p
	}

	// serviceRoutes maps each non-primary service to the host port it was
	// published on, so it can be persisted for sibling-subdomain routing.
	var serviceRoutes []db.ServiceRoute
	if multiService {
		for _, svc := range project.Services {
			sh := pickHostPort()
			args = append(args, "-p", fmt.Sprintf("%d:%d", sh, svc.Port))
			serviceRoutes = append(serviceRoutes, db.ServiceRoute{
				Subdomain:   project.Subdomain + "-" + svc.Name,
				ServiceName: svc.Name,
				HostPort:    sh,
			})
		}
	} else {
		// Map additional ports
		for _, p := range allPorts {
			if p != containerPort {
				extraHost := pickHostPort()
				args = append(args, "-p", fmt.Sprintf("%d:%d", extraHost, p))
			}
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
	// on-failure:5 instead of unless-stopped: an app that fails 5 consecutive
	// starts will never succeed on the 5,000th. Infinite restart loops from
	// broken deploys once drove a 1-core host to load 24 and starved every
	// build on the box (2026-07-20). The crash sweeper marks these projects
	// 'crashed' so the dashboard shows what happened.
	args = append(args, "--restart", "on-failure:5",
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
			restoreOldState()
			return fmt.Errorf("release cmd: %w", relErr)
		}
		if out := strings.TrimSpace(string(relOut)); out != "" {
			e.logMsg(ctx, project.ID, fmt.Sprintf("Release output:\n%s", trimLogs(out, 1000)), "build")
		}
		e.logMsg(ctx, project.ID, "Release command succeeded", "deploy")
	}

	args = append(args, imageName)

	// Always start the new container before touching the old one (true blue-green).
	// The old container keeps serving traffic until the new one is confirmed healthy.
	// This guarantees zero downtime even for stateful services: if the new container
	// fails to launch or crashes immediately, the old one is never stopped.
	containerOutput, err := runner.Run(ctx, "docker", args...)
	if err != nil {
		e.logMsg(ctx, project.ID, fmt.Sprintf("Run failed: %s", string(containerOutput)), "error")
		runner.Exec(ctx, "docker", "stop", "-t", "2", newContainerName)
		runner.Exec(ctx, "docker", "rm", "-f", newContainerName)
		restoreOldState()
		return fmt.Errorf("docker run: %w", err)
	}

	containerID := strings.TrimSpace(string(containerOutput))
	if len(containerID) > 12 {
		containerID = containerID[:12]
	}

	// Health check: probe new container while old one keeps serving.
	healthy := e.waitForHealthy(ctx, project, runner, newContainerName, hostPort)

	if healthy {
		// Atomic route swap: proxy reads container_port on every request; this
		// single UPDATE makes it immediately start routing to the new container.
		e.db.UpdateProjectStatus(ctx, project.ID, "running", containerID, hostPort)
		e.logMsg(ctx, project.ID, fmt.Sprintf("Deployed at https://%s.%s (port: %d)", project.Subdomain, e.Domain, hostPort), "deploy")

		// Publish sibling-subdomain routes for any extra services. Replace the
		// whole set (ports are freshly allocated each deploy). On a single-service
		// project this clears stale routes from a previous multi-service config.
		if err := e.db.ReplaceServiceRoutes(ctx, project.ID, serviceRoutes); err != nil {
			e.log.Error().Err(err).Str("project", project.ID).Msg("failed to publish service routes")
		}
		for _, rt := range serviceRoutes {
			e.logMsg(ctx, project.ID, fmt.Sprintf("Service '%s' at https://%s.%s", rt.ServiceName, rt.Subdomain, e.Domain), "deploy")
		}

		// Old container is still running — stop it now that the new one is confirmed healthy.
		// -t 2 reduces the SIGTERM window from 10s → 2s, preventing duplicate Telegram/WebSocket
		// polling during the blue-green cutover (two containers alive at once → 409 Conflict).
		runner.Exec(ctx, "docker", "stop", "-t", "2", containerName)
		runner.Exec(ctx, "docker", "rm", "-f", containerName)

		// Rename temp → canonical name so `docker ps` shows the right name.
		runner.Exec(ctx, "docker", "rename", newContainerName, containerName)

		// Dangling images (old build layers) are freed here. Each successful
		// deploy leaves the previous image untagged; prune reclaims that space.
		runner.Exec(ctx, "docker", "image", "prune", "-f")

		go e.fireWebhooks(project, "deploy.succeeded", "running")
	} else {
		crashOut, _ := runner.Run(ctx, "docker", "logs", "--tail", "20", newContainerName)
		crashLogs := string(crashOut)
		e.logMsg(ctx, project.ID, fmt.Sprintf("New container unhealthy — old version still serving:\n%s", trimLogs(crashLogs, 2000)), "error")

		// Clean up the failed new container. Old container was never stopped, so it
		// keeps serving traffic automatically — no restart needed.
		runner.Exec(ctx, "docker", "stop", "-t", "2", newContainerName)
		runner.Exec(ctx, "docker", "rm", "-f", newContainerName)
		restoreOldState()

		go e.fireWebhooks(project, "deploy.failed", "failed")
		go e.sendDeployFailedEmail(project, crashLogs)
	}
	// Recompute the server's resource allocation from the actual set of
	// running projects. Works for both platform + BYOC servers.
	if assignedServer != nil {
		e.db.ReconcileServerAllocation(ctx, assignedServer.ID)
	}

	e.registerRoute(project.Subdomain, hostPort)

	return nil
}

// Stop stops a project's container.
func (e *Engine) Stop(ctx context.Context, project *db.Project) error {
	runner := e.getRunner(ctx, project)
	containerName := fmt.Sprintf("sm-%s", project.ID[:8])
	runner.Exec(ctx, "docker", "stop", "-t", "2", containerName)
	runner.Exec(ctx, "docker", "rm", "-f", containerName)
	// Belt-and-braces: also clear the container from the primary/local host. A
	// project's container can physically live somewhere other than its currently
	// assigned server (e.g. it was deployed to the primary before being reassigned
	// to a BYOC box, or during a move). Stopping a non-existent container is a
	// harmless no-op, so this guarantees no orphan keeps running after a delete/move.
	if runner.IsRemote() {
		local := NewLocalRunner()
		local.Exec(ctx, "docker", "stop", "-t", "2", containerName)
		local.Exec(ctx, "docker", "rm", "-f", containerName)
	}
	e.db.UpdateProjectStatus(ctx, project.ID, "stopped", "", 0)
	// Drop sibling-subdomain routes — the container (and all its services) is gone.
	e.db.DeleteServiceRoutes(ctx, project.ID)
	e.logMsg(ctx, project.ID, "Project stopped", "deploy")
	return nil
}

// Delete stops and removes a project completely.
func (e *Engine) Delete(ctx context.Context, project *db.Project) error {
	e.Stop(ctx, project)
	runner := e.getRunner(ctx, project)
	// Force-remove the named image; ignore error (image may not exist)
	runner.Exec(ctx, "docker", "rmi", "-f", fmt.Sprintf("sm-project-%s", project.ID[:8]))
	// Prune dangling images left by failed builds
	runner.RunShell(ctx, "docker image prune -f")
	// Remove any leftover exited containers from failed builds
	runner.RunShell(ctx, "docker container prune -f")
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

// SweepCrashedContainers finds projects marked 'running' whose containers
// have given up (exited after exhausting their on-failure restart budget, or
// dead) and flips their status to 'crashed' so the dashboard tells the truth
// and the owner can see logs + redeploy. Called periodically from main.
func (e *Engine) SweepCrashedContainers(ctx context.Context) {
	projects, err := e.db.ListRunningProjects(ctx)
	if err != nil {
		e.log.Warn().Err(err).Msg("crash sweep: list running projects failed")
		return
	}
	for i := range projects {
		p := &projects[i]
		containerName := fmt.Sprintf("sm-%s", p.ID[:8])
		runner := e.getRunner(ctx, p)
		out, err := runner.RunShell(ctx,
			fmt.Sprintf("docker inspect --format '{{.State.Status}}' %s 2>/dev/null || echo missing", containerName))
		if err != nil {
			continue // host unreachable — worker health monitor handles that
		}
		state := strings.TrimSpace(string(out))
		if state == "exited" || state == "dead" {
			logs := ""
			if lout, lerr := runner.RunShell(ctx, "docker logs --tail 5 "+containerName+" 2>&1"); lerr == nil {
				logs = strings.TrimSpace(string(lout))
			}
			e.db.UpdateProjectStatus(ctx, p.ID, "crashed", p.ContainerID, p.ContainerPort)
			e.logMsg(ctx, p.ID, "Container crashed and exhausted its restart budget (5 failed starts). Marked as crashed — check logs and redeploy after fixing. Last output:\n"+logs, "deploy")
			e.log.Warn().Str("project", p.Name).Str("container", containerName).Msg("crash sweep: marked project crashed")
		}
	}
}

// LogStreamCmd returns an *exec.Cmd (not yet started) that streams live
// docker logs for project from wherever its container actually lives —
// locally for platform projects, over SSH for BYOC.
func (e *Engine) LogStreamCmd(ctx context.Context, project *db.Project) *exec.Cmd {
	containerName := fmt.Sprintf("sm-%s", project.ID[:8])
	return e.getRunner(ctx, project).StreamLogsCmd(ctx, containerName)
}

// GetProjectPort returns the container port for a deployed project by subdomain.
func (e *Engine) GetProjectPort(subdomain string) (int, bool) {
	_, port, _, ok := e.GetProjectRouting(subdomain)
	return port, ok
}

// GetProjectRouting returns (serverHost, port, projectID, ok).
// serverHost is "" for platform-local projects; for BYOC projects it's the
// remote VPS IP so the proxy can forward directly instead of trying localhost.
func (e *Engine) GetProjectRouting(subdomain string) (string, int, string, bool) {
	ctx := context.Background()
	rows, err := e.db.Pool.Query(ctx,
		`SELECT p.container_port, p.id,
		        CASE WHEN ws.is_local OR ws.host IN ('localhost', '127.0.0.1', '') THEN ''
		             ELSE COALESCE(ws.host, '') END AS server_host
		 FROM projects p
		 LEFT JOIN worker_servers ws ON ws.id = p.worker_server_id
		 WHERE p.subdomain = $1 AND p.status IN ('running', 'building') AND p.container_port > 0`,
		subdomain,
	)
	if err != nil {
		return "", 0, "", false
	}
	defer rows.Close()
	if rows.Next() {
		var port int
		var id, serverHost string
		rows.Scan(&port, &id, &serverHost)
		return serverHost, port, id, port > 0
	}
	rows.Close()

	// Fall back to multi-service sibling subdomains (<projectsub>-<svc>). These
	// live in service_routes and point at the host port the service was last
	// published on; only resolvable while the parent project is up.
	srRows, err := e.db.Pool.Query(ctx,
		`SELECT sr.host_port, sr.project_id,
		        CASE WHEN ws.is_local OR ws.host IN ('localhost', '127.0.0.1', '') THEN ''
		             ELSE COALESCE(ws.host, '') END AS server_host
		   FROM service_routes sr
		   JOIN projects p ON p.id = sr.project_id
		   LEFT JOIN worker_servers ws ON ws.id = p.worker_server_id
		  WHERE sr.subdomain = $1
		    AND p.status IN ('running', 'building')
		    AND sr.host_port > 0`,
		subdomain,
	)
	if err != nil {
		return "", 0, "", false
	}
	defer srRows.Close()
	if srRows.Next() {
		var port int
		var id, serverHost string
		srRows.Scan(&port, &id, &serverHost)
		return serverHost, port, id, port > 0
	}
	return "", 0, "", false
}

func (e *Engine) registerRoute(subdomain string, port int) {
	e.log.Info().Str("subdomain", subdomain).Int("port", port).Msg("route registered")
}

func (e *Engine) logMsg(ctx context.Context, projectID, message, level string) {
	e.db.AddDeployLog(ctx, projectID, message, level)
	e.log.Info().Str("project", projectID).Str("level", level).Msg(message)
}

// fireWebhooks delivers a deploy event to all of the project owner's enabled
// webhooks. Best-effort; call in a goroutine so delivery never blocks a deploy.
func (e *Engine) fireWebhooks(project *db.Project, event, status string) {
	ctx := context.Background()
	hooks, err := e.db.GetEnabledWebhooks(ctx, project.UserID)
	if err != nil || len(hooks) == 0 {
		return
	}
	payload := map[string]interface{}{
		"event":     event,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"project": map[string]interface{}{
			"id":        project.ID,
			"name":      project.Name,
			"subdomain": project.Subdomain,
			"url":       fmt.Sprintf("https://%s.%s", project.Subdomain, e.Domain),
			"status":    status,
		},
	}
	for _, wh := range hooks {
		code := notify.DeliverWebhook(wh.URL, wh.Secret, payload)
		e.db.RecordWebhookDelivery(ctx, wh.ID, code)
	}
}

// sendDeployFailedEmail emails the project owner when a new container fails to
// pass the health check. Best-effort; must be called in a goroutine.
func (e *Engine) sendDeployFailedEmail(project *db.Project, crashLogs string) {
	if e.emailSvc == nil {
		return
	}
	ctx := context.Background()
	user, err := e.db.GetUserByID(ctx, project.UserID)
	if err != nil || user == nil {
		e.log.Warn().Str("project", project.ID).Msg("deploy-failed email: could not load user")
		return
	}
	projectURL := fmt.Sprintf("https://deployzy.com/dashboard/projects/%s", project.ID)
	logsURL := fmt.Sprintf("https://deployzy.com/dashboard/projects/%s/logs", project.ID)
	body := notify.DeployFailedEmail(project.Name, projectURL, logsURL, crashLogs)
	subject := fmt.Sprintf("Deploy failed — %s", project.Name)
	if err := e.emailSvc.SendOne(user.Email, subject, body); err != nil {
		e.log.Warn().Err(err).Str("to", user.Email).Str("project", project.ID).Msg("deploy-failed email send failed")
	}
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
		// next.config.* is optional in Next.js 14+ — check package.json deps too
		if data, err := os.ReadFile(dir + "/package.json"); err == nil {
			if strings.Contains(string(data), `"next"`) {
				return "nextjs"
			}
		}
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

// availableMemoryMB returns MemAvailable (MB) on the host that will run the
// build — the primary for local deploys, or the assigned BYOC server via SSH.
// Returns 0 when it can't be probed (callers then fail open, not closed).
func availableMemoryMB(ctx context.Context, runner *Runner) int {
	out, err := runner.RunShell(ctx, `awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo`)
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(string(out)))
	return n
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
	url := fmt.Sprintf("http://%s:%d%s", runner.Host(), hostPort, project.HealthCheckPath)

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

// isPortInUse checks if a port is already in use on the local host.
func isPortInUse(port int) bool {
	output, _ := exec.Command("ss", "-tlnp", fmt.Sprintf("sport = :%d", port)).Output()
	return strings.Contains(string(output), strconv.Itoa(port))
}

// isPortInUseOn checks if a port is in use on whichever host the runner targets
// (local platform or remote BYOC server). This prevents assigning a port that's
// already taken on the BYOC host — isPortInUse alone can't see remote ports.
func isPortInUseOn(ctx context.Context, runner *Runner, port int) bool {
	portStr := strconv.Itoa(port)
	out, err := runner.RunShell(ctx, "ss -tlnp sport = :"+portStr+" 2>/dev/null")
	if err != nil {
		// Fall back to local check when the remote probe fails.
		return isPortInUse(port)
	}
	return strings.Contains(string(out), portStr)
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
ENV NEXT_STATIC_GENERATION_TIMEOUT=120
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

// ── Multi-service builds ──
//
// When a project defines extra services, we ignore any repo Dockerfile and
// generate one image that builds the primary app plus every service, then run
// them all as background processes inside a single container via a generated
// entrypoint. The primary keeps the project's port + root subdomain; services
// each bind their own port and get a flat sibling subdomain.

// msProc is one process in a multi-service container.
type msProc struct {
	name      string
	dir       string // relative to repo root; "" means root
	port      int
	install   string
	build     string
	start     string
	framework string
	env       map[string]string
}

var safeDirRe = regexp.MustCompile(`^[A-Za-z0-9_./-]+$`)
var envKeyRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// safeDir normalises a service/primary directory for shell interpolation.
// Returns "." (repo root) for empty or anything containing unexpected chars —
// defensive even though the API layer already validates service directories.
func safeDir(dir string) string {
	dir = strings.Trim(strings.TrimSpace(dir), "/")
	dir = strings.TrimPrefix(dir, "./")
	if dir == "" || strings.Contains(dir, "..") || !safeDirRe.MatchString(dir) {
		return "."
	}
	return dir
}

// shellSingleQuote wraps a value in single quotes for safe shell embedding,
// escaping any embedded single quotes.
func shellSingleQuote(v string) string {
	return "'" + strings.ReplaceAll(v, "'", `'\''`) + "'"
}

func msInstall(p msProc) string {
	if p.install != "" {
		return p.install
	}
	switch p.framework {
	case "nextjs":
		return "npm ci || npm install"
	case "node":
		return "npm ci --ignore-scripts || npm install --ignore-scripts"
	case "python":
		return "pip install --no-cache-dir -r requirements.txt 2>/dev/null || pip install --no-cache-dir . 2>/dev/null || true"
	default:
		return "npm install"
	}
}

func msBuild(p msProc) string {
	if p.build != "" {
		return p.build
	}
	if p.framework == "nextjs" {
		return "npm run build"
	}
	return "" // node/python/static: build step optional
}

func msStart(p msProc) string {
	if p.start != "" {
		return p.start
	}
	if p.framework == "python" {
		return "python app.py"
	}
	return "npm start"
}

// multiServiceProcs returns the primary app followed by each configured service.
func (e *Engine) multiServiceProcs(project *db.Project, primaryFramework string, primaryPort int) []msProc {
	procs := []msProc{{
		name:      "app",
		dir:       project.RootDir,
		port:      primaryPort,
		install:   project.InstallCmd,
		build:     project.BuildCmd,
		start:     project.StartCmd,
		framework: primaryFramework,
	}}
	for _, svc := range project.Services {
		procs = append(procs, msProc{
			name:      svc.Name,
			dir:       svc.RootDir,
			port:      svc.Port,
			install:   svc.InstallCmd,
			build:     svc.BuildCmd,
			start:     svc.StartCmd,
			framework: svc.Framework,
			env:       svc.EnvOverrides,
		})
	}
	return procs
}

// generateMultiServiceDockerfile returns the Dockerfile + entrypoint script for
// a multi-service build. The Dockerfile installs/builds each service's directory
// from the repo root; the entrypoint launches them all.
func (e *Engine) generateMultiServiceDockerfile(project *db.Project, primaryFramework string, primaryPort int) (string, string) {
	nodeVer := "20"
	if project.NodeVersion != "" {
		nodeVer = project.NodeVersion
	}
	procs := e.multiServiceProcs(project, primaryFramework, primaryPort)

	var b strings.Builder
	fmt.Fprintf(&b, "FROM node:%s-alpine\n", nodeVer)
	b.WriteString("WORKDIR /app\n")
	// Build toolchain + python runtime so node AND python services build/run.
	b.WriteString("RUN apk add --no-cache python3 py3-pip make g++ 2>/dev/null || true\n")
	b.WriteString("COPY . .\n")
	b.WriteString("ENV NODE_OPTIONS=\"--max-old-space-size=1536\"\n")

	for _, p := range procs {
		dir := safeDir(p.dir)
		fmt.Fprintf(&b, "RUN cd /app/%s && %s\n", dir, msInstall(p))
		if build := msBuild(p); build != "" {
			fmt.Fprintf(&b, "RUN cd /app/%s && %s\n", dir, build)
		}
	}
	for _, p := range procs {
		fmt.Fprintf(&b, "EXPOSE %d\n", p.port)
	}
	// The entrypoint script is part of the build context (written next to the
	// Dockerfile), so COPY . . already placed it at /app/serverme-entrypoint.sh.
	b.WriteString(`CMD ["sh", "/app/serverme-entrypoint.sh"]` + "\n")

	return b.String(), e.generateServiceEntrypoint(procs)
}

// generateServiceEntrypoint builds the launcher script: each process runs in a
// background subshell with its own PORT + env overrides; the container exits
// (and Docker restarts it) the moment any process dies.
func (e *Engine) generateServiceEntrypoint(procs []msProc) string {
	var b strings.Builder
	b.WriteString("#!/bin/sh\n")
	b.WriteString("# Generated by Deployzy — runs each service of a multi-service project.\n")
	b.WriteString("# Exits non-zero if any process dies so Docker restarts the container.\n")
	var pidVars []string
	for i, p := range procs {
		dir := safeDir(p.dir)
		pidVar := fmt.Sprintf("PID%d", i)
		pidVars = append(pidVars, pidVar)

		var env strings.Builder
		fmt.Fprintf(&env, "export PORT=%d", p.port)
		// Stable iteration isn't required for correctness, but keeps output tidy.
		for k, v := range p.env {
			if !envKeyRe.MatchString(k) {
				continue
			}
			fmt.Fprintf(&env, " && export %s=%s", k, shellSingleQuote(v))
		}

		fmt.Fprintf(&b, "echo '[serverme] starting %s on port %d'\n", p.name, p.port)
		fmt.Fprintf(&b, "( cd /app/%s && %s && exec %s ) &\n", dir, env.String(), msStart(p))
		fmt.Fprintf(&b, "%s=$!\n", pidVar)
	}
	b.WriteString("while true; do\n")
	for i, pidVar := range pidVars {
		fmt.Fprintf(&b, "  kill -0 $%s 2>/dev/null || { echo '[serverme] process %s exited — stopping container'; exit 1; }\n", pidVar, procs[i].name)
	}
	b.WriteString("  sleep 5\n")
	b.WriteString("done\n")
	return b.String()
}

// imageExposedPort returns the first EXPOSEd port of a pulled image (0 if none),
// via `docker inspect`. Used so an image-source deploy routes to the right port
// without the user having to set one manually.
func (e *Engine) imageExposedPort(ctx context.Context, runner *Runner, ref string) int {
	out, err := runner.Run(ctx, "docker", "inspect", "--format",
		`{{range $p, $_ := .Config.ExposedPorts}}{{$p}} {{end}}`, ref)
	if err != nil {
		return 0
	}
	// Output looks like "80/tcp " or "3000/tcp 9229/tcp ". Take the first number.
	for _, field := range strings.Fields(string(out)) {
		numPart := field
		if i := strings.IndexByte(numPart, '/'); i >= 0 {
			numPart = numPart[:i]
		}
		if p, err := strconv.Atoi(numPart); err == nil && p > 0 {
			return p
		}
	}
	return 0
}

// writeBuildFile writes a file into the build context, working for both local
// (filesystem) and remote (SSH heredoc) runners. The quoted heredoc delimiter
// prevents the remote shell from expanding $VARs in the content.
func (e *Engine) writeBuildFile(ctx context.Context, runner *Runner, dir, name, content string) {
	if runner.IsRemote() {
		runner.RunShell(ctx, fmt.Sprintf("cat > %s/%s << 'SMEOF'\n%s\nSMEOF", dir, name, content))
	} else {
		os.WriteFile(dir+"/"+name, []byte(content), 0644)
	}
}
