# קניות ביחד — Shared Shopping List App

רשימת קניות משפחתית עם סנכרון בזמן אמת, תמיכה בעברית RTL, ומצב לא מקוון.

---

## 🚀 Quick Start

```bash
# 1. Clone and enter
git clone <repo-url>
cd shopping-app

# 2. Create env file
cp .env.example .env
# Edit .env — change JWT_SECRET and passwords

# 3. Start everything
docker compose up --build

# App is live at:  http://localhost
# API docs at:     http://localhost/api/docs
# MinIO console:   http://localhost:9001  (dev only)
```

That's it. One command boots all 7 services.

---

## 🏗️ Architecture

```
Browser (React PWA)
    │
    ├── REST  →  Nginx :80  →  FastAPI :8000  →  PostgreSQL
    ├── WS    →  Nginx :80  →  WS Server :8001 ←─ Redis pub/sub
    └── Push  ←  Browser Push API  ←  Celery worker
                                           │
                                    PostgreSQL + Redis
```

### Services (docker-compose.yml)

| Service  | Image                  | Port  | Purpose                           |
|----------|------------------------|-------|-----------------------------------|
| nginx    | nginx:1.25-alpine      | 80    | Reverse proxy, TLS, static assets |
| frontend | node:20 → alpine       | —     | React build (exports to volume)   |
| api      | python:3.12-slim       | 8000  | FastAPI REST API                  |
| ws       | python:3.12-slim       | 8001  | WebSocket realtime server         |
| worker   | python:3.12-slim       | —     | Celery worker + Beat scheduler    |
| db       | postgres:16-alpine     | 5432  | Primary datastore                 |
| redis    | redis:7-alpine         | 6379  | Cache · pub/sub · job queue       |
| minio    | minio/minio            | 9001  | S3-compatible image storage       |

---

## 📁 Project Structure

```
shopping-app/
├── docker-compose.yml
├── .env.example
├── nginx/
│   └── nginx.conf
├── scripts/
│   └── init.sql              # PostgreSQL extensions (pg_trgm)
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic.ini
│   └── app/
│       ├── main.py           # FastAPI app, startup, router wiring
│       ├── config.py         # Pydantic settings (from env vars)
│       ├── ws_server.py      # WebSocket server (separate uvicorn process)
│       ├── models/
│       │   ├── models.py     # SQLAlchemy ORM models (all tables)
│       │   └── database.py   # Async engine, session factory
│       ├── schemas/
│       │   └── schemas.py    # Pydantic request/response schemas
│       ├── routers/
│       │   └── routers.py    # All API endpoints
│       ├── services/
│       │   ├── auth_service.py   # JWT, bcrypt, token rotation
│       │   ├── deps.py           # FastAPI dependencies (auth, RBAC)
│       │   ├── redis_service.py  # Pub/sub, cache, idempotency
│       │   └── image_service.py  # MinIO upload + thumbnail
│       └── workers/
│           └── worker.py     # Celery tasks + Beat schedule
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts        # Vite + PWA plugin
    └── src/
        ├── api/
        │   └── client.ts     # Typed API client + offline queue (IndexedDB)
        └── sw.ts             # Service worker (push + background sync)
```

---

## 🔑 Key Design Decisions

### Auth
- **JWT access tokens** stored in memory only (never localStorage/sessionStorage)
- **Refresh tokens** in httpOnly cookies — XSS-proof
- **Token rotation** on every refresh — compromised refresh tokens self-heal
- 15-minute access token TTL, 30-day refresh token TTL

### Realtime sync
- Every REST mutation publishes to `Redis PUBLISH list:{id}`
- WebSocket server subscribes to `list:*` pattern and fans out
- Client reconnects automatically, sends `cursor` (last-known timestamp)
- Server replays missed events from `mutation_events` table

### Offline-first
- Service worker intercepts all `/api/*` fetches
- Failed mutations go into IndexedDB `mutation_queue`
- On `navigator.online` event: drain queue → replay via `/lists/:id/sync` → fetch server diff
- **Idempotency keys** prevent duplicate processing of replayed mutations
- **Conflict resolution**: field-level Last-Write-Wins via vector clocks

### Hebrew search
- `pg_trgm` extension enables trigram similarity on `name_he_normalized`
- Normalization pipeline: strip niqqud → normalize final letters (ך→כ) → lowercase
- Debounce: 120ms (faster than typical 300ms — Hebrew keyboard is quick)

### Recurring items
- Celery Beat runs every 15 minutes
- Queries `WHERE next_run_date <= NOW() AND is_enabled = true`
- **Auto-add**: inserts `list_item` with `ON CONFLICT DO NOTHING` (idempotent)
- **Suggest mode**: sends push notification, user confirms in app
- `next_run_date` always advances by `interval_days` after processing

---

## 🛠️ Development Workflow

```bash
# Start only infrastructure (DB + Redis + MinIO), run API locally
docker compose up db redis minio
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Run Celery worker locally
celery -A app.workers.worker.celery_app worker --beat --loglevel=debug

# Frontend dev server with HMR
cd frontend
npm install
npm run dev   # proxies /api → localhost:8000, /ws → localhost:8001

# View API docs
open http://localhost:8000/docs

# Connect to DB
docker compose exec db psql -U postgres -d shopping

# Monitor Celery tasks
docker compose exec worker celery -A app.workers.worker.celery_app flower
```

---

## 📊 Database

Tables are created automatically on first startup via `Base.metadata.create_all`.

For production, use Alembic migrations:
```bash
cd backend
alembic revision --autogenerate -m "description"
alembic upgrade head
```

Key indexes:
- `ix_catalog_items_trgm` — GIN trigram index on `name_he_normalized` (Hebrew fuzzy search)
- `ix_list_items_pending_unique` — partial unique index: one pending item per catalog item per list
- `ix_mutation_events_list_time` — composite index on `(list_id, created_at)` for sync replay

---

## 🔔 Push Notifications Setup

```bash
# Generate VAPID keys
pip install py-vapid
python -m py_vapid --gen-key
# Copy output to .env: VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY
```

---

## 🚢 Production Checklist

- [ ] Change `JWT_SECRET`, `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY` in `.env`
- [ ] Add TLS certificate to Nginx (Let's Encrypt / Caddy)
- [ ] Set `ENVIRONMENT=production` (disables SQL echo logs)
- [ ] Configure VAPID keys for push notifications
- [ ] Set `CORS_ORIGINS` to your actual domain
- [ ] Run Alembic migrations instead of `create_all`
- [ ] Set up PostgreSQL backups (pg_dump cron or managed DB)
- [ ] Separate Celery worker and Beat into two containers
- [ ] Add `FLOWER_BASIC_AUTH` to Celery Flower monitoring

---

## 📱 PWA Installation

On Android Chrome: "Add to Home Screen" from the browser menu.
On iOS Safari: Share → "Add to Home Screen".

The app works fully offline after first load. Mutations made while offline are
queued in IndexedDB and replayed automatically on reconnection.
