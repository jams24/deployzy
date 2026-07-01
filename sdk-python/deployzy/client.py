"""Deployzy Python SDK client."""

from __future__ import annotations

import asyncio
import time
from typing import AsyncIterator, Optional
from urllib.parse import quote

import aiohttp

from deployzy.errors import ApiError, AuthError, NotFoundError, RateLimitError, DeployzyError
from deployzy.types import (
    ApiKey,
    CapturedRequest,
    DeployLog,
    Domain,
    Project,
    ReplayResult,
    Tunnel,
    User,
)

DEFAULT_SERVER_URL = "https://api.deployzy.com"


class Deployzy:
    """
    Deployzy SDK client.

    Example::

        import asyncio
        from deployzy import Deployzy

        async def main():
            client = Deployzy(authtoken="sm_live_...")

            # List tunnels
            tunnels = await client.tunnels.list()
            print(tunnels)

            # Get captured requests
            requests = await client.inspect.list(tunnels[0].url)

            await client.close()

        asyncio.run(main())
    """

    def __init__(
        self,
        authtoken: str,
        server_url: str = DEFAULT_SERVER_URL,
        timeout: float = 30.0,
    ):
        if not authtoken:
            raise AuthError("authtoken is required")

        self._base_url = server_url.rstrip("/")
        self._authtoken = authtoken
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        self._session: Optional[aiohttp.ClientSession] = None

        self.tunnels = _TunnelClient(self)
        self.inspect = _InspectClient(self)
        self.api_keys = _ApiKeyClient(self)
        self.domains = _DomainClient(self)
        self.projects = _ProjectClient(self)
        self.users = _UserClient(self)

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=self._timeout,
                headers={
                    "X-API-Key": self._authtoken,
                    "Content-Type": "application/json",
                    "User-Agent": "deployzy-sdk-python/1.1.0",
                },
            )
        return self._session

    async def _request(
        self, method: str, path: str, json: object = None
    ) -> dict:
        session = await self._get_session()
        url = f"{self._base_url}{path}"

        async with session.request(method, url, json=json) as resp:
            data = await resp.json()

            if resp.status == 401:
                raise AuthError(data.get("error", "Unauthorized"))
            if resp.status == 404:
                raise NotFoundError(data.get("error", "Not found"))
            if resp.status == 429:
                retry = int(resp.headers.get("Retry-After", "1"))
                raise RateLimitError(retry)
            if resp.status >= 400:
                raise ApiError(resp.status, data.get("error", "Request failed"))

            return data

    async def close(self) -> None:
        """Close the HTTP session."""
        if self._session and not self._session.closed:
            await self._session.close()

    async def __aenter__(self) -> "Deployzy":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()


class _TunnelClient:
    def __init__(self, client: Deployzy):
        self._client = client

    async def list(self) -> list[Tunnel]:
        """List all active tunnels."""
        data = await self._client._request("GET", "/api/v1/tunnels")
        return [
            Tunnel(
                url=t["url"],
                protocol=t["protocol"],
                name=t.get("name", ""),
                client_id=t.get("client_id", ""),
            )
            for t in data
        ]


class _InspectClient:
    def __init__(self, client: Deployzy):
        self._client = client

    async def list(self, tunnel_url: str) -> list[CapturedRequest]:
        """List captured requests for a tunnel."""
        path = f"/api/v1/tunnels/{quote(tunnel_url, safe='')}/requests"
        data = await self._client._request("GET", path)
        return [_parse_captured_request(r) for r in data]

    async def get(self, tunnel_url: str, request_id: str) -> CapturedRequest:
        """Get a single captured request."""
        path = f"/api/v1/tunnels/{quote(tunnel_url, safe='')}/requests/{request_id}"
        data = await self._client._request("GET", path)
        return _parse_captured_request(data)

    async def replay(self, tunnel_url: str, request_id: str) -> ReplayResult:
        """Replay a captured request."""
        path = f"/api/v1/tunnels/{quote(tunnel_url, safe='')}/replay/{request_id}"
        data = await self._client._request("POST", path)
        return ReplayResult(
            status_code=data.get("status_code", 0),
            response_headers=data.get("response_headers", {}),
            duration_ms=data.get("duration_ms", 0),
            error=data.get("error"),
        )

    async def subscribe(self, tunnel_url: str) -> AsyncIterator[CapturedRequest]:
        """
        Subscribe to live traffic via WebSocket.

        Example::

            async for req in client.inspect.subscribe(tunnel_url):
                print(f"{req.method} {req.path} -> {req.status_code}")
        """
        ws_base = self._client._base_url.replace("http", "ws", 1)
        url = f"{ws_base}/api/v1/ws/traffic/{quote(tunnel_url, safe='')}"

        session = await self._client._get_session()
        async with session.ws_connect(url) as ws:
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    import json

                    data = json.loads(msg.data)
                    yield _parse_captured_request(data)
                elif msg.type in (
                    aiohttp.WSMsgType.CLOSED,
                    aiohttp.WSMsgType.ERROR,
                ):
                    break


class _ApiKeyClient:
    def __init__(self, client: Deployzy):
        self._client = client

    async def list(self) -> list[ApiKey]:
        """List all API keys."""
        data = await self._client._request("GET", "/api/v1/api-keys")
        return [
            ApiKey(
                id=k["id"],
                user_id=k["user_id"],
                name=k["name"],
                prefix=k["prefix"],
                last_used_at=k.get("last_used_at"),
                created_at=k["created_at"],
            )
            for k in data
        ]

    async def create(self, name: str = "default") -> tuple[str, ApiKey]:
        """Create a new API key. Returns (full_token, key_info)."""
        data = await self._client._request("POST", "/api/v1/api-keys", {"name": name})
        info = data.get("info", {})
        return data["api_key"], ApiKey(
            id=info.get("id", ""),
            user_id=info.get("user_id", ""),
            name=info.get("name", name),
            prefix=info.get("prefix", ""),
            last_used_at=info.get("last_used_at"),
            created_at=info.get("created_at", ""),
        )

    async def delete(self, key_id: str) -> None:
        """Delete an API key."""
        await self._client._request("DELETE", f"/api/v1/api-keys/{key_id}")


class _DomainClient:
    def __init__(self, client: Deployzy):
        self._client = client

    async def list(self) -> list[Domain]:
        """List all custom domains."""
        data = await self._client._request("GET", "/api/v1/domains")
        return [
            Domain(
                id=d["id"],
                domain=d["domain"],
                verified=d["verified"],
                cname_target=d["cname_target"],
                created_at=d["created_at"],
            )
            for d in data
        ]

    async def create(self, domain: str) -> tuple[Domain, dict]:
        """Register a custom domain. Returns (domain, dns_instructions)."""
        data = await self._client._request("POST", "/api/v1/domains", {"domain": domain})
        d = data["domain"]
        return (
            Domain(
                id=d["id"],
                domain=d["domain"],
                verified=d["verified"],
                cname_target=d["cname_target"],
                created_at=d["created_at"],
            ),
            data.get("instructions", {}),
        )

    async def verify(self, domain_id: str) -> dict:
        """Verify a domain's DNS configuration."""
        return await self._client._request("POST", f"/api/v1/domains/{domain_id}/verify")

    async def delete(self, domain_id: str) -> None:
        """Delete a custom domain."""
        await self._client._request("DELETE", f"/api/v1/domains/{domain_id}")


class _ProjectClient:
    def __init__(self, client: Deployzy):
        self._client = client

    async def list(self) -> list[Project]:
        """List all projects."""
        data = await self._client._request("GET", "/api/v1/projects")
        return [_parse_project(p) for p in data]

    async def get(self, project_id: str) -> Project:
        """Get a single project by id."""
        data = await self._client._request("GET", f"/api/v1/projects/{project_id}")
        return _parse_project(data["project"])

    async def create(
        self,
        name: str,
        *,
        subdomain: Optional[str] = None,
        framework: Optional[str] = None,
        repo: Optional[str] = None,
        branch: str = "main",
        image: Optional[str] = None,
        env: Optional[dict[str, str]] = None,
        build: Optional[dict] = None,
    ) -> Project:
        """
        Create a project. Provide ``repo`` (git) OR ``image`` (prebuilt). Applies
        env/build settings if given. Does NOT deploy — call ``deploy(id)`` after.
        """
        body: dict = {"name": name, "subdomain": subdomain or name}
        if framework:
            body["framework"] = framework
        if image:
            body["image"] = image
            body["deploy_source"] = "image"
        elif repo:
            if repo.startswith("http://") or repo.startswith("https://"):
                body["repo_url"] = repo
            else:
                body["repo_url"] = f"https://github.com/{repo}.git"
                body["github_repo"] = repo
            body["branch"] = branch

        data = await self._client._request("POST", "/api/v1/projects", body)
        project = _parse_project(data)
        if env:
            await self.set_env(project.id, env)
        if build:
            await self.update_build_config(project.id, build)
        return project

    async def deploy(self, project_id: str) -> None:
        """Trigger a deploy (build + release)."""
        await self._client._request("POST", f"/api/v1/projects/{project_id}/deploy")

    async def stop(self, project_id: str) -> None:
        """Stop a project's container."""
        await self._client._request("POST", f"/api/v1/projects/{project_id}/stop")

    async def delete(self, project_id: str) -> None:
        """Delete a project."""
        await self._client._request("DELETE", f"/api/v1/projects/{project_id}")

    async def set_env(self, project_id: str, env: dict[str, str]) -> None:
        """Replace the project's environment variables."""
        await self._client._request(
            "PUT", f"/api/v1/projects/{project_id}", {"env_vars": env}
        )

    async def update_build_config(self, project_id: str, cfg: dict) -> None:
        """Update advanced build/runtime settings."""
        await self._client._request(
            "PUT", f"/api/v1/projects/{project_id}/build-config", cfg
        )

    async def logs(self, project_id: str) -> list[DeployLog]:
        """Fetch recent deploy log lines."""
        data = await self._client._request("GET", f"/api/v1/projects/{project_id}/logs")
        return [
            DeployLog(
                message=l.get("message", ""),
                level=l.get("level", ""),
                created_at=l.get("created_at", ""),
            )
            for l in data
        ]

    async def wait_for_deploy(
        self, project_id: str, *, interval: float = 3.0, timeout: float = 600.0
    ) -> Project:
        """Poll until the project status is 'running' or 'failed' (or timeout)."""
        start = time.monotonic()
        while True:
            project = await self.get(project_id)
            if project.status in ("running", "failed"):
                return project
            if time.monotonic() - start > timeout:
                raise DeployzyError(
                    f"wait_for_deploy timed out after {timeout}s "
                    f"(last status: {project.status})"
                )
            await asyncio.sleep(interval)


class _UserClient:
    def __init__(self, client: Deployzy):
        self._client = client

    async def me(self) -> User:
        """Get the current user."""
        data = await self._client._request("GET", "/api/v1/users/me")
        return User(
            id=data["id"],
            email=data["email"],
            name=data["name"],
            plan=data["plan"],
            created_at=data["created_at"],
        )


def _parse_project(data: dict) -> Project:
    return Project(
        id=data.get("id", ""),
        name=data.get("name", ""),
        subdomain=data.get("subdomain", ""),
        framework=data.get("framework", ""),
        status=data.get("status", ""),
        repo_url=data.get("repo_url", ""),
        branch=data.get("branch", ""),
        github_repo=data.get("github_repo", ""),
        deploy_source=data.get("deploy_source", "git"),
        image_ref=data.get("image_ref", ""),
        root_dir=data.get("root_dir", "") or "",
        env_vars=data.get("env_vars") or {},
        last_deploy_at=data.get("last_deploy_at"),
        created_at=data.get("created_at", ""),
    )


def _parse_captured_request(data: dict) -> CapturedRequest:
    return CapturedRequest(
        id=data.get("id", ""),
        tunnel_url=data.get("tunnel_url", ""),
        timestamp=data.get("timestamp", ""),
        duration_ms=data.get("duration_ms", 0),
        method=data.get("method", ""),
        path=data.get("path", ""),
        query=data.get("query", ""),
        status_code=data.get("status_code", 0),
        request_headers=data.get("request_headers", {}),
        response_headers=data.get("response_headers", {}),
        request_size=data.get("request_size", 0),
        response_size=data.get("response_size", 0),
        remote_addr=data.get("remote_addr", ""),
    )
