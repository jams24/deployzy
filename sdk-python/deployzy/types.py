"""Type definitions for Deployzy SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class TunnelOptions:
    """Options for creating a tunnel."""

    proto: str  # "http", "tcp", "tls"
    addr: int | str  # local port or address
    subdomain: Optional[str] = None
    domain: Optional[str] = None
    remote_port: Optional[int] = None
    name: Optional[str] = None
    inspect: bool = True
    auth: Optional[str] = None


@dataclass
class Tunnel:
    """An active tunnel."""

    url: str
    protocol: str
    name: str
    client_id: str


@dataclass
class CapturedRequest:
    """A captured HTTP request/response pair."""

    id: str
    tunnel_url: str
    timestamp: str
    duration_ms: float
    method: str
    path: str
    query: str
    status_code: int
    request_headers: dict[str, str] = field(default_factory=dict)
    response_headers: dict[str, str] = field(default_factory=dict)
    request_size: int = 0
    response_size: int = 0
    remote_addr: str = ""


@dataclass
class ReplayResult:
    """Result of replaying a captured request."""

    status_code: int
    response_headers: dict[str, str] = field(default_factory=dict)
    duration_ms: float = 0
    error: Optional[str] = None


@dataclass
class User:
    """User account."""

    id: str
    email: str
    name: str
    plan: str
    created_at: str


@dataclass
class ApiKey:
    """API key metadata."""

    id: str
    user_id: str
    name: str
    prefix: str
    last_used_at: Optional[str]
    created_at: str


@dataclass
class Domain:
    """Custom domain."""

    id: str
    domain: str
    verified: bool
    cname_target: str
    created_at: str


@dataclass
class Project:
    """A deployed project."""

    id: str
    name: str
    subdomain: str
    framework: str
    status: str
    repo_url: str = ""
    branch: str = ""
    github_repo: str = ""
    deploy_source: str = "git"
    image_ref: str = ""
    root_dir: str = ""
    env_vars: dict[str, str] = field(default_factory=dict)
    last_deploy_at: Optional[str] = None
    created_at: str = ""


@dataclass
class DeployLog:
    """A single deploy log line."""

    message: str
    level: str
    created_at: str
