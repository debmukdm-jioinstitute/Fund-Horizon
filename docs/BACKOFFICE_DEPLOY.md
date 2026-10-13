# Fund Horizon — Backoffice Deployment & Operations Guide

## 1. Zero-Subscription Deployment (Default: Internal Host)

The recommended production target is an owner-controlled computer or server located on an internal office network or behind an existing VPN. This architecture achieves **₹0 incremental subscription spend**.

### A. Architecture
```text
Office Network / Staff Browser
             │
             ▼ HTTPS :8443
┌──────────────────────────────────────────────┐
│  Nginx Reverse Proxy (deploy/nginx.conf)     │
│  - SSL Termination                           │
│  - Same-origin /api rewrite                  │
└──────┬───────────────────────────────┬───────┘
       │ :3000                         │ :8000
       ▼                               ▼
┌──────────────┐               ┌──────────────┐
│ Next.js Web  │               │ FastAPI API  │
│ (Lean Build) │               │ (Lean Image) │
└──────────────┘               └──────┬───────┘
                                      │
                                      ▼
                       ┌──────────────────────────────┐
                       │ Persistent Storage Volume    │
                       │ SQLite WAL or PostgreSQL DB  │
                       └──────────────────────────────┘
```

### B. Launch Instructions
1. Navigate to deployment directory:
   ```bash
   cd deploy
   ```
2. Place trusted internal TLS certificates in `deploy/certs/internal.crt` and `deploy/certs/internal.key` (or generate a local self-signed certificate for internal testing).
3. Start the containers using Docker Compose:
   ```bash
   docker compose -f compose.internal.yml up -d --build
   ```
4. Run database migrations:
   ```bash
   docker compose -f compose.internal.yml exec api alembic upgrade head
   ```
5. Bootstrap the initial system administrator:
   ```bash
   docker compose -f compose.internal.yml exec -it api python -m app.cli.bootstrap_admin --email admin@fundhorizon.internal --role admin --name "System Administrator"
   ```
6. Access the backoffice at `https://localhost:8443` or the configured internal DNS hostname.

---

## 2. Railway Deployment & Resource Budget Analysis

Fund Horizon retains Dockerfiles (`deploy/api.Dockerfile` and `deploy/web.Dockerfile`) and structure compatible with Railway.

### Financial & Resource Feasibility Analysis ($1 Free Credit Constraint)
- **Railway Free Allowance**: Provides **$1.00 USD of resource credit per month** per account.
- **Published Railway Pricing**:
  - Memory: **$10.00 / GB-month** (~$0.00001389 / MB-minute).
  - CPU: **$20.00 / vCPU-month**.
- **Resource Math for 24/7 Uptime**:
  - A Next.js 14 production Node process utilizes **~120–180 MB RAM**.
  - A FastAPI Python worker under active collector execution consumes **~100–140 MB RAM**.
  - Combined steady-state baseline memory: **~250–320 MB RAM**.
  - Monthly RAM cost: `0.30 GB × $10.00 = $3.00 USD / month` for memory alone.
  - Adding minimal CPU, network egress, and persistent volume storage yields an estimated monthly usage of **$4.00–$6.00 USD / month**.
- **Engineering Verdict**:
  - Continuous 24/7 hosting of both Next.js and FastAPI services exceeds the $1.00 monthly free resource credit.
  - Deploying to Railway without an active paid subscription plan will result in service suspension when the $1 limit is exhausted.
  - **Do not deploy as an always-on public Railway service expecting ₹0 spend unless explicitly provisioned with an existing paid credit allocation.**

---

## 3. Persistent Storage, Backup & Disaster Recovery

### A. SQLite WAL Mode Invariants
When utilizing persistent SQLite:
1. SQLite WAL mode (`PRAGMA journal_mode=WAL`) is enabled automatically by `_sqlite.get_default_connection()`.
2. Busy timeout is configured to `5000 ms` to avoid locking collisions between web handlers and background collectors.
3. Database volume must be mounted on local POSIX-compliant block storage. **Never place SQLite on NFS, SMB, or distributed network volumes.**

### B. Automated Backup Command
Perform an online zero-downtime hot backup using SQLite's backup API:
```bash
# SQLite live snapshot backup
sqlite3 /srv/data/fund_horizon.db ".backup '/srv/data/backups/fund_horizon_$(date +%Y%m%d_%H%M%S).db'"
```
For PostgreSQL deployments:
```bash
pg_dump -Fc "$DATABASE_URL" > "/srv/data/backups/fund_horizon_$(date +%Y%m%d_%H%M%S).dump"
```

### C. Tested Restore Workflow
1. Stop the application services:
   ```bash
   docker compose -f compose.internal.yml stop api web
   ```
2. Replace the active database file with the target backup:
   ```bash
   cp /srv/data/backups/fund_horizon_TARGET.db /srv/data/fund_horizon.db
   ```
3. Verify file integrity:
   ```bash
   sqlite3 /srv/data/fund_horizon.db "PRAGMA integrity_check;"
   ```
4. Restart services:
   ```bash
   docker compose -f compose.internal.yml start api web
   ```

---

## 4. Rollback Plan

If an operational regression or schema conflict occurs during cutover:
1. **Never downgrade Alembic destructively in production**.
2. Stop new image containers and restore the prior known stable Docker image tag.
3. If database changes must be reverted, restore the pre-cutover database snapshot using the restore workflow described above.
4. Verify that fail-closed internal security (`FH_INTERNAL_ONLY=true`) remains active during and after rollback. Under no circumstances should newly ingested private backoffice records be exposed on an unauthenticated public endpoint.
