# AsteAI Platform

Multi-sided AI hiring and talent marketplace. NestJS API + Next.js 14 frontend, AWS RDS (PostgreSQL), Bun monorepo.

## Quick start

```bash
bun install

# Copy and fill .env files
cp apps/api/.env.example apps/api/.env.local
cp apps/web/.env.example apps/web/.env.local

# Run DB migrations (applies each packages/db/migrations/*.sql once)
DATABASE_URL=postgres://... bun run --filter @asteai/db migrate

# Dev servers
bun run dev:api   # :3001
bun run dev:web   # :3000
```

Swagger: http://localhost:3001/api/docs

## Structure

```
apps/api   → NestJS REST API
apps/web   → Next.js 14 frontend
packages/
  types    → Shared TypeScript types
  db/      → SQL migrations
docs/      → ARCHITECTURE.md, CLEANUP.md
legacy/    → previous single-file HTML prototype (reference only)
```

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full developer guide.

## Roles

Employer · Candidate · Freelancer · Buyer · Admin

## Prior art

Rewrite of `deeptech_backend` (Express) + `deeptech_frontend` (React SPA).  
Connects to `deeptech_ai` for IRT scoring, translation, and LLM features.
