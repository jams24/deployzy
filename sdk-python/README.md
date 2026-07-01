# deployzy

Official Python SDK for [Deployzy](https://deployzy.com) — deploy & tunnel platform.

## Install

```bash
pip install deployzy
```

## Quick Start

```python
import asyncio
from deployzy import Deployzy

async def main():
    async with Deployzy(authtoken="sm_live_...") as client:
        # List active tunnels
        tunnels = await client.tunnels.list()
        print(tunnels)

        # Get captured requests
        requests = await client.inspect.list(tunnels[0].url)
        for req in requests:
            print(f"{req.method} {req.path} -> {req.status_code} ({req.duration_ms}ms)")

asyncio.run(main())
```

## Live Traffic Streaming

```python
async with Deployzy(authtoken="sm_live_...") as client:
    async for req in client.inspect.subscribe("https://abc123.deployzy.com"):
        print(f"{req.method} {req.path} -> {req.status_code}")
```

## API Keys

```python
async with Deployzy(authtoken="sm_live_...") as client:
    # List keys
    keys = await client.api_keys.list()

    # Create a new key
    full_token, info = await client.api_keys.create("my-app")
    print(full_token)  # sm_live_... (save this!)

    # Delete a key
    await client.api_keys.delete(info.id)
```

## Custom Domains

```python
async with Deployzy(authtoken="sm_live_...") as client:
    # Add a domain
    domain, instructions = await client.domains.create("api.example.com")
    print(f"Add CNAME: {instructions['name']} -> {instructions['target']}")

    # Verify DNS
    result = await client.domains.verify(domain.id)
    print(result)

    # List domains
    domains = await client.domains.list()
```

## Error Handling

```python
from deployzy import Deployzy, AuthError, RateLimitError, ApiError

try:
    async with Deployzy(authtoken="invalid") as client:
        await client.tunnels.list()
except AuthError:
    print("Bad token")
except RateLimitError as e:
    print(f"Rate limited, retry in {e.retry_after}s")
except ApiError as e:
    print(f"API error {e.status_code}: {e}")
```

## Self-Hosted

```python
client = Deployzy(
    authtoken="sm_live_...",
    server_url="https://tunnel.mycompany.com",
)
```

## License

MIT
