import type {
  DeployzyOptions,
  TunnelOptions,
  Tunnel,
  CapturedRequest,
  ReplayResult,
  User,
  ApiKey,
  Domain,
  Project,
  CreateProjectOptions,
  BuildConfigInput,
  DeployLog,
  WaitForDeployOptions,
} from "./types";
import { DeployzyError, ApiError, AuthError, RateLimitError, NotFoundError } from "./errors";

const DEFAULT_SERVER_URL = "https://api.deployzy.com";
const DEFAULT_TIMEOUT = 30_000;

/**
 * Deployzy SDK client.
 *
 * @example
 * ```typescript
 * import { Deployzy } from '@serverme/sdk';
 *
 * const client = new Deployzy({ authtoken: 'sm_live_...' });
 *
 * // List active tunnels
 * const tunnels = await client.tunnels.list();
 *
 * // Get captured requests
 * const requests = await client.inspect.list(tunnels[0].url);
 *
 * // Replay a request
 * const result = await client.inspect.replay(tunnels[0].url, requests[0].id);
 * ```
 */
export class Deployzy {
  private baseUrl: string;
  private authtoken: string;
  private timeout: number;

  /** Tunnel management. */
  public readonly tunnels: TunnelClient;
  /** Request inspection. */
  public readonly inspect: InspectClient;
  /** API key management. */
  public readonly apiKeys: ApiKeyClient;
  /** Custom domain management. */
  public readonly domains: DomainClient;
  /** Project deployment. */
  public readonly projects: ProjectClient;
  /** User/account operations. */
  public readonly users: UserClient;

  constructor(options: DeployzyOptions) {
    if (!options.authtoken) {
      throw new AuthError("authtoken is required");
    }

    this.baseUrl = (options.serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, "");
    this.authtoken = options.authtoken;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;

    const request = this.request.bind(this);
    this.tunnels = new TunnelClient(request);
    this.inspect = new InspectClient(request);
    this.apiKeys = new ApiKeyClient(request);
    this.domains = new DomainClient(request);
    this.projects = new ProjectClient(request);
    this.users = new UserClient(request);
  }

  /** Internal HTTP request method. */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      "X-API-Key": this.authtoken,
      "Content-Type": "application/json",
      "User-Agent": "deployzy-sdk-js/1.1.0",
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) throw new AuthError(data.error);
        if (res.status === 404) throw new NotFoundError(data.error);
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get("Retry-After") || "1");
          throw new RateLimitError(retryAfter);
        }
        throw new ApiError(res.status, data.error || "Request failed");
      }

      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

type RequestFn = <T>(method: string, path: string, body?: unknown) => Promise<T>;

// --- Sub-clients ---

class TunnelClient {
  constructor(private request: RequestFn) {}

  /** List all active tunnels. */
  async list(): Promise<Tunnel[]> {
    return this.request("GET", "/api/v1/tunnels");
  }
}

class InspectClient {
  constructor(private request: RequestFn) {}

  /** List captured requests for a tunnel. */
  async list(tunnelUrl: string): Promise<CapturedRequest[]> {
    return this.request(
      "GET",
      `/api/v1/tunnels/${encodeURIComponent(tunnelUrl)}/requests`
    );
  }

  /** Get a single captured request. */
  async get(tunnelUrl: string, requestId: string): Promise<CapturedRequest> {
    return this.request(
      "GET",
      `/api/v1/tunnels/${encodeURIComponent(tunnelUrl)}/requests/${requestId}`
    );
  }

  /** Replay a captured request through the tunnel. */
  async replay(tunnelUrl: string, requestId: string): Promise<ReplayResult> {
    return this.request(
      "POST",
      `/api/v1/tunnels/${encodeURIComponent(tunnelUrl)}/replay/${requestId}`
    );
  }

  /**
   * Subscribe to live traffic on a tunnel via WebSocket.
   * Returns an async iterator of captured requests.
   *
   * @example
   * ```typescript
   * for await (const req of client.inspect.subscribe(tunnelUrl)) {
   *   console.log(`${req.method} ${req.path} -> ${req.statusCode}`);
   * }
   * ```
   */
  subscribe(
    tunnelUrl: string,
    wsUrl?: string
  ): AsyncIterable<CapturedRequest> & { close: () => void } {
    const base = wsUrl || "wss://api.deployzy.com";
    const url = `${base}/api/v1/ws/traffic/${encodeURIComponent(tunnelUrl)}`;

    let ws: WebSocket | null = null;
    let resolve: ((value: IteratorResult<CapturedRequest>) => void) | null = null;
    let done = false;
    const queue: CapturedRequest[] = [];

    function connect() {
      ws = new WebSocket(url);
      ws.onmessage = (event) => {
        const req = JSON.parse(event.data) as CapturedRequest;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: req, done: false });
        } else {
          queue.push(req);
        }
      };
      ws.onclose = () => {
        done = true;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: undefined as unknown as CapturedRequest, done: true });
        }
      };
    }

    connect();

    const iterator: AsyncIterableIterator<CapturedRequest> = {
      [Symbol.asyncIterator]() {
        return iterator;
      },
      next(): Promise<IteratorResult<CapturedRequest>> {
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift()!, done: false });
        }
        if (done) {
          return Promise.resolve({
            value: undefined as unknown as CapturedRequest,
            done: true,
          });
        }
        return new Promise((r) => {
          resolve = r;
        });
      },
    };

    return Object.assign(iterator, {
      close: () => {
        done = true;
        ws?.close();
      },
    });
  }
}

class ApiKeyClient {
  constructor(private request: RequestFn) {}

  /** List all API keys. */
  async list(): Promise<ApiKey[]> {
    return this.request("GET", "/api/v1/api-keys");
  }

  /** Create a new API key. Returns the full token (only shown once). */
  async create(name = "default"): Promise<{ apiKey: string; info: ApiKey }> {
    return this.request("POST", "/api/v1/api-keys", { name });
  }

  /** Delete an API key. */
  async delete(id: string): Promise<void> {
    await this.request("DELETE", `/api/v1/api-keys/${id}`);
  }
}

class DomainClient {
  constructor(private request: RequestFn) {}

  /** List all custom domains. */
  async list(): Promise<Domain[]> {
    return this.request("GET", "/api/v1/domains");
  }

  /** Register a custom domain. */
  async create(
    domain: string
  ): Promise<{ domain: Domain; instructions: { type: string; name: string; target: string } }> {
    return this.request("POST", "/api/v1/domains", { domain });
  }

  /** Verify a custom domain's DNS. */
  async verify(id: string): Promise<{ verified: boolean; cname?: string }> {
    return this.request("POST", `/api/v1/domains/${id}/verify`);
  }

  /** Delete a custom domain. */
  async delete(id: string): Promise<void> {
    await this.request("DELETE", `/api/v1/domains/${id}`);
  }
}

class ProjectClient {
  constructor(private request: RequestFn) {}

  /** List all projects. */
  async list(): Promise<Project[]> {
    return this.request("GET", "/api/v1/projects");
  }

  /** Get a single project by id. */
  async get(id: string): Promise<Project> {
    const res = await this.request<{ project: Project }>("GET", `/api/v1/projects/${id}`);
    return res.project;
  }

  /**
   * Create a project. Provide `repo` (git) OR `image` (prebuilt). Applies env
   * and build settings if given. Does NOT deploy — call `deploy(id)` after.
   */
  async create(opts: CreateProjectOptions): Promise<Project> {
    const body: Record<string, unknown> = {
      name: opts.name,
      subdomain: opts.subdomain || opts.name,
    };
    if (opts.framework) body.framework = opts.framework;
    if (opts.image) {
      body.image = opts.image;
      body.deploy_source = "image";
    } else if (opts.repo) {
      if (/^https?:\/\//.test(opts.repo)) {
        body.repo_url = opts.repo;
      } else {
        body.repo_url = `https://github.com/${opts.repo}.git`;
        body.github_repo = opts.repo;
      }
      body.branch = opts.branch || "main";
    }

    const project = await this.request<Project>("POST", "/api/v1/projects", body);
    if (opts.env && Object.keys(opts.env).length > 0) {
      await this.setEnv(project.id, opts.env);
    }
    if (opts.build) {
      await this.updateBuildConfig(project.id, opts.build);
    }
    return project;
  }

  /** Trigger a deploy (build + release). */
  async deploy(id: string): Promise<void> {
    await this.request("POST", `/api/v1/projects/${id}/deploy`);
  }

  /** Stop a project's container. */
  async stop(id: string): Promise<void> {
    await this.request("POST", `/api/v1/projects/${id}/stop`);
  }

  /** Delete a project. */
  async delete(id: string): Promise<void> {
    await this.request("DELETE", `/api/v1/projects/${id}`);
  }

  /** Replace the project's environment variables. */
  async setEnv(id: string, env: Record<string, string>): Promise<void> {
    await this.request("PUT", `/api/v1/projects/${id}`, { env_vars: env });
  }

  /** Update advanced build/runtime settings. */
  async updateBuildConfig(id: string, cfg: BuildConfigInput): Promise<void> {
    await this.request("PUT", `/api/v1/projects/${id}/build-config`, cfg);
  }

  /** Fetch recent deploy log lines. */
  async logs(id: string): Promise<DeployLog[]> {
    return this.request("GET", `/api/v1/projects/${id}/logs`);
  }

  /**
   * Poll until the project reaches a terminal deploy state ("running" or
   * "failed"), or the timeout elapses. Returns the final project.
   */
  async waitForDeploy(id: string, opts: WaitForDeployOptions = {}): Promise<Project> {
    const interval = opts.intervalMs ?? 3000;
    const timeout = opts.timeoutMs ?? 600_000;
    const start = Date.now();
    for (;;) {
      const project = await this.get(id);
      if (project.status === "running" || project.status === "failed") {
        return project;
      }
      if (Date.now() - start > timeout) {
        throw new DeployzyError(
          `waitForDeploy timed out after ${timeout}ms (last status: ${project.status})`
        );
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }
}

class UserClient {
  constructor(private request: RequestFn) {}

  /** Get the current user. */
  async me(): Promise<User> {
    return this.request("GET", "/api/v1/users/me");
  }
}
