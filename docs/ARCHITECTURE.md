# AsteAI Platform – Developer Documentation

## Overview

AsteAI is a multi-sided AI-powered hiring and talent marketplace platform. This repo (`asteai-redo`) is the production rewrite of the `deeptech_backend` + `deeptech_frontend` monorepos.

### User roles
| Role | Description |
|------|-------------|
| **Employer** | HR / TA admins at tenant companies. Create requisitions, review assessments, manage pipeline. |
| **Candidate** | Job applicants. Take assessments, earn Talent Passports, track applications. |
| **Freelancer** | Independent experts. Bid on projects, receive milestone payments. |
| **Buyer** | Companies sourcing deeptech expertise. Post projects, fund milestones. |
| **Admin** | AsteAI Operations. Master control, feature flags, audit, growth/marketing. |

---

## Monorepo structure

```
asteai-redo/
├── apps/
│   ├── api/          # NestJS REST API (Node.js / Bun)
│   └── web/          # Next.js 14 App Router frontend
├── packages/
│   ├── types/        # Shared TypeScript types (consumed by both apps)
│   └── db/
│       └── migrations/  # Plain SQL migrations for AWS RDS (PostgreSQL 16)
└── docs/             # This documentation
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, CSS Modules |
| Backend | NestJS 10, TypeScript, Passport.js (JWT + Local) |
| Database | AWS RDS PostgreSQL 16 (via `pg` pool — no Supabase) |
| Auth | JWT access tokens (15 min) + refresh tokens (7 days) in `refresh_tokens` table |
| State (FE) | Zustand (persisted to localStorage) + SWR for server state |
| Package manager | **Bun** (workspaces) |
| Fonts | Sora (display), Manrope (body), JetBrains Mono |
| AI service | `deeptech_ai` — separate FastAPI service, proxied via `VoiceModule` |

---

## Getting started

### Prerequisites
- Bun >= 1.1
- PostgreSQL 16 (or AWS RDS endpoint)

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

**API:**
```bash
cp apps/api/.env.example apps/api/.env.local
# Fill in DATABASE_*, JWT_*, etc.
```

**Web:**
```bash
cp apps/web/.env.example apps/web/.env.local
```

### 3. Run database migrations

```bash
DATABASE_URL=postgres://... bun run --filter @asteai/db migrate
# `migrate:status` lists applied / pending files. On a database where the SQL was
# applied by hand, insert those file names into schema_migrations first.
```

### 4. Start development servers

```bash
bun run dev:api   # NestJS on :3001
bun run dev:web   # Next.js on :3000
```

### 5. Swagger docs
http://localhost:3001/api/docs (development only)

---

## API design

All endpoints live under `/api/v1/`. The global interceptor wraps every response:

```json
{ "data": <payload> }
```

Errors:
```json
{ "statusCode": 400, "message": "...", "errors": { "field": ["..."] } }
```

### Authentication flow
1. `POST /api/v1/auth/login` → `{ accessToken, refreshToken, user }`
2. Send `Authorization: Bearer <accessToken>` on every protected request
3. On 401, call `POST /api/v1/auth/refresh` with `{ userId, refreshToken }`
4. `POST /api/v1/auth/logout` revokes all refresh tokens

### Rate limits (per IP)
- Short: 10 req/s
- Medium: 50 req/10s
- Long: 200 req/min

---

## Module overview

### `auth`
JWT + Passport local strategy. Refresh tokens persisted to DB.

### `users`
`GET /users/me` and `PUT /users/me`.

### `tenants`
Multi-tenant org management. Admins can list all; employers see their own.

### `requisitions`
Full CRUD for job openings. Tenant-scoped. `PATCH /:id/fund` activates SLA clock.

### `applications`
Candidate apply + employer pipeline management.
- `GET /applications/requisition/:reqId` — pipeline (Employer)
- `GET /applications/me` — my applications (Candidate)
- `POST /applications/:reqId/apply`
- `PATCH /applications/:id/stage`
- `POST /applications/:id/scorecards`

### `assessments`
- `POST /assessments/submit` — seal result, auto-flag integrity
- `GET /assessments/integrity-queue` (Admin)
- `PATCH /assessments/integrity-queue/:id/resolve`

### `passports`
Verifiable Talent Passports issued after sealed assessments.
- `GET /passports/me`
- `GET /passports/verify?hash=...` — public
- `PATCH /passports/:id/share`

### `projects`
Buyer marketplace projects with milestone JSONB.

### `proposals`
Freelancer bids; `PATCH /:id/award` triggers contract creation.

### `ledger`
Immutable transaction log. `GET /ledger/wallet` for freelancer earnings.

### `notifications`
Per-user notification feed with read tracking.

### `analytics`
- `GET /analytics/employer/dashboard`
- `GET /analytics/employer/fairness` — demographic breakdown

### `admin`
- `GET /admin/stats`
- `GET /admin/audit`
- `POST /admin/flags`

### `voice`
Proxy to `deeptech_ai` for translate and detect.

---

## Database schema

Migration: `packages/db/migrations/001_initial_schema.sql`

Key tables:
| Table | Purpose |
|-------|---------|
| `tenants` | Employer orgs |
| `user_accounts` | All users (all roles) |
| `requisitions` | Job openings with SLA tracking |
| `applications` | Candidate→req with stage history JSONB |
| `scorecards` | Panel scores per application |
| `assessment_results` | Sealed IQ/EQ/Grit theta + sten |
| `integrity_queue` | Flagged assessments for review |
| `passports` | Verifiable Talent Passports |
| `certificates` | Digital certificates |
| `projects` | Marketplace projects + milestones JSONB |
| `proposals` | Freelancer bids |
| `ledger_entries` | Financial log |
| `notifications` | User notifications |
| `audit_log` | Admin audit trail |
| `talent_pools` | Saved candidate segments |
| `outreach_campaigns` | Bulk outreach stats |
| `disputes` | Marketplace disputes |
| `consents` | GDPR consent records |
| `refresh_tokens` | JWT refresh token store |

---

## Frontend structure

```
apps/web/src/
├── app/
│   ├── layout.tsx              # Root layout (fonts, globals.css)
│   ├── page.tsx                # Redirects to /platform
│   ├── auth/login/page.tsx     # Login form
│   └── platform/
│       ├── layout.tsx          # AppShell
│       ├── page.tsx            # Role-based redirect
│       ├── requisitions/       # Employer view
│       ├── applications/       # Candidate view
│       ├── passport/           # Talent Passport viewer
│       ├── projects/           # Buyer view
│       └── admin/              # Master control
├── components/
│   ├── layout/                 # AppShell, TopBar, Rail, DashboardRedirect
│   └── ui/                     # Panel, Button, Tag, KPI, Field, etc.
├── lib/api.ts                  # Typed fetch client with auto-refresh
├── store/auth.ts               # Zustand auth store
└── styles/globals.css          # CSS variables + reset
```

### Design tokens
All colours/typography are CSS custom properties in `globals.css` matching the original `index.html` design. Components use CSS Modules that reference these variables.

---

## Adding a new backend module

```bash
mkdir apps/api/src/modules/<name>
# Create: <name>.module.ts, <name>.service.ts, <name>.controller.ts
# Register in: apps/api/src/app.module.ts
```

## Adding a new frontend page

1. Create `apps/web/src/app/platform/<slug>/page.tsx`
2. Add `[slug, 'Label']` to the appropriate role in `Rail.tsx`

---

## Environment variables

### `apps/api/.env.local`
| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_HOST` | Yes | RDS endpoint |
| `DATABASE_NAME` | Yes | |
| `DATABASE_USER` | Yes | |
| `DATABASE_PASSWORD` | Yes | |
| `DATABASE_SSL` | | `true` for RDS |
| `JWT_SECRET` | Yes | 64+ chars |
| `CORS_ORIGINS` | | Comma-separated |
| `AI_SERVICE_URL` | | deeptech_ai FastAPI |
| `RAZORPAY_KEY_ID` | | Payments |
| `RAZORPAY_KEY_SECRET` | | Payments |

### `apps/web/.env.local`
| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | Defaults to rewrite → localhost:3001 |

---

## Deployment

### AWS RDS
- Set `DATABASE_SSL=true`; the pg pool uses `{ rejectUnauthorized: false }` for RDS CA
- Run migrations once as superuser; app user needs only DML + SELECT

### NestJS (ECS / PM2)
```bash
bun run build   # → dist/
bun run start   # node dist/main.js
```

### Next.js (Vercel / ECS)
```bash
bun run build
bun run start
```
Remove the dev rewrite in `next.config.js`; configure nginx/ALB to route `/api/v1/*` to the NestJS service.

---

## Roadmap — connecting to deeptech_ai

1. **IRT scoring** — wire `AssessmentsService` to deeptech_ai for Rasch/3PL theta estimation
2. **AI job creator** — LLM-generated structured requisitions
3. **Candidate matching** — pgvector similarity search on passports
4. **Voice studio** — real-time STT/TTS during assessments
5. **Marketing Studio** — Meta Ads campaign builder (full logic in `index.html` → migrate to dedicated module)
