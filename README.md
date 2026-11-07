# AsteAI Platform

Multi-sided AI hiring and talent marketplace. NestJS API + Next.js 14 frontend, AWS RDS (PostgreSQL), Bun monorepo.

## Quick start

```bash
bun install

# Copy and fill .env files
cp apps/api/.env.example apps/api/.env.local
cp apps/web/.env.example apps/web/.env.local

# Run DB migration
psql $DATABASE_URL -f packages/db/migrations/001_initial_schema.sql

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
docs/      → ARCHITECTURE.md
```

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full developer guide.

## Roles

Employer · Candidate · Freelancer · Buyer · Admin

## Voice control

Open **Voice control** on any page and select **Start listening**. Say
“read controls” to hear the available names and numbers, “set language to
English” to fill a field, or “activate number 4” followed by “confirm” to
use a button or link. The panel also accepts typed commands.

The panel uses the browser's English speech recognition and can be used
with a keyboard. Microphone access is opt-in. The browser may process
audio through its speech service. The panel does not collect passwords
or one-time codes, and it releases the microphone before a live interview.

Use native controls with accessible labels so new screens work with the
panel. Use `data-voice-ignore` on controls that should stay manual.

## Prior art

Rewrite of `deeptech_backend` (Express) + `deeptech_frontend` (React SPA).  
Connects to `deeptech_ai` for IRT scoring, translation, and LLM features.
