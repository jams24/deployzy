/** Options for creating a Deployzy client. */
export interface DeployzyOptions {
  /** API key (format: sm_live_...) */
  authtoken: string;
  /** Server API base URL. Defaults to https://api.deployzy.com */
  serverUrl?: string;
  /** Request timeout in ms. Defaults to 30000. */
  timeout?: number;
}

/** Options for creating a tunnel. */
export interface TunnelOptions {
  /** Tunnel protocol */
  proto: "http" | "tcp" | "tls";
  /** Local port or address to forward to */
  addr: number | string;
  /** Request a custom subdomain (HTTP/TLS only) */
  subdomain?: string;
  /** Use a custom domain (HTTP/TLS only) */
  domain?: string;
  /** Remote port (TCP only) */
  remotePort?: number;
  /** Tunnel name/label */
  name?: string;
  /** Enable request inspection. Defaults to true for HTTP. */
  inspect?: boolean;
  /** HTTP basic auth (format: "user:pass") */
  auth?: string;
}

/** An active tunnel. */
export interface Tunnel {
  /** Public URL (e.g., https://abc123.deployzy.com) */
  url: string;
  /** Protocol type */
  protocol: string;
  /** Tunnel name */
  name: string;
  /** Client ID */
  clientId: string;
}

/** A captured HTTP request. */
export interface CapturedRequest {
  id: string;
  tunnelUrl: string;
  timestamp: string;
  durationMs: number;
  method: string;
  path: string;
  query: string;
  statusCode: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: Uint8Array;
  responseBody?: Uint8Array;
  requestSize: number;
  responseSize: number;
  remoteAddr: string;
}

/** User account. */
export interface User {
  id: string;
  email: string;
  name: string;
  plan: string;
  createdAt: string;
}

/** API key metadata. */
export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Custom domain. */
export interface Domain {
  id: string;
  domain: string;
  verified: boolean;
  cnameTarget: string;
  createdAt: string;
}

/** One extra service of a multi-service project. */
export interface ProjectService {
  name: string;
  root_dir: string;
  port: number;
  framework: string;
  install_cmd: string;
  build_cmd: string;
  start_cmd: string;
  env_overrides?: Record<string, string>;
}

/**
 * A deployed project. Field names match the API's JSON (snake_case) since the
 * SDK passes responses through untransformed.
 */
export interface Project {
  id: string;
  name: string;
  subdomain: string;
  framework: string;
  status: string;
  repo_url: string;
  branch: string;
  github_repo: string;
  deploy_source: string;
  image_ref: string;
  root_dir?: string;
  env_vars: Record<string, string>;
  services?: ProjectService[];
  last_deploy_at: string | null;
  created_at: string;
}

/** Advanced build/runtime settings (all optional). */
export interface BuildConfigInput {
  install_cmd?: string;
  build_cmd?: string;
  start_cmd?: string;
  root_dir?: string;
  node_version?: string;
  port_override?: number;
  memory_mb?: number;
  cpus?: number;
  health_check_path?: string;
  release_cmd?: string;
  dockerfile_path?: string;
}

/** Options for creating a project. Provide `repo` OR `image`. */
export interface CreateProjectOptions {
  name: string;
  /** Public subdomain. Defaults to `name`. */
  subdomain?: string;
  framework?: string;
  /** Git source: "owner/repo" or a full https git URL. */
  repo?: string;
  /** Branch for `repo`. Defaults to "main". */
  branch?: string;
  /** Prebuilt image to run instead of building (e.g. "nginx:alpine"). */
  image?: string;
  /** Environment variables applied before the first deploy. */
  env?: Record<string, string>;
  /** Advanced build settings. */
  build?: BuildConfigInput;
}

/** A deploy log line. */
export interface DeployLog {
  message: string;
  level: string;
  created_at: string;
}

/** Options for waitForDeploy. */
export interface WaitForDeployOptions {
  /** Poll interval in ms. Default 3000. */
  intervalMs?: number;
  /** Max time to wait in ms. Default 600000 (10 min). */
  timeoutMs?: number;
}

/** Result of replaying a captured request. */
export interface ReplayResult {
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody?: Uint8Array;
  durationMs: number;
  error?: string;
}
