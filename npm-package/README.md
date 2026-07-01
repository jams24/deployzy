# deployzy

CLI for [Deployzy](https://deployzy.com) — open-source tunnel to expose your local servers to the internet.

## Install

```bash
npm install -g deployzy
```

## Usage

```bash
# Expose an HTTP server
deployzy http 3000

# TCP tunnel
deployzy tcp 5432

# TLS passthrough
deployzy tls 443

# Save auth token
deployzy authtoken YOUR_TOKEN

# Multiple tunnels from config
deployzy start
```

## Other Install Methods

```bash
# Homebrew (macOS/Linux)
brew install deployzy/tap/deployzy

# Go
go install github.com/jams24/deployzy/cli/cmd/deployzy@latest

# Shell script
curl -fsSL https://get.deployzy.com | sh
```

## Links

- Website: https://deployzy.com
- GitHub: https://github.com/jams24/deployzy
- Docs: https://deployzy.com/docs

## License

MIT
