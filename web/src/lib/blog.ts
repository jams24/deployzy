export type Section =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; lang: string; text: string }
  | { type: "callout"; text: string }
  | { type: "cta"; heading: string; text: string; href: string; label: string };

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  date: string;         // ISO "2025-06-15"
  author: string;
  readTime: string;
  category: string;
  tags: string[];
  sections: Section[];
}

export const posts: BlogPost[] = [
  {
    slug: "railway-alternatives-2025",
    title: "5 Best Railway Alternatives in 2025 (Self-Hosted & Free)",
    description:
      "Railway changed its pricing and free tier in 2025. Here are the best Railway alternatives — self-hosted, open-source, and free options for deploying your apps.",
    excerpt:
      "Railway changed its pricing model and cut the free tier. Here are 5 solid alternatives — including one you can self-host on your own VPS for free.",
    date: "2025-06-15",
    author: "Deployzy Team",
    readTime: "7 min read",
    category: "Comparisons",
    tags: ["railway alternative", "heroku alternative", "self-hosted deployment", "PaaS"],
    sections: [
      {
        type: "p",
        text: "Railway has become a go-to deployment platform for solo developers and small teams. Its magic was simplicity: connect a GitHub repo, click deploy, and your app is live. But after Railway revised its pricing — removing the generous free tier and pushing hobby developers toward paid plans — many developers are actively looking for alternatives.",
      },
      {
        type: "p",
        text: "In this post we compare the five best Railway alternatives in 2025, covering self-hosted options, managed PaaS platforms, and open-source tools you can run on your own server.",
      },
      { type: "h2", text: "1. Deployzy (Self-Hosted, Free)" },
      {
        type: "p",
        text: "Deployzy is an open-source deployment platform you install on any Linux VPS. It gives you the Railway experience — GitHub auto-deploy, managed databases, localhost tunneling, environment variables, live logs — but on infrastructure you own and control.",
      },
      {
        type: "ul",
        items: [
          "Deploy from GitHub with auto-deploys on push",
          "Managed PostgreSQL, Redis, MongoDB, MySQL — all one-click",
          "Built-in localhost tunnel (like ngrok, no extra subscription)",
          "Bring Your Own Cloud (BYOC): deploy projects onto any VPS",
          "Free to self-host; no per-seat pricing",
        ],
      },
      {
        type: "p",
        text: "The main trade-off: you manage the VPS. A $6/month Hetzner or DigitalOcean droplet is plenty for most hobby projects. The upside is that you pay a flat VPS fee instead of per-resource Railway pricing that can spike unexpectedly.",
      },
      {
        type: "cta",
        heading: "Try Deployzy free",
        text: "Deploy your first app in under 5 minutes — no credit card, no per-minute billing.",
        href: "/sign-up",
        label: "Get started for free",
      },
      { type: "h2", text: "2. Render" },
      {
        type: "p",
        text: "Render is probably the closest managed alternative to Railway. It offers a free tier for web services (with spin-down on inactivity), managed PostgreSQL, Redis, and cron jobs. The developer experience is excellent and deployment from GitHub is seamless.",
      },
      {
        type: "ul",
        items: [
          "Free tier for static sites and web services (spin-down after 15 min idle)",
          "Managed PostgreSQL (free 90-day databases on Hobby plan)",
          "Preview environments per pull request",
          "No free persistent disks",
        ],
      },
      {
        type: "p",
        text: "Render is ideal if you want a managed platform and don't mind the cold-start latency on the free tier. Pricing scales per service, which can add up fast for multi-service apps.",
      },
      { type: "h2", text: "3. Fly.io" },
      {
        type: "p",
        text: "Fly.io runs your apps in Docker containers close to your users across their global network of data centres. It's particularly good for low-latency APIs and apps that benefit from edge deployment. The free tier includes 3 small VMs and 3 GB persistent storage.",
      },
      {
        type: "ul",
        items: [
          "Global edge deployment (30+ regions)",
          "Built-in Postgres (Fly Postgres) and Redis (Upstash)",
          "Generous free tier — 3 shared VMs free",
          "Steeper learning curve; flyctl CLI-first workflow",
        ],
      },
      { type: "h2", text: "4. Coolify (Self-Hosted)" },
      {
        type: "p",
        text: 'Coolify is an open-source "super PaaS" that you self-host. Like Deployzy, you run it on your own VPS. Coolify has a large feature set covering one-click Docker Compose services, Traefik-based routing, Let\'s Encrypt TLS, and team collaboration.',
      },
      {
        type: "ul",
        items: [
          "Open-source and self-hosted",
          "One-click deployment for 80+ services (WordPress, Supabase, etc.)",
          "Requires separate installation; heavier resource footprint",
          "Active community and frequent releases",
        ],
      },
      { type: "h2", text: "5. Heroku (Paid)" },
      {
        type: "p",
        text: "Heroku is the OG PaaS. After killing the free tier in 2022, it moved entirely upmarket. The Eco dynos plan ($5/month) brought back affordable pricing, but Heroku is still significantly pricier than Railway or self-hosted alternatives for equivalent resources.",
      },
      {
        type: "ul",
        items: [
          "Battle-tested, excellent documentation",
          "Eco dynos: $5/month with 1000 dyno-hours shared",
          "Managed Postgres and Redis add-ons",
          "No free tier; ecosystem lock-in",
        ],
      },
      { type: "h2", text: "Which Railway Alternative Should You Choose?" },
      {
        type: "p",
        text: "The right choice depends on your priorities:",
      },
      {
        type: "ul",
        items: [
          "Want free hosting + full control → self-host Deployzy or Coolify on a cheap VPS",
          "Want managed, no-ops → Render or Fly.io (pay as you grow)",
          "Have an established team with budget → Heroku or Railway paid plans",
          "Need global edge performance → Fly.io",
        ],
      },
      {
        type: "p",
        text: "For solo developers and small startups, self-hosting on a $6/month VPS with Deployzy gives you Railway-level developer experience at a fraction of the cost — with no vendor lock-in.",
      },
    ],
  },

  {
    slug: "deploy-nodejs-app-vps-docker",
    title: "How to Deploy a Node.js App to a VPS with Docker (2025 Guide)",
    description:
      "Step-by-step guide to deploying a Node.js app to a VPS using Docker. Covers Dockerfile, environment variables, HTTPS, and zero-downtime redeploys.",
    excerpt:
      "A practical walkthrough: Dockerfile, reverse proxy, SSL, and how to redeploy without downtime. Works with Express, Fastify, NestJS, and Next.js.",
    date: "2025-07-01",
    author: "Deployzy Team",
    readTime: "9 min read",
    category: "Tutorials",
    tags: ["docker", "nodejs", "vps", "deployment", "devops"],
    sections: [
      {
        type: "p",
        text: "Deploying a Node.js app to a VPS is one of the most common tasks in backend development — and one of the most error-prone when done manually. This guide walks you through the complete workflow: Dockerfile, environment variables, reverse proxy, HTTPS, and zero-downtime redeploys.",
      },
      { type: "h2", text: "Prerequisites" },
      {
        type: "ul",
        items: [
          "A Linux VPS (Ubuntu 22.04 recommended) with at least 1 GB RAM",
          "Node.js app with a start script in package.json",
          "Docker installed on the VPS",
          "A domain name pointed at your VPS IP (optional but needed for HTTPS)",
        ],
      },
      { type: "h2", text: "Step 1: Write a Production Dockerfile" },
      {
        type: "p",
        text: "A well-structured Dockerfile is critical for reliable deployments. Here's a production-ready Dockerfile for a Node.js app:",
      },
      {
        type: "code",
        lang: "dockerfile",
        text: `FROM node:20-alpine
WORKDIR /app

# Install dependencies first (layer caching — only re-runs if lockfile changes)
COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Build step (TypeScript, bundlers, etc.)
RUN npm run build 2>/dev/null || true

EXPOSE 3000
CMD ["node", "dist/index.js"]`,
      },
      {
        type: "p",
        text: 'The key trick is copying package.json before the rest of your source code. Docker caches each layer; if your code changes but your dependencies didn\'t, it skips the npm install layer — builds go from 3 minutes to 15 seconds.',
      },
      { type: "h2", text: "Step 2: Build and Run the Container" },
      {
        type: "code",
        lang: "bash",
        text: `# Build the image
docker build -t myapp:latest .

# Run with environment variables
docker run -d \\
  --name myapp \\
  --restart unless-stopped \\
  -p 3000:3000 \\
  -e DATABASE_URL="postgres://..." \\
  -e NODE_ENV=production \\
  myapp:latest`,
      },
      {
        type: "p",
        text: 'The --restart unless-stopped flag means Docker will automatically restart your container if it crashes or if the VPS reboots. This is your basic process supervision without needing systemd or pm2.',
      },
      { type: "h2", text: "Step 3: Set Up a Reverse Proxy with HTTPS" },
      {
        type: "p",
        text: "Running Node.js directly on port 80/443 as root is a security risk. Instead, run Nginx as a reverse proxy on port 443 and forward traffic to your Node.js container on port 3000.",
      },
      {
        type: "code",
        lang: "nginx",
        text: `server {
    listen 443 ssl;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}`,
      },
      {
        type: "p",
        text: "Get a free TLS certificate with Certbot: sudo certbot --nginx -d api.yourdomain.com. Certbot auto-renews every 90 days.",
      },
      { type: "h2", text: "Step 4: Zero-Downtime Redeploys" },
      {
        type: "p",
        text: "The naive approach — docker stop → docker build → docker run — causes downtime. Here's a zero-downtime blue-green pattern:",
      },
      {
        type: "code",
        lang: "bash",
        text: `# Build the new image
docker build -t myapp:next .

# Start the new container on a different port
docker run -d --name myapp-next -p 3001:3000 myapp:next

# Wait for it to be healthy
sleep 5

# Swap Nginx upstream (or update the port mapping)
docker stop myapp && docker rm myapp
docker rename myapp-next myapp

# Update reverse proxy to port 3000 (rename brings it back)
docker stop myapp-next 2>/dev/null || true
docker run -d --name myapp --restart unless-stopped -p 3000:3000 myapp:next`,
      },
      {
        type: "callout",
        text: "Tip: Platforms like Deployzy handle blue-green deploys automatically. When you push to GitHub, it builds a new container, waits for it to pass a health check, then atomically swaps it — no manual steps and no downtime.",
      },
      { type: "h2", text: "Step 5: Environment Variable Management" },
      {
        type: "p",
        text: "Never hard-code secrets in your Docker image. Three options:",
      },
      {
        type: "ol",
        items: [
          "-e KEY=value flags on docker run (fine for simple apps)",
          "--env-file .env flag pointing at a file on the host (keep it outside the repo)",
          "Docker secrets or a secrets manager (Vault, AWS Secrets Manager) for production",
        ],
      },
      { type: "h2", text: "Skip the Manual Setup with Deployzy" },
      {
        type: "p",
        text: "All of the above is automated in Deployzy. Connect your GitHub repo, set your environment variables in the dashboard, and Deployzy handles the Dockerfile generation (or uses yours), builds the image, sets up HTTPS automatically, and does zero-downtime blue-green redeploys on every push to main.",
      },
      {
        type: "cta",
        heading: "Deploy your Node.js app in 5 minutes",
        text: "Connect your GitHub repo and go live — no Nginx config, no Certbot commands.",
        href: "/sign-up",
        label: "Start deploying free",
      },
    ],
  },

  {
    slug: "free-postgresql-hosting-options-2025",
    title: "Best Free PostgreSQL Hosting Options for Developers (2025)",
    description:
      "Compare the best free and cheap managed PostgreSQL hosting options in 2025 — including Neon, Supabase, Render, and self-hosted alternatives.",
    excerpt:
      "Neon, Supabase, Render, and self-hosted — compared on storage limits, connection pooling, sleep behaviour, and hidden costs.",
    date: "2025-06-28",
    author: "Deployzy Team",
    readTime: "6 min read",
    category: "Databases",
    tags: ["postgresql", "free database hosting", "managed postgres", "supabase alternative"],
    sections: [
      {
        type: "p",
        text: "PostgreSQL has become the default database for most web applications. But finding reliable, free (or near-free) hosted PostgreSQL for side projects and early-stage startups is surprisingly difficult — providers either have tight storage limits, connection count restrictions, or they delete inactive databases.",
      },
      {
        type: "p",
        text: "Here's a clear-eyed comparison of the best options in 2025.",
      },
      { type: "h2", text: "1. Neon (Free Tier — Recommended)" },
      {
        type: "p",
        text: "Neon offers serverless PostgreSQL with a genuinely generous free tier. It separates compute and storage, meaning you pay for storage only when you're actually using it, and the compute autoscales to zero when idle.",
      },
      {
        type: "ul",
        items: [
          "Free tier: 0.5 GB storage, 1 project, 10 branches",
          "Autoscales to zero — no idle charges",
          "Connection pooling built-in (PgBouncer)",
          "Point-in-time restore on paid plans",
          "Postgres 15/16 supported",
        ],
      },
      {
        type: "callout",
        text: "Watch out: Neon free tier computes suspend after 5 minutes of inactivity. The first query after suspension adds ~1s cold-start latency. Fine for dev; use a connection pooler or paid plan for production.",
      },
      { type: "h2", text: "2. Supabase (Free Tier)" },
      {
        type: "p",
        text: "Supabase is an open-source Firebase alternative built on top of PostgreSQL. The free tier is generous but pauses projects inactive for 7 days — a critical limitation for side projects you don't touch every week.",
      },
      {
        type: "ul",
        items: [
          "Free tier: 500 MB database, 5 GB bandwidth, 50 MB file storage",
          "Projects pause after 7 days of inactivity (can be disabled on paid)",
          "Includes auth, storage, and real-time out of the box",
          "pgvector support for AI/ML workloads",
          "Dashboard UI, SQL editor, table viewer built-in",
        ],
      },
      { type: "h2", text: "3. Render (Free 90-Day Databases)" },
      {
        type: "p",
        text: "Render's free PostgreSQL databases expire after 90 days — they're meant for development, not production. After 90 days you're moved to a paid plan or the database is deleted.",
      },
      {
        type: "ul",
        items: [
          "Free for 90 days, then $7/month (Starter)",
          "256 MB RAM, 1 GB storage on free tier",
          "No connection pooling on free tier",
          "Good option for short-lived dev environments",
        ],
      },
      { type: "h2", text: "4. Self-Hosted PostgreSQL on a VPS" },
      {
        type: "p",
        text: "Running your own PostgreSQL on a VPS gives you the most control and the best cost-to-storage ratio. A $6/month Hetzner CAX11 (2 vCPU, 4 GB RAM, 40 GB NVMe) can comfortably run PostgreSQL for dozens of small apps.",
      },
      {
        type: "ul",
        items: [
          "Full control over Postgres version, extensions (pgvector, TimescaleDB, etc.)",
          "No connection limits, no sleep-on-idle",
          "Backups are your responsibility",
          "Requires operational knowledge (updates, monitoring, backups)",
        ],
      },
      {
        type: "p",
        text: "Platforms like Deployzy make self-hosted Postgres easier: one-click PostgreSQL provisioning, automatic backups, a built-in database editor (like pgAdmin in the browser), and connection URL injection into your deployed apps.",
      },
      { type: "h2", text: "5. PlanetScale (MySQL, not Postgres)" },
      {
        type: "p",
        text: "PlanetScale is worth mentioning but note it's MySQL, not PostgreSQL. Its branching model is excellent for schema migrations but it removed the free tier in 2024. Starting at $39/month, it's out of range for side projects.",
      },
      { type: "h2", text: "Comparison Table" },
      {
        type: "ul",
        items: [
          "Neon — Free tier: 0.5 GB | Cold starts: yes | Expires: no → Best free option overall",
          "Supabase — Free tier: 500 MB | Cold starts: yes | Expires: 7d inactivity → Best if you need auth/storage too",
          "Render — Free tier: 1 GB | Cold starts: no | Expires: 90 days → Good for short dev cycles",
          "Self-hosted — Free tier: disk size | Cold starts: no | Expires: never → Best value at scale",
        ],
      },
      { type: "h2", text: "Our Recommendation" },
      {
        type: "p",
        text: "For new projects: start with Neon free tier. It's the best balance of free storage, no expiry, and low latency. For production apps or when you need extensions like TimescaleDB or pgvector beyond Neon's support: self-host on a VPS with Deployzy for the easiest operational experience.",
      },
      {
        type: "cta",
        heading: "Managed Postgres on your own VPS",
        text: "Deployzy provisions a PostgreSQL database in one click, auto-injects the DATABASE_URL into your app, and backs it up daily.",
        href: "/sign-up",
        label: "Create a free database",
      },
    ],
  },

  {
    slug: "ngrok-alternatives-self-hosted-tunnels",
    title: "Best ngrok Alternatives in 2025: Self-Hosted & Free Localhost Tunnels",
    description:
      "Compare the best ngrok alternatives for exposing localhost to the internet — self-hosted, free, and open-source options including Cloudflare Tunnels and Deployzy.",
    excerpt:
      "ngrok raised prices and added device limits on the free tier. Here are the best alternatives — including free and self-hosted options with no rate limits.",
    date: "2025-07-05",
    author: "Deployzy Team",
    readTime: "6 min read",
    category: "Tools",
    tags: ["ngrok alternative", "localhost tunnel", "self-hosted tunnel", "cloudflare tunnel"],
    sections: [
      {
        type: "p",
        text: "ngrok is the dominant tool for exposing localhost to the internet — useful for webhook testing, sharing dev environments, and demoing work-in-progress apps. But ngrok's free tier is increasingly limited: one online tunnel, rate-limited requests, no custom domains, and recently added device limits.",
      },
      {
        type: "p",
        text: "Here are the best ngrok alternatives in 2025, from free self-hosted options to managed services.",
      },
      { type: "h2", text: "1. Cloudflare Tunnel (Free, Managed)" },
      {
        type: "p",
        text: "Cloudflare Tunnel (formerly Argo Tunnel) is arguably the best free ngrok alternative for most use cases. It creates an outbound-only connection from your machine to Cloudflare's edge, with no open inbound ports required.",
      },
      {
        type: "ul",
        items: [
          "Completely free for basic tunneling",
          "Custom domains on your Cloudflare account at no extra cost",
          "DDoS protection and WAF included",
          "Requires a Cloudflare account and DNS managed by Cloudflare",
          "No rate limits on free tier",
        ],
      },
      {
        type: "code",
        lang: "bash",
        text: `# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Authenticate and create a tunnel
cloudflared tunnel login
cloudflared tunnel create my-dev-tunnel
cloudflared tunnel route dns my-dev-tunnel dev.yourdomain.com
cloudflared tunnel run --url http://localhost:3000 my-dev-tunnel`,
      },
      { type: "h2", text: "2. Deployzy Tunnel (Built-in, No Extra Subscription)" },
      {
        type: "p",
        text: "If you're already using Deployzy to deploy apps, the localhost tunnel is built in — no separate account or subscription needed. Install the Deployzy CLI and expose any local port in one command.",
      },
      {
        type: "code",
        lang: "bash",
        text: `npx deployzy tunnel 3000
# → https://abc123.deployzy.site`,
      },
      {
        type: "ul",
        items: [
          "Included in Deployzy's free tier",
          "Request inspection UI built-in (inspect headers, body, replay requests)",
          "Persistent subdomains available",
          "No device or tunnel count limits on paid plans",
        ],
      },
      { type: "h2", text: "3. bore (Self-Hosted, Open Source)" },
      {
        type: "p",
        text: "bore is a minimal, Rust-based self-hosted tunnel. You run the bore server on any VPS and the bore client locally. It's extremely lightweight (~4 MB binary) and easy to audit.",
      },
      {
        type: "code",
        lang: "bash",
        text: `# On your VPS:
bore server

# Locally:
bore local 3000 --to your-vps-ip.com
# → http://your-vps-ip.com:2000`,
      },
      {
        type: "ul",
        items: [
          "Open-source (MIT license), no telemetry",
          "Requires your own VPS",
          "No HTTPS by default (add Nginx + Certbot for TLS)",
          "No web UI for request inspection",
        ],
      },
      { type: "h2", text: "4. frp (Self-Hosted)" },
      {
        type: "p",
        text: "frp (Fast Reverse Proxy) is a mature self-hosted solution from China's open-source community. It supports HTTP, HTTPS, TCP, UDP, and WebSocket tunneling, and has a web dashboard.",
      },
      {
        type: "ul",
        items: [
          "Supports HTTP/HTTPS/TCP/UDP/WebSocket",
          "Web dashboard for monitoring tunnels",
          "Requires a VPS + configuration file (frps.toml on server, frpc.toml locally)",
          "More complex setup than bore",
        ],
      },
      { type: "h2", text: "5. Tailscale Funnel (Free, Managed)" },
      {
        type: "p",
        text: "Tailscale Funnel exposes a port on your Tailscale node to the public internet. If you already use Tailscale for secure networking, this is zero additional cost.",
      },
      {
        type: "code",
        lang: "bash",
        text: `# Expose port 3000 publicly
tailscale funnel 3000`,
      },
      {
        type: "ul",
        items: [
          "Free with Tailscale account",
          "Automatic HTTPS on *.ts.net domain",
          "Requires Tailscale installed on both client and server",
          "Limited to 3 funnels on free tier",
        ],
      },
      { type: "h2", text: "Which Should You Use?" },
      {
        type: "ul",
        items: [
          "Simplest free option with custom domain → Cloudflare Tunnel",
          "Already using Deployzy for deployment → built-in Deployzy tunnel",
          "Need full control + privacy → self-host bore or frp on a VPS",
          "Already in the Tailscale ecosystem → Tailscale Funnel",
          "Need persistent URLs + request inspection on a budget → Deployzy",
        ],
      },
      {
        type: "cta",
        heading: "Tunnel + Deploy in one platform",
        text: "Deployzy bundles localhost tunneling with deployment, databases, and domain management. One tool instead of four.",
        href: "/sign-up",
        label: "Try Deployzy for free",
      },
    ],
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return posts.find((p) => p.slug === slug);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
