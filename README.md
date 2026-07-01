# Deployzy

Open-source tunnel to expose your local servers to the internet. Like ngrok, but open source and self-hostable.

## Features

- **HTTP Tunnels** — Expose local HTTP servers with custom subdomains
- **TCP Tunnels** — Forward raw TCP traffic (databases, game servers, etc.)
- **TLS Tunnels** — TLS termination and passthrough
- **Request Inspection** — View and replay HTTP traffic in real-time
- **Custom Domains** — Bring your own domain with automatic TLS
- **Rate Limiting** — Protect your tunnels from abuse
- **OAuth at Edge** — Google/GitHub authentication before traffic reaches your app
- **Webhook Verification** — Verify Stripe, GitHub, and generic webhook signatures
- **Team Management** — Collaborate with your team
- **SDKs** — JavaScript/TypeScript and Python SDKs
- **Dashboard** — Full web UI for managing tunnels, domains, and traffic
- **Self-Hostable** — One-command deploy to any VPS

## Quick Start

```bash
# Install the CLI
go install github.com/jams24/deployzy/cli/cmd/deployzy@latest

# Authenticate
deployzy authtoken YOUR_TOKEN

# Expose a local HTTP server
deployzy http 8080
```

Output:

```
Deployzy                               (Ctrl+C to quit)

Version              1.0.0
Web Inspector        http://127.0.0.1:4040

Forwarding           https://a1b2c3d4.deployzy.com -> localhost:8080
```

## Self-Host (One Command)

Deploy your own Deployzy server on any Ubuntu/Debian VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/serverme/serverme/main/deploy/install.sh | bash -s -- \
  --domain tunnel.yourdomain.com \
  --email you@example.com
```

This installs PostgreSQL, Caddy (TLS), and Deployzy server. Takes about 2 minutes.

**Options:**

```bash
./deploy/install.sh \
  --domain tunnel.yourdomain.com \    # Required: your domain
  --email you@example.com \           # Required: for TLS certs
  --google-id CLIENT_ID \             # Optional: Google OAuth
  --google-secret CLIENT_SECRET \     # Optional: Google OAuth
  --skip-caddy \                      # Optional: if Caddy is already installed
  --skip-db                           # Optional: if PostgreSQL is already installed
```

**DNS Setup** (before or after install):

```
A     tunnel.yourdomain.com    → <your-server-ip>
CNAME *.tunnel.yourdomain.com  → tunnel.yourdomain.com
CNAME api.tunnel.yourdomain.com → tunnel.yourdomain.com
```

## CLI Commands

```bash
deployzy http 3000                    # HTTP tunnel
deployzy http 3000 --subdomain myapp  # Custom subdomain
deployzy http 3000 --auth user:pass   # Basic auth
deployzy tcp 5432                     # TCP tunnel (databases, etc.)
deployzy tcp 5432 --remote-port 54320 # Specific remote port
deployzy tls 443                      # TLS passthrough
deployzy start                        # All tunnels from config file
deployzy start -c deployzy.yml        # Custom config path
deployzy authtoken <TOKEN>            # Save auth token
deployzy version                      # Version info
```

## Configuration File

`~/.deployzy/deployzy.yml`:

```yaml
server: tunnel.yourdomain.com:443
authtoken: sm_live_your_token

tunnels:
  webapp:
    proto: http
    addr: "3000"
    subdomain: myapp
    inspect: true
  database:
    proto: tcp
    addr: "5432"
    remote_port: 54320
```

## SDKs

### JavaScript / TypeScript

```bash
npm install deployzy-sdk
```

```typescript
import { Deployzy } from 'deployzy-sdk';

const client = new Deployzy({ authtoken: 'sm_live_...' });
const tunnels = await client.tunnels.list();
const requests = await client.inspect.list(tunnels[0].url);

// Live traffic streaming
for await (const req of client.inspect.subscribe(tunnelUrl)) {
  console.log(`${req.method} ${req.path} -> ${req.statusCode}`);
}
```

### Python

```bash
pip install deployzy
```

```python
from deployzy import Deployzy

async with Deployzy(authtoken="sm_live_...") as client:
    tunnels = await client.tunnels.list()
    async for req in client.inspect.subscribe(tunnels[0].url):
        print(f"{req.method} {req.path} -> {req.status_code}")
```

## Architecture

```
Internet → Caddy (TLS) → Deployzy Server → smux over TLS → CLI Client → Local Service
                              ↕
                    PostgreSQL (users, keys, domains)
                              ↕
                    REST API + WebSocket (dashboard, SDKs)
```

## Project Structure

```
serverme/
├── proto/        # Shared protocol (Go)
├── server/       # Tunnel server (Go)
├── cli/          # CLI client (Go)
├── web/          # Website + Dashboard (Next.js 16)
├── sdk-js/       # JavaScript/TypeScript SDK
├── sdk-python/   # Python SDK
├── deploy/       # Install script, Docker Compose
└── docs/         # Documentation
```

## Development

```bash
# Build everything
make build

# Run server (dev mode, no TLS, no DB)
make dev-server

# Run tests
make test

# Dev with database
docker compose -f deploy/docker-compose.yml up -d
./bin/servermesrv --domain=localhost --addr=:8443 --http-addr=:8080 --api-addr=:8081 \
  --database-url="postgres://serverme:serverme@localhost:5432/serverme?sslmode=disable"
```

## License

MIT — see [LICENSE](LICENSE)
