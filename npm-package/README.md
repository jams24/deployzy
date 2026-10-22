# deployzy

CLI for [Deployzy](https://deployzy.com) — deploy apps, expose your local servers to the internet, and manage databases.

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
brew install jams24/deployzy/deployzy

# Shell script (macOS/Linux)
curl -fsSL https://raw.githubusercontent.com/jams24/deployzy-cli/main/install.sh | sh
```

## Links

- Website: https://deployzy.com
- GitHub: https://github.com/jams24/deployzy-cli
- Docs: https://deployzy.com/docs

## License

MIT
