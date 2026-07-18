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
  async register(email: string, name: string, password: string, ref?: string) {
    const data = await this.request<{
      user: User;
      token: string;
      api_key: string;
    }>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, name, password, ref: ref || undefined }),
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

  createApiKey(name: string, scope: string = "full") {
    return this.request<{ api_key: string; info: ApiKey }>("/api/v1/api-keys", {
      method: "POST",
      body: JSON.stringify({ name, scope }),
    });
  }

  deleteApiKey(id: string) {
    return this.request("/api/v1/api-keys/" + id, { method: "DELETE" });
  }

  // Referrals
  getReferrals() {
    return this.request<ReferralStats>("/api/v1/referrals");
  }

  // Webhooks
  listWebhooks() {
    return this.request<Webhook[]>("/api/v1/webhooks");
  }
  createWebhook(url: string) {
    return this.request<Webhook>("/api/v1/webhooks", { method: "POST", body: JSON.stringify({ url }) });
  }
  updateWebhook(id: string, enabled: boolean) {
    return this.request("/api/v1/webhooks/" + id, { method: "PUT", body: JSON.stringify({ enabled }) });
  }
  deleteWebhook(id: string) {
    return this.request("/api/v1/webhooks/" + id, { method: "DELETE" });
  }
  testWebhook(id: string) {
    return this.request<{ delivered: boolean; status: number }>("/api/v1/webhooks/" + id + "/test", { method: "POST" });
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

  // Database Backups
  createBackup(projectId: string) {
    return this.request<DatabaseBackup>(`/api/v1/projects/${projectId}/backups`, { method: "POST" });
  }

  listBackups(projectId: string) {
    return this.request<DatabaseBackup[]>(`/api/v1/projects/${projectId}/backups`);
  }

  deleteBackup(projectId: string, backupId: string) {
    return this.request(`/api/v1/projects/${projectId}/backups/${backupId}`, { method: "DELETE" });
  }

  restoreBackup(projectId: string, backupId: string) {
    return this.request(`/api/v1/projects/${projectId}/backups/${backupId}/restore`, { method: "POST" });
  }

  getBackupSchedule(projectId: string) {
    return this.request<BackupSchedule>(`/api/v1/projects/${projectId}/backup-schedule`);
  }

  updateBackupSchedule(projectId: string, schedule: BackupSchedule) {
    return this.request(`/api/v1/projects/${projectId}/backup-schedule`, {
      method: "PUT", body: JSON.stringify(schedule),
    });
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

  // Templates
  listTemplates(params: { category?: string; search?: string; sort?: string; limit?: number; offset?: number } = {}) {
    const q = new URLSearchParams();
    if (params.category) q.set("category", params.category);
    if (params.search) q.set("search", params.search);
    if (params.sort) q.set("sort", params.sort);
    if (params.limit) q.set("limit", String(params.limit));
    if (params.offset) q.set("offset", String(params.offset));
    const qs = q.toString() ? "?" + q.toString() : "";
    return this.request<{ templates: Template[]; total: number; limit: number; offset: number }>(`/api/v1/templates${qs}`);
  }

  listTemplateCategories() {
    return this.request<{ category: string; count: number }[]>("/api/v1/templates/categories");
  }

  getTemplate(slug: string) {
    return this.request<Template>(`/api/v1/templates/${slug}`);
  }

  toggleTemplateStar(slug: string) {
    return this.request<{ starred: boolean; star_count: number }>(`/api/v1/templates/${slug}/star`, { method: "POST" });
  }

  // Admin — templates
  adminListTemplates() {
    return this.request<Template[]>("/api/v1/admin/templates");
  }
  adminCreateTemplate(payload: Partial<Template>) {
    return this.request<Template>("/api/v1/admin/templates", { method: "POST", body: JSON.stringify(payload) });
  }
  adminUpdateTemplate(id: string, payload: Partial<Template>) {
    return this.request<Template>(`/api/v1/admin/templates/${id}`, { method: "PUT", body: JSON.stringify(payload) });
  }
  adminDeleteTemplate(id: string) {
    return this.request<{ status: string }>(`/api/v1/admin/templates/${id}`, { method: "DELETE" });
  }

  deployFromTemplate(slug: string, payload: { name: string; subdomain?: string; env_vars: Record<string, string>; worker_server_id?: string }) {
    return this.request<{ project: Record<string, unknown>; post_deploy: string }>(
      `/api/v1/templates/${slug}/deploy`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }

  listUserServers() {
    return this.request<WorkerServer[]>(`/api/v1/servers${this.teamQ()}`);
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
  scope: string; // "read" | "deploy" | "full"
  last_used_at: string | null;
  created_at: string;
}

export interface ReferredUser {
  name: string;
  email: string;
  plan: string;
  paid: boolean;
  joined_at: string;
}
export interface ReferralStats {
  code: string;
  link: string;
  total: number;
  paid: number;
  pro_months: number;
  pro_until: string | null;
  milestone: number;
  people: ReferredUser[];
}

export interface Webhook {
  id: string;
  url: string;
  secret: string;
  enabled: boolean;
  last_status: number | null;
  last_delivery_at: string | null;
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

export interface DatabaseBackup {
  id: string;
  project_id: string;
  file_name: string;
  file_size: number;
  status: string;
  created_at: string;
}

export interface BackupSchedule {
  enabled: boolean;
  schedule: string;
  time: string;
  retention: number;
  last_backup_at: string | null;
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

export interface EnvVarSchema {
  key: string;
  label: string;
  description: string;
  required: boolean;
  type: "text" | "secret" | "select" | "auto";
  options?: string[];
  default: string;
  placeholder: string;
}

export interface Template {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  tags: string[];
  icon: string;
  color: string;
  source_repo?: string;
  docker_image?: string;
  env_vars: EnvVarSchema[];
  ports: number[];
  min_memory_mb: number;
  post_deploy: string;
  is_official: boolean;
  is_featured: boolean;
  is_active: boolean;
  deploy_count: number;
  star_count: number;
  is_starred: boolean;
  created_at: string;
}

export interface WorkerServer {
  id: string;
  label: string;
  host: string;
  region: string;
  status: string;
  total_memory_mb: number;
  current_projects: number;
  max_projects: number;
  docker_installed: boolean;
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
