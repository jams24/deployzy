# serverme-cli

CLI for [ServerMe](https://serverme.site) — open-source tunnel to expose your local servers to the internet.

## Install

```bash
npm install -g serverme-cli
```

## Usage

```bash
# Expose an HTTP server
serverme http 3000

# TCP tunnel
serverme tcp 5432

# TLS passthrough
serverme tls 443

# Save auth token
serverme authtoken YOUR_TOKEN

# Multiple tunnels from config
serverme start
```

## Other Install Methods

```bash
# Homebrew (macOS/Linux)
brew install serverme/tap/serverme

# Go
go install github.com/jams24/deployzy/cli/cmd/deployzy@latest

# Shell script
curl -fsSL https://get.serverme.site | sh
```

## Links

- Website: https://serverme.site
- GitHub: https://github.com/jams24/deployzy
- Docs: https://serverme.site/docs

## License

MIT
