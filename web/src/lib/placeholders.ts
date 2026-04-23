export interface BuildPlaceholders {
  install: string;
  build: string;
  start: string;
  port: string;
  release: string;
  healthCheck: string;
  env: string;
}

export function getBuildPlaceholders(framework: string): BuildPlaceholders {
  switch (framework) {
    case "nextjs":
      return {
        install: "npm ci",
        build: "npm run build",
        start: "node server.js",
        port: "3000",
        release: "npx prisma migrate deploy",
        healthCheck: "/api/health",
        env: "DATABASE_URL=postgresql://...\nNEXTAUTH_SECRET=...\nNEXT_PUBLIC_API_URL=https://api.example.com",
      };

    case "python":
      return {
        install: "pip install --no-cache-dir -r requirements.txt",
        build: "(not used for Python)",
        start: "uvicorn app:app --host 0.0.0.0 --port 3000",
        port: "3000",
        release: "python manage.py migrate",
        healthCheck: "/api/health",
        env: "DATABASE_URL=postgresql://...\nSECRET_KEY=...\nDEBUG=False",
      };

    case "static":
      return {
        install: "(not used for static)",
        build: "(not used for static)",
        start: "(nginx serves files automatically)",
        port: "80",
        release: "(not used)",
        healthCheck: "/",
        env: "(env vars aren't injected into static sites)",
      };

    case "node":
    default:
      return {
        install: "npm ci",
        build: "npm run build",
        start: "npm start",
        port: "3000",
        release: "npx prisma migrate deploy",
        healthCheck: "/health",
        env: "DATABASE_URL=postgresql://...\nAPI_KEY=sk_live_...\nNODE_ENV=production",
      };
  }
}
