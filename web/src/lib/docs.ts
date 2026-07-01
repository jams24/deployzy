export interface DocPage {
  slug: string;
  title: string;
  description: string;
  category: string;
  icon?: string;
  content: string;
}

export interface DocCategory {
  name: string;
  icon: string;
  pages: { slug: string; title: string }[];
}

export const categories: DocCategory[] = [
  {
    name: "Getting Started",
    icon: "rocket",
    pages: [
      { slug: "introduction", title: "Introduction" },
      { slug: "quickstart", title: "Quickstart" },
      { slug: "installation", title: "Installation" },
      { slug: "authentication", title: "Authentication" },
    ],
  },
  {
    name: "CLI",
    icon: "terminal",
    pages: [
      { slug: "cli/http", title: "deployzy http" },
      { slug: "cli/tcp", title: "deployzy tcp" },
      { slug: "cli/tls", title: "deployzy tls" },
      { slug: "cli/start", title: "deployzy start" },
      { slug: "cli/deploy", title: "deployzy deploy" },
      { slug: "cli/login", title: "deployzy login" },
      { slug: "cli/config", title: "Configuration" },
    ],
  },
  {
    name: "API Reference",
    icon: "code",
    pages: [
      { slug: "api/overview", title: "Overview" },
      { slug: "api/auth", title: "Auth Endpoints" },
      { slug: "api/tunnels", title: "Tunnels" },
      { slug: "api/domains", title: "Domains" },
      { slug: "api/keys", title: "API Keys" },
      { slug: "api/projects", title: "Projects & Deploys" },
      { slug: "api/inspection", title: "Inspection" },
    ],
  },
  {
    name: "SDKs",
    icon: "package",
    pages: [
      { slug: "sdks/javascript", title: "JavaScript / TypeScript" },
      { slug: "sdks/python", title: "Python" },
    ],
  },
  {
    name: "Guides",
    icon: "book",
    pages: [
      { slug: "guides/custom-domains", title: "Custom Domains" },
      { slug: "guides/webhooks", title: "Webhook Testing" },
      { slug: "guides/deploy-from-ci", title: "Deploy from CI" },
      { slug: "guides/self-hosting", title: "Self-Hosting" },
    ],
  },
];

// Flatten for navigation
export const allPages = categories.flatMap((cat) =>
  cat.pages.map((p) => ({ ...p, category: cat.name }))
);

export function getDoc(slug: string): DocPage | null {
  return docs[slug] || null;
}

export function getAdjacentPages(slug: string) {
  const idx = allPages.findIndex((p) => p.slug === slug);
  return {
    prev: idx > 0 ? allPages[idx - 1] : null,
    next: idx < allPages.length - 1 ? allPages[idx + 1] : null,
  };
}

// ─────────────────────────────────────────────────────────
// Page content
// ─────────────────────────────────────────────────────────

const docs: Record<string, DocPage> = {
  introduction: {
    slug: "introduction",
    title: "Introduction",
    description: "Deployzy is an open-source tunneling platform that exposes your local servers to the internet.",
    category: "Getting Started",
    content: `Deployzy creates secure, encrypted tunnels from the public internet to your local machine. Think of it as an open-source alternative to ngrok — fully self-hostable with a generous free tier.

## What can you do with Deployzy?

- **Share local work** — Show a client your local site without deploying
- **Test webhooks** — Receive Stripe, GitHub, or Slack webhooks on localhost
- **Expose APIs** — Let teammates or CI hit your local API server
- **Debug mobile apps** — Point your phone at a public URL that tunnels to your machine
- **Demo anything** — Share a link to your localhost, instantly

## How it works

\`\`\`
Internet → Deployzy Server → Encrypted Tunnel (smux/TLS) → CLI → Your Local Service
\`\`\`

1. You run \`deployzy http 3000\` on your machine
2. The CLI establishes an encrypted connection to the Deployzy server
3. The server assigns a public URL like \`https://abc123.deployzy.com\`
4. Anyone visiting that URL gets routed through the tunnel to your local port 3000

## Tunnel types

| Type | Command | Use case |
|------|---------|----------|
| **HTTP** | \`deployzy http 3000\` | Web apps, APIs, webhooks |
| **TCP** | \`deployzy tcp 5432\` | Databases, game servers, SSH |
| **TLS** | \`deployzy tls 443\` | TLS passthrough (no termination) |

## Key features

- **Request inspection** — View every HTTP request in real-time at \`localhost:4040\`
- **Replay** — Re-send any captured request with one click
- **Custom domains** — Bring your own domain with automatic TLS
- **Google OAuth** — Log in with your Google account
- **SDKs** — JavaScript/TypeScript and Python
- **Self-hostable** — Deploy your own server with one command
- **Open source** — MIT licensed, all code on [GitHub](https://github.com/jams24/deployzy)`,
  },

  quickstart: {
    slug: "quickstart",
    title: "Quickstart",
    description: "Get a tunnel running in under 60 seconds.",
    category: "Getting Started",
    content: `## 1. Install the CLI

\`\`\`bash
# npm (recommended)
npm install -g deployzy

# Homebrew (macOS/Linux)
brew install jams24/deployzy/deployzy

# Or download directly
curl -fsSL https://raw.githubusercontent.com/jams24/deployzy/main/deploy/get.sh | sh
\`\`\`

## 2. Log in

\`\`\`bash
# Opens your browser to sign in with Google
deployzy login
\`\`\`

Or use an API key from your [dashboard](https://deployzy.com/api-keys):

\`\`\`bash
deployzy authtoken sm_live_your_key_here
\`\`\`

## 3. Start a tunnel

\`\`\`bash
deployzy http 3000
\`\`\`

That's it. You'll see:

\`\`\`
  Deployzy — Expose localhost to the world
  ──────────────────────────────────────────

  ● Connected

  Version  1.0.0
  OS       darwin/arm64
  Inspect  http://127.0.0.1:4040

  HTTP  https://a1b2c3d4.deployzy.com → localhost:3000

  Press Ctrl+C to stop
\`\`\`

Your local server is now live at the public URL. Open the Inspector at \`http://127.0.0.1:4040\` to watch requests flow through in real-time.

> **Tip**: Add \`--subdomain myapp\` to get a custom subdomain like \`https://myapp.deployzy.com\`.`,
  },

  installation: {
    slug: "installation",
    title: "Installation",
    description: "Install the Deployzy CLI on any platform.",
    category: "Getting Started",
    content: `## npm (recommended)

Works on macOS, Linux, and Windows with Node.js 16+:

\`\`\`bash
npm install -g deployzy
\`\`\`

## Homebrew

macOS and Linux:

\`\`\`bash
brew install jams24/deployzy/deployzy
\`\`\`

## Shell script

Auto-detects your OS and architecture:

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/jams24/deployzy/main/deploy/get.sh | sh
\`\`\`

## Go install

If you have Go 1.24+:

\`\`\`bash
go install github.com/jams24/deployzy/cli/cmd/deployzy@latest
\`\`\`

## Manual download

Download pre-built binaries from [GitHub Releases](https://github.com/jams24/deployzy/releases):

| Platform | Architecture | File |
|----------|-------------|------|
| macOS | Apple Silicon | \`deployzy_darwin_arm64.tar.gz\` |
| macOS | Intel | \`deployzy_darwin_amd64.tar.gz\` |
| Linux | x86_64 | \`deployzy_linux_amd64.tar.gz\` |
| Linux | ARM64 | \`deployzy_linux_arm64.tar.gz\` |
| Windows | x86_64 | \`deployzy_windows_amd64.zip\` |
| Windows | ARM64 | \`deployzy_windows_arm64.zip\` |

## Verify

\`\`\`bash
deployzy version
\`\`\``,
  },

  authentication: {
    slug: "authentication",
    title: "Authentication",
    description: "How to authenticate with Deployzy.",
    category: "Getting Started",
    content: `There are three ways to authenticate with the CLI:

## 1. Browser login (recommended)

Opens your browser to sign in with Google:

\`\`\`bash
deployzy login
\`\`\`

This saves a JWT token to \`~/.deployzy/authtoken\` automatically. You only need to do this once.

## 2. API key

Get an API key from your [dashboard](https://deployzy.com/api-keys), then:

\`\`\`bash
deployzy authtoken sm_live_your_key_here
\`\`\`

API keys are useful for:
- CI/CD pipelines
- Shared machines
- Programmatic access via SDKs

## 3. Email + password

\`\`\`bash
deployzy login:email --email you@example.com --password yourpassword
\`\`\`

## How it works

- \`deployzy login\` saves a JWT token (expires in 24 hours, auto-refreshes)
- \`deployzy authtoken\` saves an API key (never expires unless revoked)
- Both are stored at \`~/.deployzy/authtoken\`
- The CLI reads this file automatically on every command

## For SDKs

Pass your API key directly:

\`\`\`typescript
import { Deployzy } from 'deployzy-sdk';
const client = new Deployzy({ authtoken: 'sm_live_...' });
\`\`\`

\`\`\`python
from deployzy import Deployzy
client = Deployzy(authtoken="sm_live_...")
\`\`\``,
  },

  "cli/http": {
    slug: "cli/http",
    title: "deployzy http",
    description: "Expose a local HTTP server to the internet.",
    category: "CLI",
    content: `\`\`\`bash
deployzy http [port] [flags]
\`\`\`

Creates an HTTP tunnel to expose a local web server.

## Examples

\`\`\`bash
# Basic — expose port 3000
deployzy http 3000

# Custom subdomain
deployzy http 3000 --subdomain myapp

# With basic auth
deployzy http 8080 --auth "user:password"

# Disable request inspection
deployzy http 3000 --inspect=false

# Full address instead of just port
deployzy http localhost:8080
\`\`\`

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| \`--subdomain\` | random | Custom subdomain (\`myapp.deployzy.com\`) |
| \`--hostname\` | — | Custom domain (\`api.example.com\`) |
| \`--auth\` | — | Basic auth (\`user:pass\`) |
| \`--inspect\` | \`true\` | Enable request inspection |
| \`--inspector-addr\` | \`127.0.0.1:4040\` | Local inspector address |
| \`--name\` | — | Tunnel name/label |

## Request inspection

When inspection is enabled (default), every request is captured and viewable at:
- **Local inspector**: \`http://127.0.0.1:4040\`
- **Dashboard**: \`https://deployzy.com/inspector\``,
  },

  "cli/tcp": {
    slug: "cli/tcp",
    title: "deployzy tcp",
    description: "Expose a local TCP service to the internet.",
    category: "CLI",
    content: `\`\`\`bash
deployzy tcp [port] [flags]
\`\`\`

Creates a TCP tunnel for any TCP-based service — databases, game servers, SSH, etc.

## Examples

\`\`\`bash
# Expose PostgreSQL
deployzy tcp 5432

# Expose MySQL with specific remote port
deployzy tcp 3306 --remote-port 33060

# Expose Redis
deployzy tcp 6379 --name redis
\`\`\`

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| \`--remote-port\` | auto (10000-60000) | Request a specific public port |
| \`--name\` | — | Tunnel name/label |

## Output

\`\`\`
  TCP  tcp://deployzy.com:10000 → localhost:5432
\`\`\`

Connect from anywhere: \`psql -h deployzy.com -p 10000 -U myuser mydb\``,
  },

  "cli/tls": {
    slug: "cli/tls",
    title: "deployzy tls",
    description: "TLS passthrough tunnel.",
    category: "CLI",
    content: `\`\`\`bash
deployzy tls [port] [flags]
\`\`\`

Creates a TLS passthrough tunnel. Traffic is forwarded without decryption — the server peeks at the SNI (Server Name Indication) field to route it, but never sees the plaintext.

## Examples

\`\`\`bash
deployzy tls 443
deployzy tls 8443 --subdomain secure
\`\`\`

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| \`--subdomain\` | random | Custom subdomain |
| \`--hostname\` | — | Custom domain |
| \`--name\` | — | Tunnel name/label |`,
  },

  "cli/start": {
    slug: "cli/start",
    title: "deployzy start",
    description: "Start tunnels from a configuration file.",
    category: "CLI",
    content: `\`\`\`bash
deployzy start [flags]
\`\`\`

Starts all tunnels defined in a YAML configuration file. Useful for running multiple tunnels at once.

## Examples

\`\`\`bash
# Use default config (~/.deployzy/deployzy.yml)
deployzy start

# Use custom config
deployzy start --config ./deployzy.yml
\`\`\`

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| \`-c, --config\` | \`~/.deployzy/deployzy.yml\` | Config file path |

## Auto-reconnect

\`deployzy start\` automatically reconnects if the connection drops, with exponential backoff (1s → 60s max).`,
  },

  "cli/login": {
    slug: "cli/login",
    title: "deployzy login",
    description: "Authenticate via browser or email.",
    category: "CLI",
    content: `## Browser login (Google)

\`\`\`bash
deployzy login
\`\`\`

Opens your default browser to sign in with Google. The token is saved automatically to \`~/.deployzy/authtoken\`.

## Email + password

\`\`\`bash
deployzy login:email --email you@example.com --password yourpass
\`\`\`

## Manual token

\`\`\`bash
deployzy authtoken sm_live_your_key
\`\`\`

Get your API key from [deployzy.com/api-keys](https://deployzy.com/api-keys).`,
  },

  "cli/config": {
    slug: "cli/config",
    title: "Configuration",
    description: "YAML configuration file reference.",
    category: "CLI",
    content: `## Location

Default: \`~/.deployzy/deployzy.yml\`

## Example

\`\`\`yaml
server: deployzy.com:8443
authtoken: sm_live_your_token
log_level: info
inspector_addr: 127.0.0.1:4040

tunnels:
  webapp:
    proto: http
    addr: "3000"
    subdomain: myapp
    inspect: true

  api:
    proto: http
    addr: "8080"
    subdomain: api

  database:
    proto: tcp
    addr: "5432"
    remote_port: 54320
\`\`\`

## Top-level fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| \`server\` | No | \`deployzy.com:8443\` | Server address |
| \`authtoken\` | No | saved token | API key or JWT |
| \`log_level\` | No | \`info\` | \`debug\`, \`info\`, \`warn\`, \`error\` |
| \`inspector_addr\` | No | \`127.0.0.1:4040\` | Local inspector address |

## Tunnel fields

| Field | Required | Description |
|-------|----------|-------------|
| \`proto\` | Yes | \`http\`, \`tcp\`, or \`tls\` |
| \`addr\` | Yes | Local port or address |
| \`subdomain\` | No | Custom subdomain (HTTP/TLS) |
| \`hostname\` | No | Custom domain (HTTP/TLS) |
| \`remote_port\` | No | Remote port (TCP only) |
| \`inspect\` | No | Enable inspection (default: true) |
| \`auth\` | No | Basic auth \`user:pass\` (HTTP only) |`,
  },

  "api/overview": {
    slug: "api/overview",
    title: "API Overview",
    description: "REST API for managing tunnels, domains, and keys.",
    category: "API Reference",
    content: `## Base URL

\`\`\`
https://api.deployzy.com/api/v1
\`\`\`

## Authentication

All protected endpoints require one of:

\`\`\`
Authorization: Bearer <jwt_token>
\`\`\`

or

\`\`\`
X-API-Key: sm_live_...
\`\`\`

API keys carry a **scope** — \`read\`, \`deploy\`, or \`full\`. A \`deploy\` key can
create and deploy projects but can't manage keys, billing, or delete your
account (ideal for CI). See [API Keys](/docs/api/keys). JWT sessions are always full access.

## What you can manage

Tunnels · [Projects & deploys](/docs/api/projects) (from a git repo, a prebuilt
image, or an uploaded directory) · databases · [custom domains](/docs/api/domains) ·
[API keys](/docs/api/keys) · request inspection.

## Response format

All responses are JSON. Errors return:

\`\`\`json
{ "error": "description of what went wrong" }
\`\`\`

## Rate limits

| Plan | Limit |
|------|-------|
| Free | 100 req/s |
| Pro  | 500 req/s |
| Team | 2000 req/s |

When rate limited, you'll receive a \`429\` status with a \`Retry-After\` header.`,
  },

  "api/auth": {
    slug: "api/auth",
    title: "Auth Endpoints",
    description: "Register, login, and Google OAuth.",
    category: "API Reference",
    content: `## Register

\`\`\`
POST /api/v1/auth/register
\`\`\`

\`\`\`json
{
  "email": "you@example.com",
  "name": "Your Name",
  "password": "minimum8chars"
}
\`\`\`

**Response** (201):

\`\`\`json
{
  "user": { "id": "...", "email": "...", "name": "...", "plan": "free" },
  "token": "eyJ...",
  "api_key": "sm_live_..."
}
\`\`\`

> The \`api_key\` is only returned once. Save it immediately.

## Login

\`\`\`
POST /api/v1/auth/login
\`\`\`

\`\`\`json
{ "email": "you@example.com", "password": "yourpassword" }
\`\`\`

**Response** (200):

\`\`\`json
{
  "user": { "id": "...", "email": "...", "plan": "free" },
  "token": "eyJ..."
}
\`\`\`

## Google OAuth

\`\`\`
GET /api/v1/auth/google
\`\`\`

Redirects to Google sign-in. After authentication, redirects to:
- **Browser**: \`https://deployzy.com/auth/callback?token=...\`
- **CLI**: \`http://127.0.0.1:PORT/callback?token=...\` (when \`?callback=\` param is passed)`,
  },

  "api/tunnels": {
    slug: "api/tunnels",
    title: "Tunnels",
    description: "List active tunnels.",
    category: "API Reference",
    content: `## List tunnels

\`\`\`
GET /api/v1/tunnels
\`\`\`

Returns tunnels owned by the authenticated user.

**Response** (200):

\`\`\`json
[
  {
    "url": "https://myapp.deployzy.com",
    "protocol": "http",
    "name": "webapp",
    "client_id": "abc123def456"
  }
]
\`\`\``,
  },

  "api/domains": {
    slug: "api/domains",
    title: "Domains",
    description: "Manage custom domains.",
    category: "API Reference",
    content: `## List domains

\`\`\`
GET /api/v1/domains
\`\`\`

## Add a domain

\`\`\`
POST /api/v1/domains
\`\`\`

\`\`\`json
{ "domain": "api.example.com" }
\`\`\`

**Response** (201):

\`\`\`json
{
  "domain": {
    "id": "...",
    "domain": "api.example.com",
    "verified": false,
    "cname_target": "tunnel.deployzy.com"
  },
  "instructions": {
    "type": "CNAME",
    "name": "api.example.com",
    "target": "tunnel.deployzy.com"
  }
}
\`\`\`

## Verify DNS

\`\`\`
POST /api/v1/domains/:id/verify
\`\`\`

## Delete a domain

\`\`\`
DELETE /api/v1/domains/:id
\`\`\``,
  },

  "api/keys": {
    slug: "api/keys",
    title: "API Keys",
    description: "Create and manage API keys.",
    category: "API Reference",
    content: `## List keys

\`\`\`
GET /api/v1/api-keys
\`\`\`

## Create a key

\`\`\`
POST /api/v1/api-keys
\`\`\`

\`\`\`json
{ "name": "ci-cd", "scope": "deploy" }
\`\`\`

**Response** (201):

\`\`\`json
{
  "api_key": "sm_live_abc123...",
  "info": { "id": "...", "name": "ci-cd", "prefix": "sm_live_abc1", "scope": "deploy" }
}
\`\`\`

> The full key is only returned at creation. Store it securely.

## Scopes

Keys carry one of three scopes (default \`full\`):

| Scope | Can do | Cannot do |
|-------|--------|-----------|
| \`read\` | List/inspect projects, logs, metrics | Any change |
| \`deploy\` | Create/deploy/stop/delete projects, set env, manage domains & databases | Manage API keys, billing, teams, BYOC servers, delete account |
| \`full\` | Everything (same as the dashboard) | — |

Use a \`deploy\` key in CI: even if it leaks, it can't mint new keys or delete your account. A key can only create another key at the same or lower scope, and only a \`full\` session can create a \`full\` key. Requests below the required scope get **403**.

## Delete a key

\`\`\`
DELETE /api/v1/api-keys/:id
\`\`\``,
  },

  "api/projects": {
    slug: "api/projects",
    title: "Projects & Deploys",
    description: "Create, deploy, and manage projects over the REST API.",
    category: "API Reference",
    content: `Deploy and manage projects programmatically. Authenticate with an API key
(\`X-API-Key: sm_live_...\`) — a \`deploy\`-scoped key is enough for everything here.

## The deploy lifecycle

1. **Create** a project (from a git repo, a prebuilt image, or an upload)
2. **Set env vars** (optional)
3. **Deploy** — builds (if needed) and starts the container
4. **Poll** the project until \`status\` is \`running\` or \`failed\`

## List projects

\`\`\`
GET /api/v1/projects
\`\`\`

## Create a project

\`\`\`
POST /api/v1/projects
\`\`\`

**From a GitHub repo:**

\`\`\`json
{ "name": "api", "subdomain": "api", "repo_url": "https://github.com/you/api.git", "github_repo": "you/api", "branch": "main" }
\`\`\`

**From a prebuilt image** (no build — \`docker pull\` + run):

\`\`\`json
{ "name": "proxy", "subdomain": "proxy", "image": "nginx:alpine" }
\`\`\`

**From an upload:** create with \`"deploy_source": "upload"\`, then POST a \`.tar.gz\`
build context to \`/api/v1/projects/:id/upload\` before deploying.

The response is the project object, including its \`id\`.

## Set environment variables

\`\`\`
PUT /api/v1/projects/:id
\`\`\`

\`\`\`json
{ "env_vars": { "DATABASE_URL": "postgres://...", "NODE_ENV": "production" } }
\`\`\`

## Advanced build settings

\`\`\`
PUT /api/v1/projects/:id/build-config
\`\`\`

\`\`\`json
{ "install_cmd": "npm ci", "build_cmd": "npm run build", "start_cmd": "npm start", "root_dir": "apps/web", "port_override": 3000 }
\`\`\`

## Multiple services (one container)

Deploy several directories of a monorepo as services inside a single container.
Pass a \`services\` array to the build-config endpoint — the primary app keeps the
project's port + subdomain, and each service gets a flat sibling subdomain
(\`<subdomain>-<name>.deployzy.com\`):

\`\`\`json
{
  "services": [
    { "name": "api", "root_dir": "apps/api", "port": 4000, "install_cmd": "npm ci", "build_cmd": "npm run build", "start_cmd": "npm start", "env_overrides": { "SERVICE_MODE": "api" } },
    { "name": "worker", "root_dir": "worker", "port": 4001, "start_cmd": "node worker.js" }
  ]
}
\`\`\`

Names must be lowercase DNS-safe labels, unique, with unique ports (max 5 services).
Omit \`services\` (or send \`[]\`) for a single-service project.

## Deploy

\`\`\`
POST /api/v1/projects/:id/deploy
\`\`\`

## Logs & status

\`\`\`
GET /api/v1/projects/:id          # { project, logs }
GET /api/v1/projects/:id/logs     # deploy log lines
\`\`\`

\`project.status\` moves through \`building\` → \`running\` (or \`failed\`).

## Stop / delete

\`\`\`
POST   /api/v1/projects/:id/stop
DELETE /api/v1/projects/:id
\`\`\`

## End-to-end (curl)

\`\`\`bash
KEY=sm_live_...

# 1. Create from a repo
PID=$(curl -s -X POST https://api.deployzy.com/api/v1/projects \\
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \\
  -d '{"name":"api","subdomain":"api","repo_url":"https://github.com/you/api.git","github_repo":"you/api","branch":"main"}' \\
  | jq -r .id)

# 2. Deploy
curl -s -X POST https://api.deployzy.com/api/v1/projects/$PID/deploy -H "X-API-Key: $KEY"

# 3. Poll status
curl -s https://api.deployzy.com/api/v1/projects/$PID -H "X-API-Key: $KEY" | jq -r .project.status
\`\`\`

> Prefer a client library? See the [JavaScript](/docs/sdks/javascript) and
> [Python](/docs/sdks/python) SDKs, or the [\`deployzy deploy\`](/docs/cli/deploy) CLI.`,
  },

  "api/inspection": {
    slug: "api/inspection",
    title: "Inspection",
    description: "View and replay captured HTTP requests.",
    category: "API Reference",
    content: `## List captured requests

\`\`\`
GET /api/v1/tunnels/:tunnelUrl/requests
\`\`\`

**Response** (200):

\`\`\`json
[
  {
    "id": "a1b2c3d4",
    "method": "POST",
    "path": "/api/webhook",
    "status_code": 200,
    "duration_ms": 12,
    "request_headers": { "Content-Type": "application/json" },
    "response_headers": { "Content-Type": "application/json" },
    "request_size": 256,
    "response_size": 128,
    "remote_addr": "1.2.3.4:54321",
    "timestamp": "2026-03-29T12:00:00Z"
  }
]
\`\`\`

## Replay a request

\`\`\`
POST /api/v1/tunnels/:tunnelUrl/replay/:requestId
\`\`\`

Re-sends the captured request through the tunnel and returns the new response.

## Live traffic (WebSocket)

\`\`\`
WS /api/v1/ws/traffic/:tunnelUrl
\`\`\`

Each message is a JSON-encoded captured request, streamed in real-time.

> **Note**: Captured requests are stored in memory and are lost when the server restarts.`,
  },

  "sdks/javascript": {
    slug: "sdks/javascript",
    title: "JavaScript / TypeScript",
    description: "Official deployzy for Node.js and TypeScript.",
    category: "SDKs",
    content: `## Install

\`\`\`bash
npm install deployzy-sdk
\`\`\`

## Quick start

\`\`\`typescript
import { Deployzy } from 'deployzy-sdk';

const client = new Deployzy({ authtoken: 'sm_live_...' });

const tunnels = await client.tunnels.list();
const requests = await client.inspect.list(tunnels[0].url);
const result = await client.inspect.replay(tunnels[0].url, requests[0].id);
\`\`\`

## Live traffic streaming

\`\`\`typescript
const stream = client.inspect.subscribe('https://myapp.deployzy.com');

for await (const req of stream) {
  console.log(\`\${req.method} \${req.path} -> \${req.statusCode}\`);
}

stream.close();
\`\`\`

## Deploy a project

\`\`\`typescript
// Build from a GitHub repo (or pass { image: 'nginx:alpine' } to run a prebuilt image)
const project = await client.projects.create({
  name: 'api',
  subdomain: 'api',
  repo: 'you/api',
  env: { NODE_ENV: 'production' },
});

await client.projects.deploy(project.id);
const final = await client.projects.waitForDeploy(project.id);
console.log(final.status); // "running" or "failed"

const projects = await client.projects.list();
await client.projects.logs(project.id);
\`\`\`

## API keys

\`\`\`typescript
const keys = await client.apiKeys.list();
const { apiKey, info } = await client.apiKeys.create('my-app');
await client.apiKeys.delete(info.id);
\`\`\`

## Domains

\`\`\`typescript
const { domain, instructions } = await client.domains.create('api.example.com');
await client.domains.verify(domain.id);
const all = await client.domains.list();
\`\`\`

## Error handling

\`\`\`typescript
import { AuthError, RateLimitError, ApiError } from 'deployzy-sdk';

try {
  await client.tunnels.list();
} catch (err) {
  if (err instanceof AuthError) { /* bad token */ }
  if (err instanceof RateLimitError) { /* retry in err.retryAfter seconds */ }
  if (err instanceof ApiError) { /* err.statusCode, err.message */ }
}
\`\`\`

## Self-hosted

\`\`\`typescript
const client = new Deployzy({
  authtoken: 'sm_live_...',
  serverUrl: 'https://api.yourdomain.com',
});
\`\`\``,
  },

  "sdks/python": {
    slug: "sdks/python",
    title: "Python",
    description: "Official async Python SDK.",
    category: "SDKs",
    content: `## Install

\`\`\`bash
pip install serverme
\`\`\`

Requires Python 3.9+ and aiohttp.

## Quick start

\`\`\`python
import asyncio
from deployzy import Deployzy

async def main():
    async with Deployzy(authtoken="sm_live_...") as client:
        tunnels = await client.tunnels.list()
        requests = await client.inspect.list(tunnels[0].url)

        for req in requests:
            print(f"{req.method} {req.path} -> {req.status_code}")

asyncio.run(main())
\`\`\`

## Live traffic

\`\`\`python
async with Deployzy(authtoken="sm_live_...") as client:
    async for req in client.inspect.subscribe(tunnel_url):
        print(f"{req.method} {req.path} -> {req.status_code}")
\`\`\`

## Deploy a project

\`\`\`python
async with Deployzy(authtoken="sm_live_...") as client:
    # Build from a repo (or pass image="nginx:alpine" to run a prebuilt image)
    project = await client.projects.create(
        name="api", subdomain="api", repo="you/api",
        env={"NODE_ENV": "production"},
    )
    await client.projects.deploy(project.id)
    final = await client.projects.wait_for_deploy(project.id)
    print(final.status)  # "running" or "failed"
\`\`\`

## API keys

\`\`\`python
keys = await client.api_keys.list()
full_token, info = await client.api_keys.create("my-app")
await client.api_keys.delete(info.id)
\`\`\`

## Error handling

\`\`\`python
from deployzy import AuthError, RateLimitError

try:
    await client.tunnels.list()
except AuthError:
    print("Bad token")
except RateLimitError as e:
    print(f"Retry in {e.retry_after}s")
\`\`\`

## Self-hosted

\`\`\`python
client = Deployzy(
    authtoken="sm_live_...",
    server_url="https://api.yourdomain.com",
)
\`\`\``,
  },

  "guides/custom-domains": {
    slug: "guides/custom-domains",
    title: "Custom Domains",
    description: "Use your own domain with Deployzy tunnels.",
    category: "Guides",
    content: `## Setup

### 1. Add your domain

Go to [Domains](https://deployzy.com/domains) in the dashboard, or via API:

\`\`\`bash
curl -X POST https://api.deployzy.com/api/v1/domains \\
  -H "X-API-Key: sm_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"domain": "api.example.com"}'
\`\`\`

### 2. Add a DNS record

Add a CNAME record in your DNS provider:

| Type | Name | Target |
|------|------|--------|
| CNAME | \`api.example.com\` | \`tunnel.deployzy.com\` |

### 3. Verify

Click "Verify" in the dashboard, or:

\`\`\`bash
curl -X POST https://api.deployzy.com/api/v1/domains/:id/verify \\
  -H "X-API-Key: sm_live_..."
\`\`\`

### 4. Use it

\`\`\`bash
deployzy http 3000 --hostname api.example.com
\`\`\`

## TLS certificates

Deployzy automatically provisions Let's Encrypt certificates for verified custom domains. The first request to a new domain takes ~5 seconds (certificate provisioning), then instant after that.`,
  },

  "guides/webhooks": {
    slug: "guides/webhooks",
    title: "Webhook Testing",
    description: "Test webhooks from Stripe, GitHub, and more on localhost.",
    category: "Guides",
    content: `## The problem

Services like Stripe, GitHub, and Slack send webhooks to a public URL. When developing locally, your machine isn't publicly accessible.

## The solution

\`\`\`bash
deployzy http 3000
\`\`\`

Copy the public URL (e.g., \`https://abc123.deployzy.com\`) and paste it as your webhook URL in the service's dashboard.

## Example: Stripe webhooks

\`\`\`bash
# 1. Start your app
node app.js  # listening on port 3000

# 2. Start the tunnel
deployzy http 3000 --subdomain stripe-test

# 3. Set your Stripe webhook URL to:
# https://stripe-test.deployzy.com/webhook
\`\`\`

## Inspecting webhooks

Open \`http://127.0.0.1:4040\` to see every webhook as it arrives — headers, body, timing. Click any request to see full details.

## Replaying webhooks

Missed a webhook? Use the Inspector to replay it:

1. Open the Inspector
2. Find the webhook request
3. Click "Replay"

Or via API:

\`\`\`bash
curl -X POST https://api.deployzy.com/api/v1/tunnels/{url}/replay/{requestId} \\
  -H "X-API-Key: sm_live_..."
\`\`\``,
  },

  "guides/self-hosting": {
    slug: "guides/self-hosting",
    title: "Self-Hosting",
    description: "Deploy your own Deployzy server.",
    category: "Guides",
    content: `## One-command install

On a fresh Ubuntu 22.04+ VPS:

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/jams24/deployzy/main/deploy/install.sh | bash -s -- \\
  --domain tunnel.yourdomain.com \\
  --email you@example.com
\`\`\`

This installs PostgreSQL, Caddy (for TLS), and Deployzy. Takes about 2 minutes.

## DNS setup

Before or after install, add these DNS records:

| Type | Name | Target |
|------|------|--------|
| A | \`tunnel.yourdomain.com\` | \`<your-server-ip>\` |
| CNAME | \`*.tunnel.yourdomain.com\` | \`tunnel.yourdomain.com\` |
| CNAME | \`api.tunnel.yourdomain.com\` | \`tunnel.yourdomain.com\` |

## Docker Compose

\`\`\`yaml
services:
  serverme:
    image: ghcr.io/jams24/deployzysrv:latest
    ports:
      - "8443:8443"
      - "9080:9080"
      - "9081:9081"
    environment:
      SM_DOMAIN: tunnel.yourdomain.com
      SM_DATABASE_URL: postgres://serverme:pass@postgres:5432/serverme
      SM_JWT_SECRET: your-secret-here
    depends_on:
      - postgres

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: serverme
      POSTGRES_USER: serverme
      POSTGRES_PASSWORD: pass
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
\`\`\`

## Connect clients

Point clients to your server:

\`\`\`bash
deployzy http 3000 --server tunnel.yourdomain.com:8443
\`\`\`

## Options

| Flag | Description |
|------|-------------|
| \`--domain\` | Base domain (required) |
| \`--email\` | For Let's Encrypt certs (required) |
| \`--google-id\` | Google OAuth Client ID |
| \`--google-secret\` | Google OAuth Client Secret |
| \`--skip-caddy\` | Skip Caddy install |
| \`--skip-db\` | Skip PostgreSQL install |`,
  },

  "cli/deploy": {
    slug: "cli/deploy",
    title: "deployzy deploy",
    description: "Deploy projects from the command line.",
    category: "CLI",
    content: `Deploy a project from a git repo, a prebuilt image, or the current directory —
then stream the build logs until it's live.

First, authenticate with an API key (create one at
[deployzy.com/api-keys](https://deployzy.com/api-keys)):

\`\`\`bash
deployzy authtoken sm_live_...
\`\`\`

## Deploy

\`\`\`bash
# From a GitHub repo
deployzy deploy --repo you/api --name api

# From a prebuilt image (no build)
deployzy deploy --image nginx:alpine --name proxy

# Upload + build the current directory
deployzy deploy ./
\`\`\`

The command creates the project, deploys it, and streams logs until it reports
\`running\`, printing the public URL.

### Flags

| Flag | Description |
|------|-------------|
| \`--repo\` | GitHub repo (\`OWNER/NAME\` or https URL) |
| \`--image\` | Prebuilt image to run (e.g. \`nginx:alpine\`) |
| \`[dir]\` | Local directory to upload as the build context |
| \`--name\` | Project name (defaults to the repo/image/dir name) |
| \`--subdomain\` | Public subdomain (defaults to a slug of the name) |
| \`--branch\` | Git branch for \`--repo\` (default \`main\`) |
| \`-e, --env\` | Environment variable \`KEY=VALUE\` (repeatable) |
| \`--no-follow\` | Don't stream logs; return immediately |

## Manage projects

\`\`\`bash
deployzy projects ls            # list your projects
deployzy projects rm api        # delete (by name, subdomain, or id)
deployzy logs api --follow      # stream deploy logs
deployzy env set api KEY=value  # set an env var (redeploy to apply)
deployzy env ls api             # list env vars
\`\`\`

> Self-hosted? Point the CLI at your API with \`SERVERME_API_URL=https://api.yourdomain.com\`.`,
  },

  "guides/deploy-from-ci": {
    slug: "guides/deploy-from-ci",
    title: "Deploy from CI",
    description: "Deploy on every push with a scoped API key and GitHub Actions.",
    category: "Guides",
    content: `Deploy automatically from CI using a **\`deploy\`-scoped** API key — safe to store
as a secret because it can't manage keys, billing, or delete your account.

## 1. Create a deploy key

In the dashboard, go to **API Keys**, choose scope **Deploy**, and copy the
\`sm_live_...\` token. Add it to your repo as a secret named \`SERVERME_API_KEY\`.

## 2. GitHub Actions workflow

\`\`\`yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Deployzy CLI
        run: curl -fsSL https://deployzy.com/install.sh | sh
      - name: Deploy
        env:
          SERVERME_API_KEY: \${{ secrets.SERVERME_API_KEY }}
        run: |
          deployzy authtoken "$SERVERME_API_KEY"
          deployzy deploy --repo \${{ github.repository }} --name api --no-follow
\`\`\`

## Or with curl (no CLI)

\`\`\`bash
curl -s -X POST https://api.deployzy.com/api/v1/projects/$PROJECT_ID/deploy \\
  -H "X-API-Key: $SERVERME_API_KEY"
\`\`\`

## Or with the SDK

\`\`\`javascript
import { Deployzy } from "deployzy-sdk";

const sme = new Deployzy({ authtoken: process.env.SERVERME_API_KEY });
await sme.projects.deploy(process.env.PROJECT_ID);
const final = await sme.projects.waitForDeploy(process.env.PROJECT_ID);
if (final.status !== "running") process.exit(1);
\`\`\`

See [Projects & Deploys](/docs/api/projects) for the full API.`,
  },
};
