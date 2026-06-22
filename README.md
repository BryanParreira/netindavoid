# Netindavoid

> **Network Security Monitoring Platform** — a self-hosted, real-time dashboard for home and small-business networks. Replaces router admin pages, Pi-hole, ntopng, and firewall log viewers with a single polished interface.

---

## Architecture

```
OpenWrt Router  ──┐
Suricata/Zeek   ──┤──► Ingestion Layer (FastAPI + Celery workers)
nmap/arp-scan   ──┤              │
Pi-hole API     ──┘              ▼
                          PostgreSQL + TimescaleDB
                                  │
                          Redis Pub/Sub
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
            WebSocket push              AI Service (Ollama)
                    │                           │
                    └──────────► Next.js Dashboard ◄──────┘
```

### Services (Docker Compose)

| Service         | Port   | Description                                            |
| --------------- | ------ | ------------------------------------------------------ |
| `web`           | 3000   | Next.js 14 dashboard (dark-mode first)                 |
| `api`           | 8000   | FastAPI backend (REST + WebSocket)                     |
| `ai-service`    | 8001   | Ollama wrapper microservice                            |
| `postgres`      | 5432   | TimescaleDB (hypertables for traffic/DNS)              |
| `redis`         | 6379   | Pub/Sub + Celery broker + cache                        |
| `celery-worker` | —      | Background scans + Suricata ingestion                  |
| `celery-beat`   | —      | Periodic task scheduler                                |
| `ollama`        | 11434  | Local LLM inference                                    |
| `suricata`      | —      | IDS (opt-in: `--profile ids`)                          |
| `caddy`         | 80/443 | Reverse proxy + auto-HTTPS (opt-in: `--profile proxy`) |

---

## Quick Start

### Prerequisites

- Docker + Docker Compose v2
- 4 GB RAM minimum (8 GB recommended when running Ollama)
- Network adapter accessible to the host for scanning

### 1. Clone and configure

```bash
git clone https://github.com/you/netindavoid.git
cd netindavoid
cp .env.example .env
```

Edit `.env` — at minimum change these:

```bash
# Generate a strong JWT secret
JWT_SECRET_KEY=$(openssl rand -hex 32)

# Generate Fernet encryption key (for router credentials)
FERNET_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

POSTGRES_PASSWORD=your_strong_password
DATABASE_URL=postgresql+asyncpg://netindavoid:your_strong_password@postgres:5432/netindavoid

ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=YourStrongPassword123!
SCAN_NETWORK_CIDR=192.168.1.0/24   # your actual subnet
```

### 2. Start the stack

```bash
docker compose up -d
```

The first boot will:

1. Initialize PostgreSQL + TimescaleDB extensions
2. Run Alembic migrations
3. Bootstrap the admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
4. Download the IEEE OUI database (~25 MB) for MAC vendor lookups

Dashboard → **http://localhost:3000**
API docs → **http://localhost:8000/docs**

### 3. Load a language model (for AI assistant)

```bash
docker compose exec ollama ollama pull llama3.2
# or for a larger model:
docker compose exec ollama ollama pull llama3.1:8b
```

### 4. Seed demo data (optional, no real network needed)

```bash
docker compose exec api python -m scripts.seed
# Reset + re-seed:
docker compose exec api python -m scripts.seed --clear
```

Demo credentials:

- Email: `admin@netindavoid.local`
- Password: `DemoPassword123!`

---

## Pointing at a Real OpenWrt Router

### Method 1: SSH (recommended)

1. On your OpenWrt router, create a read-only user:

```bash
# On the router
opkg install sudo
adduser netindavoid
echo "netindavoid ALL=(root) NOPASSWD: /usr/bin/cat /tmp/dhcp.leases, /sbin/ip" >> /etc/sudoers
```

2. In the Netindavoid Settings UI (or `.env`):

```
ROUTER_HOST=192.168.1.1
ROUTER_SSH_PORT=22
ROUTER_SSH_USER=netindavoid
```

Paste your SSH private key in the Settings UI — it's encrypted at rest with Fernet before being stored.

### Method 2: ubus RPC API

If your OpenWrt router has the `rpcd` package installed:

```
ROUTER_API_URL=http://192.168.1.1/ubus
ROUTER_API_KEY=<your-ubus-session-token>
```

---

## Enabling Suricata IDS

Suricata runs in tap mode using a mirror/SPAN port or `AF_PACKET`:

```bash
# Start with the IDS profile
docker compose --profile ids up -d suricata

# Update Suricata rules
docker compose exec suricata suricata-update
```

Edit `infra/docker/suricata.yaml` to change the monitored interface (`eth0` by default).

Alerts from Suricata are ingested every 10 seconds by the `celery-worker` and show up in the Threats dashboard with plain-language AI explanations.

---

## Enabling HTTPS (Caddy)

```bash
# Edit .env
CADDY_DOMAIN=netindavoid.yourdomain.com
ACME_EMAIL=you@example.com

# Start with the proxy profile
docker compose --profile proxy up -d caddy
```

Caddy automatically obtains a Let's Encrypt certificate for your domain.

---

## Pi-hole Integration

If you run Pi-hole on your network:

```
PIHOLE_API_URL=http://192.168.1.2/api
PIHOLE_API_KEY=your-pihole-api-key
```

DNS blocks will appear in the DNS page with per-device attribution.

---

## Tech Stack

| Layer           | Technology                                                                            |
| --------------- | ------------------------------------------------------------------------------------- |
| **Frontend**    | Next.js 14 (App Router), TypeScript strict, Tailwind CSS, Recharts, react-force-graph |
| **Backend**     | Python 3.12, FastAPI (async), Pydantic v2, SQLAlchemy 2.0                             |
| **Database**    | PostgreSQL 16 + TimescaleDB (hypertables for traffic + DNS)                           |
| **Cache/Queue** | Redis 7, Celery 5                                                                     |
| **Auth**        | JWT (access + refresh), Argon2 password hashing, TOTP 2FA, RBAC                       |
| **Scanning**    | nmap, arp-scan, Scapy, IEEE OUI database                                              |
| **IDS**         | Suricata (EVE JSON ingestion)                                                         |
| **AI**          | Ollama (local LLM), custom system prompt with live network context                    |
| **Infra**       | Docker Compose, Caddy (HTTPS), Kubernetes/Helm path documented for SaaS scaling       |

---

## API Reference

Auto-generated OpenAPI docs at `/docs` (dev mode) or `/redoc`.

Key endpoints:

| Method | Path                         | Description                         |
| ------ | ---------------------------- | ----------------------------------- |
| `POST` | `/api/v1/auth/login`         | Login (returns JWT + refresh token) |
| `POST` | `/api/v1/auth/totp/setup`    | Begin 2FA enrollment                |
| `GET`  | `/api/v1/devices`            | List all devices with filters       |
| `POST` | `/api/v1/devices/{id}/block` | Block/unblock a device via router   |
| `GET`  | `/api/v1/traffic/overview`   | Bandwidth stats + timeseries        |
| `GET`  | `/api/v1/dns/overview`       | DNS query stats                     |
| `GET`  | `/api/v1/alerts`             | Alert feed with severity filter     |
| `POST` | `/api/v1/ai/query`           | Ask the AI assistant a question     |
| `POST` | `/api/v1/scans`              | Trigger a network scan              |
| `WS`   | `/ws/live-traffic`           | Real-time bandwidth push            |
| `WS`   | `/ws/alerts`                 | Real-time alert push                |
| `WS`   | `/ws/devices`                | Real-time device state push         |

---

## Data Model

```
tenants (id, name, slug, plan)
  └── users (id, tenant_id, email, role, totp_enabled, ...)
  └── devices (id, tenant_id, mac, ip, vendor, status, risk_score, ...)
        └── device_events (device_id, event_type, occurred_at)
        └── device_tags (device_id, name, color)
  └── traffic_samples [hypertable] (tenant_id, device_id, sampled_at, bytes_in, bytes_out, ...)
  └── dns_queries [hypertable] (tenant_id, device_id, queried_at, domain, is_blocked, ...)
  └── alerts (tenant_id, device_id, severity, ai_explanation, ...)
  └── alert_rules (tenant_id, condition JSON, channels, cooldown_seconds)
  └── scans (tenant_id, scan_type, status, devices_found, ...)
  └── router_configs (tenant_id, encrypted_ssh_password, encrypted_api_key)
  └── audit_logs (tenant_id, user_id, action, occurred_at, ip_address)
  └── ai_query_logs (tenant_id, question, answer, latency_ms)
```

Every table includes `tenant_id` — multi-tenancy requires no schema migration.

---

## Build Phases

| Phase             | Status      | Scope                                                              |
| ----------------- | ----------- | ------------------------------------------------------------------ |
| **Phase 1 (MVP)** | ✅ Complete | Auth, device discovery, bandwidth, dashboard shell                 |
| **Phase 2**       | 🔜          | DNS deep-dive, alert rules engine, notification integrations       |
| **Phase 3**       | 🔜          | Suricata IDS integration, live network topology, security score    |
| **Phase 4**       | 🔜          | AI assistant polish, reports/export, PWA support, multi-tenancy UI |
| **Phase 5**       | 🔜          | Geo-IP map, device isolation, Cmd+K palette, white-label theming   |

---

## Security Notes

- Router credentials encrypted at rest with Fernet (key outside the DB)
- Auth endpoints rate-limited (slowapi): 5/min register, 10/min login
- Argon2 password hashing (not bcrypt)
- TOTP 2FA with backup codes (hashed, single-use)
- Audit log for all admin actions
- All API endpoints validate input via Pydantic — no raw string interpolation
- `celery-worker` container gets `NET_ADMIN`/`NET_RAW` caps only (not `api` container)
- HTTPS enforced by Caddy with HSTS headers

---

## Contributing

Phase 2+ work tracked in issues. PRs welcome. Run tests with:

```bash
# Backend
docker compose exec api pytest --cov=. -q

# Frontend
docker compose exec web npm test
```

---

## License

MIT
