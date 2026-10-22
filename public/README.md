# Deployzy CLI & SDKs

Official command-line tool and SDKs for [Deployzy](https://deployzy.com) — deploy apps from GitHub, expose localhost through secure tunnels, and run managed databases.

This repository holds the open-source client side of Deployzy. The hosted platform itself is operated at [deployzy.com](https://deployzy.com).

| Package | Install | Source |
|---------|---------|--------|
| CLI | `npm i -g deployzy` · `brew install jams24/deployzy/deployzy` | [`cli/`](cli), [`npm-package/`](npm-package) |
| JavaScript / TypeScript SDK | `npm i deployzy-sdk` | [`sdk-js/`](sdk-js) |
| Python SDK | `pip install deployzy` | [`sdk-python/`](sdk-python) |

Or install the CLI binary directly (macOS / Linux):

```bash
curl -fsSL https://raw.githubusercontent.com/jams24/deployzy-cli/main/install.sh | sh
```

Pre-built binaries for every platform are on the [Releases](https://github.com/jams24/deployzy-cli/releases) page.

## Quick start

```bash
deployzy login            # opens the browser to authenticate
deployzy http 3000        # public HTTPS URL → your localhost:3000
deployzy tcp 5432         # raw TCP tunnel (databases, SSH, game servers)
deployzy deploy           # deploy the current directory
```

Full documentation: [deployzy.com/docs](https://deployzy.com/docs)

## Building from source

```bash
git clone https://github.com/jams24/deployzy-cli
cd deployzy-cli
go build -C cli -o deployzy ./cmd/deployzy
```

Requires Go 1.24+.

## Contributing

This repository is a published mirror; each release is synced from Deployzy's internal tree. Issues and pull requests are welcome — accepted changes are applied upstream and appear here with the next release.

Security issues: please email support@deployzy.com rather than opening a public issue.

## License

[MIT](LICENSE)
