const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

class ApiClient {
  private token: string | null = null;

  /** Returns team_id query param if a team is selected */
  private teamQ(prefix = "?"): string {
    if (typeof window === "undefined") return "";
    const teamId = localStorage.getItem("sm_team_id");
    return teamId ? `${prefix}team_id=${teamId}` : "";
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      if (typeof window !== "undefined") localStorage.setItem("sm_token", token);
    } else {
      if (typeof window !== "undefined") localStorage.removeItem("sm_token");
    }
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== "undefined") {
      this.token = localStorage.getItem("sm_token");
    }
    return this.token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    const token = this.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // Auth
  async register(email: string, name: string, password: string) {
    const data = await this.request<{
      user: User;
      token: string;
      api_key: string;
    }>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, name, password }),
    });
    this.setToken(data.token);
    return data;
  }

  async login(email: string, password: string) {
    const data = await this.request<{ user: User; token: string }>(
      "/api/v1/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }
    );
    this.setToken(data.token);
    return data;
  }

  logout() {
    this.setToken(null);
  }

  // User
  getMe() {
    return this.request<User>("/api/v1/users/me");
  }

  // API Keys
  listApiKeys() {
    return this.request<ApiKey[]>("/api/v1/api-keys");
  }

  createApiKey(name: string) {
    return this.request<{ api_key: string; info: ApiKey }>("/api/v1/api-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  deleteApiKey(id: string) {
    return this.request("/api/v1/api-keys/" + id, { method: "DELETE" });
  }

  // Domains
  listDomains() {
    return this.request<Domain[]>("/api/v1/domains");
  }

  createDomain(domain: string) {
    return this.request<{ domain: Domain; instructions: DnsInstructions }>(
      "/api/v1/domains",
      { method: "POST", body: JSON.stringify({ domain }) }
    );
  }

  deleteDomain(id: string) {
    return this.request("/api/v1/domains/" + id, { method: "DELETE" });
  }

  verifyDomain(id: string) {
    return this.request<{ verified: boolean; cname?: string }>(
      `/api/v1/domains/${id}/verify`,
      { method: "POST" }
    );
  }

  // Project Databases
  getProjectDatabase(projectId: string) {
    return this.request<{ database: ProjectDatabase | null; connection_url?: string }>(`/api/v1/projects/${projectId}/database`);
  }

  createProjectDatabase(projectId: string) {
    return this.request<{ database: ProjectDatabase; connection_url: string }>(`/api/v1/projects/${projectId}/database`, { method: "POST" });
  }

  deleteProjectDatabase(projectId: string) {
    return this.request(`/api/v1/projects/${projectId}/database`, { method: "DELETE" });
  }

  bindDomain(id: string, targetType: string, targetSubdomain: string) {
    return this.request<{ status: string }>(
      `/api/v1/domains/${id}/bind`,
      { method: "PUT", body: JSON.stringify({ target_type: targetType, target_subdomain: targetSubdomain }) }
    );
  }

  // Tunnels
  listTunnels() {
    return this.request<Tunnel[]>("/api/v1/tunnels" + this.teamQ());
  }

  // Inspection
  listRequests(tunnelUrl: string) {
    return this.request<CapturedRequest[]>(
      `/api/v1/tunnels/${encodeURIComponent(tunnelUrl)}/requests`
    );
  }
}

// Types
export interface User {
  id: string;
  email: string;
  name: string;
  plan: string;
  created_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
}

export interface Domain {
  id: string;
  domain: string;
  verified: boolean;
  cname_target: string;
  target_type: string;
  target_subdomain: string;
  created_at: string;
}

export interface ProjectDatabase {
  id: string;
  project_id: string;
  db_name: string;
  db_user: string;
  db_password: string;
  host: string;
  port: number;
  created_at: string;
}

export interface DnsInstructions {
  type: string;
  name: string;
  target: string;
  note: string;
}

export interface Tunnel {
  url: string;
  protocol: string;
  name: string;
  client_id: string;
}

export interface CapturedRequest {
  id: string;
  tunnel_url: string;
  timestamp: string;
  duration_ms: number;
  method: string;
  path: string;
  query: string;
  status_code: number;
  request_headers: Record<string, string>;
  response_headers: Record<string, string>;
  request_size: number;
  response_size: number;
  remote_addr: string;
}

export const api = new ApiClient();
