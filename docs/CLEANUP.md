# Codebase cleanup — November 2026

This records what the cleanup pass on branch `cleanup/codebase-polish` changed, the bugs it
fixed, and the larger refactors that are proposed but **not** done yet (they change behaviour
or the repo layout, so they need a decision first).

Verified after the changes: API and web typecheck, `next lint` is clean, `next build` and the
API build succeed, and the API was run against a fresh PostgreSQL 16 with both migrations to
exercise sign-up, login, refresh, tenancy and permission checks. The web app was driven in a
headless browser (auth guard redirect, wrong-password error, login, silent token refresh,
sign-out).

---

## 1. Bugs fixed

### Security / authorization (API)

| Where | Problem | Fix |
|---|---|---|
| `GET /applications/requisition/:id` | Any employer could list applicants of **any** tenant's requisition. | Tenant check (`assertTenantAccess`). |
| `GET /applications/candidate/:id` | Any employer could read any candidate's applications across tenants. | Employers only see applications made to their tenant. |
| `PATCH /applications/:id/stage`, `POST /applications/:id/scorecards` | No tenant check: any employer could move or score any application. | Tenant check; stage validated against `APPLICATION_STAGES`; stage update is row-locked. |
| `GET /assessments/result/:id` | Any signed-in user could read any assessment result. | Candidate, employers of a tenant the result was submitted to, or admins. |
| `PATCH /passports/:id/share` | Any user could change anyone's passport privacy settings. | Holder only. |
| `GET /passports/:id` | Any user could read any passport. | Holder, admin, or passport marked discoverable. |
| `POST /passports/:id/verify` | Anyone (including the holder) could add "verified by" stamps. | Employer / Buyer / Admin, not the holder; atomic JSONB append. |
| `GET /passports/verify` | Returned the holder's name even when `show_identity` was off. | Name only when the holder allows it. |
| `GET /proposals/project/:id` | Any buyer could read the bids on any other buyer's project. | Project's buyer or admin. |
| `PATCH /projects/:id/milestones/:mid` | Any buyer/freelancer could change milestones on any project. | Buyer, awarded freelancer, or admin; row-locked; unknown milestone → 404. |
| `PATCH /proposals/:id/award` | Not transactional; could award twice. | One transaction, project row-locked, re-award refused. |
| Refresh tokens | One bcrypt compare per outstanding token (slow, grows with logins); a token could be used twice concurrently. | Token is `<row id>.<secret>`: one lookup, one compare, single-use enforced by an atomic `UPDATE … WHERE revoked = FALSE`. Inactive users can no longer refresh. |
| Auth endpoints | No brute-force limit beyond the global throttle. | `login` 10/min, `register` 5/min per client. |

> Existing refresh tokens use the old format and stop working after deploy: users sign in once more.

### Correctness (API)

- **Sign-up was broken**: `INSERT … VALUES ($1, LOWER($1) …)` fails in Postgres with
  "inconsistent types deduced for parameter $1", so `POST /auth/register` always returned 500.
  Fixed with explicit casts; duplicate e-mails (any case, including a concurrent race) return 409.
- **DB login with IAM auth never worked**: `.env.example`, `dev-setup.sh` and `infra/` all set up
  RDS IAM authentication (`DATABASE_IAM_AUTH=true`, blank password), but the pool always used the
  static password. The pool now signs a fresh IAM token per connection (`@aws-sdk/rds-signer`,
  already a dependency). `DATABASE_SSL_REJECT_UNAUTHORIZED` is now honoured too.
- **Response shapes didn't match the shared types**: passports, applications and projects were
  returned as raw snake_case rows, so the web pages showed "Invalid Date", missing STEN scores
  and needed `as any`. Added row mappers (`*.mapper.ts`) that return the `@asteai/types` shapes.
  `numeric` columns are converted to numbers where the type says number.
- **Untrusted bodies**: many endpoints took `body: any` or an inline type, which the global
  `ValidationPipe` cannot check. Every body now has a DTO (users, auth refresh, applications,
  assessments, passports, projects, proposals, admin flags, voice).
- **Unbounded paging**: `pageSize=1000000` was accepted. `paginate()` clamps page / pageSize.
- **Invalid status filter → 500**: `GET /requisitions?status=foo` hit the Postgres enum. Now ignored.
- **ID collisions**: ids came from `Math.random()` with 4 chars (`PRJ-` used 4 digits: 9,000
  values). `generateId()` uses the CSPRNG with 8 base-32 characters.
- **Analytics double counting**: the fairness report and dashboard joined assessment results by
  candidate only, so a candidate with several results was counted several times. Joined on
  `applications.result_id`.
- **Applying to closed requisitions** was allowed; now only `Open` requisitions accept applications.
- **Voice proxy** sent no API key and turned upstream errors into 500s; it now uses `AiService`.
- **Shutdown**: added `enableShutdownHooks()` and a pool `end()` on shutdown; bootstrap errors exit 1.
- Assessment submit, passport issue: multi-statement writes now run in a transaction (`withTransaction`).

### Frontend

- **Wrong password reloaded the page**: any 401, including from `/auth/login`, triggered a refresh
  attempt and then `window.location = /auth/login`, so the error message was never shown.
  Auth endpoints no longer trigger a refresh.
- **Concurrent 401s logged users out**: refresh tokens are single-use, and parallel requests each
  started their own refresh. Refresh is now single-flight.
- **No auth guard**: `/platform/*` pages rendered for signed-out visitors. `AppShell` now waits for
  the persisted session and redirects to `/auth/login?next=…`; login returns there (same-site
  `/platform` paths only).
- **Hydration mismatch**: the shell rendered the user on the client but not on the server.
- **Tokens were stored twice** (Zustand persist and raw localStorage) and drifted apart after a
  refresh. `lib/tokens.ts` is now the single store; Zustand persists only `user`.
- **Dead navigation**: 33 of 42 rail links pointed to pages that don't exist (404), and the
  Freelancer home was one of them. Unbuilt items show as "Soon"; routes live in `lib/routes.ts`.
- Certificate download now goes through the API client, so it refreshes an expired token.
- Pages show request errors instead of an empty state; `any` removed from pages.
- Added `.eslintrc.json` so `next lint` runs non-interactively.

### Repo hygiene

- Removed committed build output: `packages/types/src/index.{js,d.ts,js.map}` (stale, 50 lines
  behind `index.ts`) and `apps/api/tsconfig.build.tsbuildinfo`; `*.tsbuildinfo` is ignored.
- Removed the empty `ContractsModule` / `MarketplaceModule` and the unused `jwt-refresh` strategy.
- `@asteai/db`: `migrate` pointed to a file that didn't exist. Added `migrate.mjs` (applies each
  SQL file once, tracked in `schema_migrations`) and `migrate:status`.
- `bun.lock` was out of date with `package.json` (pdfkit was missing); regenerated.
- `.env.example` no longer contains the real RDS hostname; unused `JWT_REFRESH_SECRET` removed.

---

## 2. Proposed folder structure

The monorepo layout (`apps/`, `packages/`) is right. The changes below are what's left.

```
asteai-redo/
├── apps/
│   ├── api/src/
│   │   ├── main.ts, app.module.ts
│   │   ├── config/            ← NEW: validated env schema (fail fast on missing vars)
│   │   ├── common/            decorators, guards, filters, interceptors, utils/
│   │   ├── database/          pool, withTransaction
│   │   └── modules/<feature>/
│   │       ├── <feature>.controller.ts / .service.ts / .module.ts
│   │       ├── <feature>.mapper.ts      row → @asteai/types
│   │       ├── dto/
│   │       └── <feature>.service.spec.ts   ← NEW: tests
│   └── web/src/
│       ├── app/                routes only (thin pages)
│       ├── features/<feature>/ ← NEW: components + hooks + api calls per feature
│       │                         (move lib/interviews.ts, components/interview/,
│       │                          hooks/usePreAssessment.ts → features/interviews/)
│       ├── components/ui, components/layout
│       ├── lib/                api, tokens, routes
│       └── store/
├── packages/
│   ├── types/                  shared API contract
│   └── db/                     migrations + migrate.mjs
├── infra/, docs/, scripts/
└── legacy/                     ← the old single-file prototype, if kept (see below)
```

Moves / consolidation:

1. **Root prototype** — done: `index.html`, `v4.html`, `src/` and `_headers` (the previous
   single-page prototype) moved to `legacy/`. If a static host (e.g. Cloudflare Pages) deployed
   from the repo root, point its build output directory at `legacy/`.
   `../asteai-next.zip` next to the repo is another older copy.
2. `apps/web/src/lib/interviews.ts`, `components/interview/`, `hooks/usePreAssessment.ts` →
   `apps/web/src/features/interviews/`.
3. `apps/api/src/swagger-shim.ts`, `tsconfig.bun.json`, `bunfig.toml` exist only for running the
   API under Bun, which no script does (dev and start use Node). Remove, or wire a `dev:bun` script.
4. Move `ts-node`, `tsx`, `@swc/core`, `@swc/helpers` from API `dependencies` to `devDependencies`
   (or drop them: nothing imports them).

---

## 3. Larger refactors to decide on

In rough priority order. None of these are done.

1. ~~**Server-side assessment scoring.**~~ Done (uncommitted). `POST /assessments/submit`, which
   stored whatever scores the browser sent, is gone. deeptech_ai (`psychometric/`, branch
   `feat/server-side-assessment-scoring`) now generates the questions, keeps the answers and
   scores the session; the API passes steps through (`/assessments/sessions…`) and stores the
   result (migration `004_assessment_sessions.sql`). Candidates take it at `/platform/assess`
   (`apps/web/src/features/assessment`). Admins reset expired or stuck sessions at
   `/platform/assessment-sessions` (reason required, audited, old session kept); the candidate
   gets an in-app notification linking back to the assessment. The top-bar bell now lists
   notifications (it was a dead button), and an email goes out through the new email service.

### Email (`apps/api/src/modules/email`, migration `005_email_outbox.sql`)

`EmailService.enqueue(template, to, data, { client })` renders a typed template and writes it
to `email_outbox`, inside the caller's transaction. `EmailWorker` (in every API process) claims
due rows with `FOR UPDATE SKIP LOCKED`, sends them, and retries failures after 1, 2, 4, 8, 16
minutes (6 attempts); permanent SES errors fail at once; rows stuck in `sending` for 10 minutes
are picked up again. `EMAIL_TRANSPORT=ses` sends through AWS SES v2 (needs `EMAIL_FROM`,
`AWS_REGION` and a verified sender domain); `log` (the default) writes emails to the log.
Not built yet: SMTP fallback, attachments, bounce/complaint handling, an admin view of failures.
2. **Tokens in httpOnly cookies** instead of localStorage, so an XSS bug cannot steal sessions.
   `cookie-parser` is already installed; needs CSRF protection and a CORS review.
3. **Unique constraints** — `applications (requisition_id, candidate_id)` and
   `proposals (project_id, expert_id)` are only de-duplicated in code. Add unique indexes in a
   `003_` migration after checking production for existing duplicates.
4. **Env validation** at startup (`ConfigModule.forRoot({ validationSchema })` or a zod schema), so a
   missing `JWT_SECRET` or `AI_JWT_SECRET` fails at boot, not on first request.
5. **Tests.** There are none. Start with service tests for auth, tenancy checks and the
   interview result sink; add API e2e against a disposable Postgres (as used for this pass).
6. **API lint.** `apps/api` has a `lint` script but no ESLint installed or configured.
7. **CI**: typecheck + lint + build + tests on every PR.
8. **Feature flags** are only written to the audit log (`POST /admin/flags`); they need a table.
