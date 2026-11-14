# ASTEAI_REDO_SPEC.md

Rebuild blueprint for `asteai-redo`. Source of truth = live audit of `https://www.asteai.com` (2026-11-12) + legacy code (`D:\Asteai\deeptech_frontend`, `deeptech_backend`, `deeptech_ai`) + current redo state (`apps/web` Next.js 14, `apps/api` NestJS 10, `packages/db` SQL migrations 001–014).

Legend: **Live** = observed on production. **Redo** = status in this repo: ✅ exists · 🟡 partial · ❌ missing.

---

## 0. Live Deployment Facts

| Item | Observed |
|---|---|
| Frontend host | S3 + CloudFront, Vite SPA (React 18, react-router 6), single `index.html` (113 KB, prerendered shell), `rolldown` chunks, 6 split CSS files |
| Canonical host | `https://asteai.com` (sitemap/canonical/OG) but users land on `www.asteai.com` — no redirect between them (both 200) |
| API hosts | `https://backend.asteai.com/api/*` (Express) **and** `https://api.asteai.com/api/help-desk/categories` (2 origins) |
| AI service | `VITE_AI_URL` → FastAPI `deeptech_ai` (interviews, assessments, translation, semantic search) |
| Envelope | `{ success: boolean, data: T }` / `{ success:false, message }` |
| Auth transport | Bearer JWT (localStorage) + refresh; `GET /api/profile/me` fired on **every** page, incl. anonymous (401 noise) |
| Security headers | **Frontend: none** (no CSP/HSTS/XFO on CloudFront). Backend (helmet): CSP, HSTS 1y, CORS allow-list `https://www.asteai.com` + credentials |
| Consent | Termly CMP (`app.termly.io` resource-blocker, id `bf9b135b-…`), banner: Preferences / Decline / Accept |
| Bot protection | Cloudflare Turnstile on login/register/OTP (`cf-turnstile-response`); honeypot `website` field on contact + newsletter |
| Analytics | PostHog (consent-gated), New Relic browser (consent-gated), Sentry, deferred analytics chunk |
| Payments | Razorpay (subscriptions, credits, escrow), PayPal button on `/hire/pricing` |
| i18n | i18next, `/locales/{lng}/translation.json` |
| Theme | Dark default (`html.dark`), light supported; `theme-color #03010a` |

### Live defects to fix in redo
| # | Defect | Fix |
|---|---|---|
| D1 | "Submit a Requirement" modal (landing CTA, 3 steps) **fakes submission** (`setTimeout 800ms`) — leads are lost | Real `POST /api/leads` + email to sales |
| D2 | Pages missing per-route meta (title = `ASTEAI`, default desc): `/for-experts`, `/experts`, `/services`, `/products`, `/login`, `/register`, `/hire/pricing`, `/hire/company-auth` | Per-route `generateMetadata` |
| D3 | Public jobs board shows test data (`captian`, `test`, `a`, `test engineer`) | Moderation flag + seed hygiene; hide `is_test` tenants |
| D4 | `/experts` renders "No Experts" for anon users | Public expert list endpoint w/o auth; SSR |
| D5 | `www` vs apex both serve 200; sitemap uses apex | 301 `www → apex` (or vice-versa) at edge |
| D6 | No security headers on HTML | CSP/HSTS/XFO/Referrer-Policy/Permissions-Policy at edge or Next middleware |
| D7 | Two API origins + anonymous `/profile/me` call | Single API origin; skip `me` when no session cookie |
| D8 | Pricing duplicated & inconsistent: `/pricing` (Free/Pro ₹499/Ent ₹1499) vs `/hire/pricing` (Free/Pro/Pro Plus/Enterprise) | One pricing source (`GET /api/plans`), two audiences as tabs |
| D9 | Homepage FAQ/Service JSON-LD describe old "DeepTech marketplace" positioning; H1 is "Hiring, delivered." | Regenerate structured data from current copy |
| D10 | Twitter handle mismatch: meta `@AsteaiDeeptech`, footer `x.com/AsteAiAsteAi` | Single constant |
| D11 | 30+ legacy alias routes resolved client-side (`<Navigate>`) → soft 200s | Server-side 301s (Next `redirects()`) |

---

## 1. Sitemap & Route Inventory

### 1a. Public / marketing (indexable)

| Live Route | Redo Route | Page Purpose | Auth | Key Components | Data Dependencies | Redo |
|---|---|---|---|---|---|---|
| `/` | `/` | Landing: hero "Hiring, delivered.", 3 tracks (Technical/Professional/Frontline), Talent Passport, How we deliver, 3 journeys, testimonials, final CTA | No | MegaNav, DeliveryHero, TrackCards, PassportShowcase, HowWeDeliver, ThreeJourneys, Testimonials, SubmitRequirementModal, CertificateVerifyInline, NewsletterForm, SiteFooter | `POST /leads`, `GET /certificates/verify/:id`, `POST /newsletter` | 🟡 |
| `/for-companies` | `/for-companies` | Enterprise hiring landing: 6 value props, 5-step "Live Enterprise Workflow", FAQ, CTA "Start Enterprise Setup" | No | Hero, FeatureGrid, Stepper, FAQAccordion, CTA→`/auth/register?role=Employer` | none (static) | ❌ |
| `/for-experts` | `/for-experts` | Candidate/expert login+pitch (renders CandidateAuthPage) | No | AuthCard (login), BenefitList | auth | ❌ (make a landing, not a login clone) |
| `/hire/jobs` | `/jobs` | Public job board, filters, "Load More" | No (optional) | JobCard, FilterSheet, InfiniteList | `GET /jobs/public` | ❌ |
| `/hire/jobs/:id` | `/jobs/[id]` | Job detail + Apply CTA | No | JobHeader, Requirements, SalaryBadge, ApplyCTA, JobPosting JSON-LD | `GET /jobs/public/:id` | ❌ |
| `/pricing` | `/pricing` | Plans Free ₹0 / Pro ₹499/mo / Enterprise ₹1499/mo, credits overview, credit cost table, FAQ | No | PlanCard, CreditCostTable, FAQAccordion, OfferBanner, RazorpayCheckout | `GET /plans`, `GET /public-settings/credits`, `POST /subscriptions/checkout` | 🟡 |
| `/hire/pricing` | `/pricing?audience=employer` | Employer plans Free/Pro/Pro Plus/Enterprise, coupon "Apply", Razorpay + PayPal, Contact Sales | No | same + CouponInput | same | ❌ |
| `/how-it-works` | `/how-it-works` | Tabs For Buyers / For Experts; 7 steps; protections; FAQ | No | Tabs, Stepper, FeatureGrid, FAQAccordion | `GET /public-settings/credits` | ✅ |
| `/blog` | `/blog` | 6 posts list | No | PostCard grid | static (`features/content`) | ✅ |
| `/blog/:slug` | `/blog/[slug]` | Article (markdown), share | No | Prose, ShareButton, Article JSON-LD | MDX | ❌ |
| `/case-studies` | `/case-studies` | 3 case studies | No | CaseCard | static MDX | ❌ |
| `/case-studies/:slug` | `/case-studies/[slug]` | Case study | No | Prose | MDX | ❌ |
| `/marketplace` | `/marketplace` | "Enterprise AI Talent Sourcing": open projects w/ filters (work mode, job type, experience, dept, date), sort, "AI Matches" | No (AI match needs auth) | SearchBar, FilterChips, ProjectCard | `GET /projects/open` | 🟡 (`/platform/market` is authed) |
| `/experts` | `/experts` | Expert discovery: domains, rate range, sort, "Chat with AI" (15 cr), "AI Search" (15 cr) | No (AI needs auth) | ExpertCard, RangeSlider, AISearchDialog | `GET /profiles?type=expert`, `GET /currency/rates`, `POST /ai/search` | ✅/🟡 |
| `/experts/:id` | `/experts/[id]` | Public expert profile | No | ProfileHeader, Skills, Reviews, Services | `GET /profiles/:userId` | ✅ |
| `/experts/leaderboard` | `/experts/leaderboard` | Leaderboard | Yes | Table | `GET /rankings` | ❌ |
| `/clients/:id` | `/clients/[id]` | Public client profile | No | ProfileHeader | `GET /profiles/:userId` | ❌ |
| `/services` | `/services` | Gig marketplace: free-text search, category select, quick filters (≤3d, ≤1d, ≤₹5k) | No | SearchBar, QuickFilterChips, GigCard | `GET /services` | 🟡 (authed only) |
| `/services/:id` | `/services/[slug]` | Gig detail + packages + order | Yes (live) → make public view | PackageTabs, OrderCTA | `GET /services/:slug` | 🟡 |
| `/products` | `/products` | Digital product catalog ("Sign In to Access") | No | ProductCard | `GET /products` | ❌ |
| `/products/:id` | `/products/[id]` | Product detail + purchase | No | — | `GET /products/:id` | ❌ |
| `/about-us` | `/about` | Mission, offer | No | Prose | static | ✅ (+301) |
| `/contact-us` (`?demo=1`) | `/contact` | Contact form (name, email, subject, message) + intent `demo`; business hours, address | No | ContactForm | `POST /contact` | 🟡 (no submit) |
| `/careers` | `/careers` | 3 open roles + apply form | No | RoleCard, CareerForm | `POST /careers/applications` | ❌ |
| `/verify/:id` | `/verify/certificate/[id]` | Certificate verification | No | VerifyResult | `GET /certificates/verify/:id` | ✅ (+301) |
| `/certificate/:id` | `/certificate/[id]` | Public shareable certificate | No | CertificateCard, OG image | same | ❌ |
| `/terms` `/privacy` `/vendor-terms` `/dpa` `/msa` `/cookie-policy` `/refund-policy` `/cancellation-policy` | `/legal/[slug]` | Legal docs (markdown) | No | LegalPageLayout, TOC | MD files | ✅ (+301 each) |
| `/do-not-sell-my-info` | `/legal/do-not-sell` | CCPA opt-out info + request steps | No | Prose | static | ❌ |
| `/consent-preferences` | `/consent-preferences` | Accept All / Reject All / Save | No | ConsentToggles | local + `POST /users/me/consents` (if authed) | 🟡 (`/platform/privacy`) |
| `/unsubscribe` | `/unsubscribe` | Email unsubscribe (token) | No | Result | `POST /email/unsubscribe` | ❌ |
| `*` | `not-found.tsx` | 404 | No | — | — | 🟡 |

### 1b. Auth

| Live Route | Redo Route | Purpose | Redo |
|---|---|---|---|
| `/login` | `/auth/login` | Email+password, remember me, Turnstile, Google, GitHub, forgot link | 🟡 (no OAuth/Turnstile) |
| `/register` | `/auth/register` | 2-step: email → **OTP** (6 digits) → name/password; Google/GitHub | 🟡 (no OTP-first) |
| `/hire/company-auth`, `/hire/register`, `/hire/login` | `/auth/register?role=Employer` | Employer signup ("Hire Smarter") | ❌ |
| `/hire/candidate-auth` | `/auth/register?role=Candidate` | Candidate signup | ❌ |
| `/forgot-password` | `/auth/forgot` | Email reset link | ✅ |
| `/reset-password` | `/auth/reset` | Token + new password | ✅ |
| `/verify-otp` | `/auth/verify-email` | OTP entry | ✅ |
| `/verify-2fa` | `/auth/2fa` | TOTP step-up | ✅ |
| `/auth/callback` | `/auth/callback` | OAuth return | ❌ |
| `/hire/invite-accept` | `/auth/invite` | Team invite accept | ❌ |

### 1c. Authenticated app (live → redo `/platform/*`)

| Live Route | Redo Route | Roles | Redo |
|---|---|---|---|
| `/dashboard` | `/platform` (role redirect) | any | ✅ |
| `/hire/workspace`, `/hire/workspace/new` | `/platform` (Employer), `/platform/team` | Employer | ✅ |
| `/hire/company/jobs`, `/hire/jobs/new`, `/hire/jobs/:id/edit` | `/platform/requisitions` | Employer | ✅ |
| `/hire/company/applications`, `/hire/jobs/:id/pipeline`, `/hire/jobs/:id/screening` | `/platform/applications`, `/platform/pipeline` | Employer | ✅ |
| `/hire/talent-crm` | `/platform/pools` | Employer | ✅ |
| `/hire/bulk-email`, `/hire/outreach`, `/hire/social/accounts` | `/platform/outreach`, `/platform/mkt/*` | Employer/Admin | 🟡 |
| `/hire/sourcing` | `/platform/sourcing` | Employer | ❌ |
| `/hire/featured-experts` | `/platform/experts` | Employer | ✅ |
| `/hire/interviews/:id/summary`, `/hire/applications/:id/{assessment,nt-assessment,interview}-results` | `/platform/interviews`, `/platform/applications/[id]` | Employer | 🟡 |
| `/hire/candidate/dashboard`, `/hire/my-applications`, `/hire/applications/:id` | `/platform`, `/platform/applications` | Candidate | ✅ |
| `/hire/candidate/profile`, `/profile`, `/profile/skills` | `/platform/profile` | any | ✅ |
| `/hire/jobs/:id/apply` | `/jobs/[id]/apply` | Candidate | ❌ |
| `/hire/assessments/:id{,/waiting,/results}`, `/hire/nt-assessments/:id` | `/platform/assess`, `/platform/assessment-sessions` | Candidate | ✅ |
| `/hire/interviews/:id`, `/hire/mock-interview{,/results,/results/:id}`, `/hire/frontline-interview` | `/platform/ai-interviews` | Candidate | 🟡 (frontline voice ❌) |
| `/coding-challenge{,/:languageId}` | `/platform/code` | Candidate/Freelancer | ❌ |
| `/expert/certificates` | `/platform/certificates` | Candidate/Freelancer | ✅ |
| `/projects`, `/projects/new`, `/projects/:id{,/edit,/proposals,/document-verification,/create-assessment}` | `/platform/projects` | Buyer/Freelancer | ✅ |
| `/proposals` | `/platform/proposals` | Freelancer | ✅ |
| `/expert/services{,/new,/:id/edit}` | `/platform/my-services` | Freelancer | ✅ |
| `/orders`, `/orders/:id`, `/expert/gig-orders` | `/platform/orders` | Buyer/Freelancer | ✅ |
| `/expert/products{,/new,/:id/edit}`, `/my-product-orders` | `/platform/products` | Freelancer/Buyer | ❌ |
| `/contracts`, `/contracts/:id` | `/platform/contracts` | Buyer/Freelancer | ✅ |
| `/wallet` | `/platform/wallet`, `/platform/payouts`, `/platform/invoices` | Buyer/Freelancer | ✅ |
| `/subscription/manage` | `/platform/billing` | any | ✅ |
| `/messages` | `/platform/messages` | any | ✅ |
| `/settings`, `/settings/security` | `/platform/security`, `/platform/privacy` | any | ✅ |
| `/support`, `/hire/support` | `/platform/support` | any | ❌ |
| `/admin/*` (35 routes: users, help-desk, expert verification, projects, contracts, disputes, reports, financials, leaderboards, analytics×5, credits, expert-payouts, image-generation, llm-tokens, sourcing, settings, education, mock-interviews, candidate-assessments, enterprise/{companies,jobs,applications}) | `/platform/admin`, `/platform/{auditlog,flags,trust,integrity,tenants,expert-approvals,service-approvals,disputes,payouts,analytics}` | Admin | 🟡 (help-desk, LLM tokens, sourcing stats, education ❌) |

### 1d. Redirect map

Implemented in `apps/web/redirects.js` (wired via `next.config.js` `redirects()`, all permanent/308, query strings pass through) and guarded by `apps/web/src/redirects.spec.ts` (no duplicates, no chains, every destination is a real page, no literal page shadowed). Highlights:

```
/about-us→/about  /contact-us→/contact  /terms→/legal/terms  /privacy→/legal/privacy  /vendor-terms→/legal/vendor
/dpa→/legal/dpa  /msa→/legal/msa  /cookie-policy→/legal/cookies  /refund-policy→/legal/refunds
/cancellation-policy→/legal/cancellation  /do-not-sell-my-info→/legal/do-not-sell  /return-policy,/shipping-policy→/legal/terms
/verify/:id→/verify/certificate/:id  /certificate/:id→/verify/certificate/:id
/hire/jobs→/jobs  /hire/jobs/:id(/apply)→/jobs/:id  /hire/jobs/new,/jobs/new,/hire/jobs/:id/*→/platform/requisitions
/login→/auth/login  /register→/auth/register  /forgot-password→/auth/forgot  /reset-password→/auth/reset
/verify-otp→/auth/verify-email  /verify-2fa→/auth/login (2FA is a sign-in step, not a page)
/hire,/employers,/companies,/institutions→/for-companies  /for-interviewers→/for-experts  /opportunities→/jobs
/join,/talent,/candidates,/candidate-auth,/hire/candidate-auth→/auth/register?role=Candidate
/company-auth,/hire/company-auth,/hire/register→/auth/register?role=Employer  /hire/login→/auth/login
/hire/pricing→/pricing?audience=employer  /talent-passport→/#passport  /assessment-framework,/assessments→/#assessments
/how-we-deliver→/how-it-works  /journeys,/three-journeys→/#journeys  /interview,/hire/mock-interview/*→/platform/ai-interviews
/dashboard→/platform  /settings/*→/platform/security  /messages→/platform/messages  /wallet→/platform/wallet
/projects/*→/platform/projects  /orders/:id→/platform/orders/:id  /contracts/:id→/platform/contracts/:id  /admin/*→/platform/admin
www.asteai.com/* → https://asteai.com/* (host rule in Next; also set at the CDN edge)
```

---

## 2. End-to-End Feature & User Flow Breakdown

### F1. Global navigation
- **Flow:** Header mega-menu with 3 audience triggers → panels:
  - *Hire & ATS*: ATS Overview `/hire/workspace`, Requisitions, Applications Pipeline, Talent CRM, Bulk Outreach, AI Job Creator, Manage Projects, Gig Orders, Product Purchases, Contracts.
  - *Careers & AI Prep*: Browse Live Openings, Career Command Center, My Applications, AI Interview Studio, Railway & Trades Interview, Code Challenges, Profile & Vetting, Digital Certificates.
  - *Talent Sourcing*: Find Top Experts, Projects & Milestones, Pre-Packaged Services, Escrow Contracts, Active Orders, Wallet & Credits.
  - Right: Pricing, Sign In, Sign Up. Authed → avatar menu.
- **Edge:** anon click on protected link → `/auth/login?next=<path>` → return after login (legacy `postLoginRedirect`). Role mismatch → 403 page with "switch role".
- **Redo upgrades:** keyboard-navigable menu (`aria-expanded`, Esc closes, roving focus); mobile = full-screen drawer with accordion per audience; replace emoji icons with SVG icon set; hide app-only links for anon users (show marketing equivalents).

### F2. Submit a Requirement (lead capture) — **D1**
- **Flow:** CTA (hero/final CTA/track cards) → modal Step 1: Track (`technical|professional|frontline`), Role title* → Step 2: Skills/requirements (textarea), Work mode (`remote|hybrid|onsite`), Timeline (`immediate <48h|2weeks|flexible`) → Step 3: Company*, Contact name*, Work email*, Phone* → Submit → success state → reset/close.
- **Validation:** required as marked; email RFC + block free/temp domains (warn, not block, for gmail); phone E.164 (libphonenumber); role 3–120 chars; honeypot `website`; Turnstile invisible.
- **Edge:** network fail → keep data, inline retry (legacy silently "succeeded"); Esc/backdrop close → confirm if dirty; double-submit guard.
- **Redo upgrades:** persist to `leads`, notify sales (email + Slack webhook), auto-reply to submitter, UTM capture, PostHog event `lead_submitted`; focus-trap dialog (Radix-like), step progress `aria-current`, deep-link `/?requirement=open&track=frontline`.

### F3. Auth (register / login / OTP / OAuth / 2FA)
- **Register flow (live):** choose role (via entry point: company-auth→employer, candidate-auth→candidate) → email + Turnstile → `POST /auth/email/send-otp` → 6-digit OTP → `POST /auth/email/verify-otp` → first/last name, password, confirm → account created + tokens → redirect `returnTo` or role home.
- **Login:** email, password, remember-me, Turnstile → `POST /auth/login` → if 2FA enabled → `/auth/2fa` (TOTP) → home. OAuth: Google (button + One Tap), GitHub → `/auth/callback` → session exchange.
- **Password rules (live UI):** live checklist; submit disabled until all met + passwords match. Spec: ≥10 chars, upper, lower, digit, symbol, not in breached list (k-anon HIBP optional).
- **Edge:** OTP expiry 10 min, 5 attempts then lock 15 min, resend cooldown 60 s; existing email on register → "log in instead" (no enumeration in message timing); deactivated account → `/auth/reactivate`; Turnstile fail → reset widget.
- **Redo state:** has register/login/refresh/logout, forgot/reset, verify-email, 2FA, sessions. **Missing:** OTP-first register, Google/GitHub OAuth, Turnstile, role switch (`/auth/switch-role`), admin invite accept, reactivate.
- **Redo upgrades:** httpOnly `Secure; SameSite=Lax` refresh cookie (no tokens in localStorage), access token in memory; one auth page component with `role` query param instead of 4 clones; `autocomplete="one-time-code"` + paste-to-fill OTP.

### F4. Public job board → apply
- **Flow:** `/jobs` → `GET /jobs/public?limit=20&offset=0&location&location_type&department&salary_min&salary_max&employment_type` → cards (title, company, logo, location_type, location, salary range+currency, employment_type, posted date, application_count) → Filters sheet → "Load More" (offset) → `/jobs/[id]` → Apply → (anon) register as Candidate → `/jobs/[id]/apply` → form (resume upload, autofill summary via AI, screening Qs) → `POST /applications/:reqId/apply` → status `applied` → assessment invite (deadline `assessment_deadline_hours`=48) → AI interview (`interview_deadline_hours`=48).
- **Validation:** non-`published` job → 404 for anon, visible to company members; duplicate apply → 409 (migration 003 unique); reapply blocked for `reapply_after` days (180); expired (`expires_at`) → closed banner.
- **Empty:** "No roles match" + clear filters; zero jobs → newsletter prompt.
- **Redo upgrades:** SSR + ISR(60s) for SEO; `JobPosting` JSON-LD; URL-synced filters; cursor pagination; hide test tenants (D3); salary formatted per currency (`Intl.NumberFormat`).

### F5. Pricing & subscription checkout
- **Flow:** `/pricing` → plan cards (Free ₹0; Pro ₹499/mo, 100 credits/mo; Enterprise ₹1499/mo, 300 credits/mo) → "Get Started"/"Start Free Trial" → anon→register → authed → `POST /subscriptions/order {tier, coupon?}` → Razorpay Checkout (prefill name/email) → `POST /payments/razorpay/verify` → webhook `subscription.activated` → `/platform/billing`. Employer audience: Free/Pro/Pro Plus/Enterprise + coupon "Apply" + PayPal + "Contact Sales" → `/contact?intent=demo`.
- **Credit costs (display table):** Expert autofill 15, Chat-with-AI expert finder 15, AI search 15, Voice search 3, Create gig via AI 15, Create project via AI 15, Semantic gig search 6, Project recs 6, Proposal 3–12 (budget tiers 5k/25k/100k), Dispute 3. Bonuses: welcome 5, referral 10 (max 3).
- **Edge:** first-purchase offer discount must equal label (legacy bug note); payment cancel → toast, no state change; webhook idempotency by `razorpay_payment_id`; already subscribed → "Manage plan".
- **Redo upgrades:** plans + credit costs served from `GET /plans` & `GET /public-settings/credits` (single source, D8); monthly/annual toggle; currency by geo (`GET /geo`) with INR default.

### F6. Contact / demo request
- **Flow:** `/contact` (`?intent=demo` prefills message "Hi, I'd like to book an enterprise demo…", scrolls to form) → name, email, subject, message → `POST /contact {name,email,subject,message,intent:'contact'|'demo',website}` → success toast + inline state → reset.
- **Validation (live, keep):** name 2–120, email ≤254 valid, subject 3–200, message 10–5000; focus first invalid field; block temp-mail domains; rate limit (public form limiter); honeypot drops silently (200).
- **Error copy:** fallback "email supportasteai@startrit.com".
- **Redo upgrades:** server-side zod/class-validator mirror; send to support inbox via email outbox (migration 005) + auto-ack; `aria-describedby` errors.

### F7. Newsletter (footer, every marketing page)
- **Flow:** email + hidden `website` → `POST /newsletter/subscribe` → "Subscribed" for 4 s → double opt-in email → `/unsubscribe?token`.
- **Validation:** email required; temp-mail blocked; already-subscribed → 200 idempotent.

### F8. Careers apply
- **Flow:** `/careers` → roles (Product Engineer (Tech & AI), Workforce Operations Lead, Customer Support & Success) → "Apply" scrolls + preselects role → fullName*, email*, role*, profileUrl (LinkedIn/GitHub), message → `POST /careers/applications` → toast.
- **Redo upgrades:** roles from CMS/DB (`career_roles`), resume upload (S3 presigned, PDF ≤5 MB), url validation.

### F9. Certificate verify & share
- **Flow:** landing "Verify" input or `/verify/certificate/[id]` → `GET /certificates/verify/:id` → valid (holder, title, score/tier, issued_at, issuer) / revoked / not found. `/certificate/[id]` = shareable page with OG image + LinkedIn "Add to profile" link.
- **Redo upgrades:** dynamic OG image (`next/og`), `EducationalOccupationalCredential` JSON-LD, QR on PDF.

### F10. Marketplace / experts / services discovery
- **Flow:** search text + filters → list (cards) → detail → CTA (hire/order/propose) → auth gate. AI features (chat finder, AI search, voice search) deduct credits with confirm dialog showing cost; refund on AI failure.
- **Empty:** `/experts` "No Experts" (D4) — must show public verified experts; zero-result → suggest broadening filters.
- **Redo upgrades:** public read endpoints with SSR; filter state in URL; skeletons; `currency/rates` cached 1 h at edge.

### F11. Consent & privacy
- **Flow:** first visit → banner (Preferences / Decline / Accept) → choices stored (cookie `asteai_consent` v1: `{necessary:true, analytics, marketing, functional, ts}`) → gate PostHog/New Relic/Sentry replay; `/consent-preferences` page with Accept All / Reject All / Save; authed users sync to `POST /users/me/consents`. GPC header respected = marketing off.
- **Redo upgrades:** drop Termly (third-party script + CSP surface) or keep but load after LCP; own lightweight banner (redo already has `lib/consents.ts`).

### F12. Authed core flows (exist in redo — keep parity)
| Flow | Trigger → state → destination | Redo |
|---|---|---|
| Requisition → fund → pipeline | Employer creates req (AI Job Creator) → `PATCH /requisitions/:id/fund` (credits) → publish → applications stage moves → scorecards | ✅ |
| Assessment session | Candidate starts (`POST /assessments/sessions`, 10/min) → answer loop → IRT score via deeptech_ai → integrity queue → Passport update | ✅ |
| AI mock interview | `POST /interviews/mock` → session → ai-results webhook (`AiResultsKeyGuard`) → assessment → certificate | ✅ |
| Frontline voice interview (vernacular) | language select → voice-only Q&A → score | ❌ |
| Coding challenge | language select → Judge0 sandbox run → score | ❌ |
| Project → proposal → contract → milestones | Buyer posts → Freelancer proposes (credits) → award → contract sign → fund milestone (Razorpay) → submit → revision/accept → release → invoice → payout | ✅ |
| Gig order | Buyer orders package → deliver → revision/accept → review | ✅ |
| Disputes | open → messages → withdraw / admin resolve (refund/release split) | ✅ |
| Messaging | chats + realtime (socket.io) + circumvention filter (contact-info masking) | ✅ |
| Help desk tickets | user ticket → admin queue | ❌ |

---

## 3. Frontend Architecture & Component Map

### 3a. Global shell
- **Header (marketing):** Logo → `/`; 3 mega-menu triggers (F1); Pricing; Sign In (ghost); Sign Up (primary). Sticky, `backdrop-blur`, height 64 px desktop / 56 px mobile. Authed: notification bell + avatar menu (Dashboard, Profile, Billing, Security, Sign out).
- **Mobile drawer:** `<dialog>`-based, full height, accordions per audience, CTA pair pinned bottom, closes on route change.
- **App shell (redo, keep):** `TopBar` (56 px) + `Rail` (230 px, collapses <1024 px to icon rail, <768 px to bottom sheet) + content.
- **Footer:** brand + socials (X, LinkedIn, Instagram, Facebook, YouTube); columns **Company** (About Us, Contact Us, AsteAI Careers, How It Works, Pricing), **Resources** (Help Center → `/platform/support` if authed else `/contact`, Blog, Case Studies), **Legal** (Privacy, Do Not Sell, Cookie, Refund, Cancellation, Terms of Usage, Vendor Agreement, MSA, DPA, Consent Preferences); newsletter "Stay in the loop"; ISO 27001 badge → modal (ISO/IEC 27001:2022 ISMS).
- **Floating:** Help-desk widget (authed), pending-actions banner (employer), AI chatbot (Buddybot).

### 3b. Design tokens
| Token | Live | Redo (`globals.css`) | Decision |
|---|---|---|---|
| bg | `#000` / `#03010a` theme-color | `--bg #03010A` | keep redo |
| fg | `hsl(0 0% 100%)` | `--fg #F4F4FA` | keep |
| muted text | `#86868b`, secondary `#a1a1a6` | — | add `--fg-muted #86868B`, `--fg-subtle #A1A1A6` |
| border | `#ffffff0a` | `--line #1F1E33` | keep |
| card | `hsl(0 0% 6.7%)` | — | add `--card #111` |
| accent | `hsl(258 90% 76%)` violet; purple-500 focus | `--blue #4D8BFF`, gold, mint, rose, amber | add `--violet #A78BFA` as brand accent |
| radius | `.75rem`; pills `rounded-full`; inputs `rounded-xl` | — | `--r-sm 8px, --r-md 12px, --r-lg 16px, --r-pill 999px` |
| fonts | Inter + Space Grotesk (self-hosted woff2, preloaded); body falls back to SF Pro | Sora / Manrope / JetBrains Mono via `next/font` | keep redo (self-hosted by next/font) |
| spacing | Tailwind 4 px scale | CSS modules | 4 px scale tokens `--s-1..--s-12` |
| motion | Lenis smooth scroll | — | drop Lenis; CSS `scroll-behavior` + `prefers-reduced-motion` |
| Light theme | supported (`dark:` variants) | dark only | add `[data-theme=light]` token set |

### 3c. Reusable components (`apps/web/src/components/ui`)
| Component | Props | State / Notes |
|---|---|---|
| `Button` | `variant: primary\|secondary\|ghost\|danger`, `size`, `loading`, `asChild/href`, `icon` | disabled while loading |
| `Input`, `Textarea`, `Select`, `Checkbox`, `RadioCards` | `label`, `name`, `error`, `hint`, `required`, `maxLength` | `aria-invalid`, `aria-describedby` |
| `OtpInput` | `length=6`, `onComplete` | paste, auto-advance |
| `PasswordField` | `rules[]`, `showChecklist` | live checklist |
| `Turnstile` | `siteKey`, `onToken`, `invisible` | reset on error; dev bypass token |
| `Honeypot` | `name="website"` | visually hidden, `tabIndex=-1` |
| `Dialog` / `Sheet` | `open`, `onOpenChange`, `title`, `size` | focus trap, Esc, scroll lock |
| `Stepper` | `steps[]`, `current` | `aria-current="step"` |
| `Accordion` (FAQ) | `items[{q,a}]`, `single` | emits FAQPage JSON-LD optionally |
| `Tabs` | `items`, `value`, `onChange` | URL-sync option |
| `Card` variants | `JobCard{job}`, `ExpertCard{profile}`, `GigCard{service}`, `ProjectCard{project}`, `ProductCard`, `PlanCard{plan, highlighted, cta}`, `PostCard{post}`, `CaseCard` | skeleton variant each |
| `FilterBar` / `FilterSheet` | `schema[]`, `value`, `onChange` | URL query sync |
| `InfiniteList` | `queryKey`, `fetchPage`, `renderItem`, `empty` | IntersectionObserver + "Load more" fallback |
| `DataTable` | `columns`, `rows`, `sort`, `pagination` | admin |
| `EmptyState` | `icon`, `title`, `body`, `action` | |
| `Toast` | `title`, `description`, `variant` | `aria-live=polite` |
| `CreditCostConfirm` | `feature`, `cost`, `balance`, `onConfirm` | blocks if insufficient → top-up |
| `ConsentBanner` | — | cookie read/write, GPC |
| `NewsletterForm` | — | honeypot, idempotent |
| `SubmitRequirementModal` | `initialTrack` | 3-step, see F2 |
| `RazorpayCheckout` | `orderId`, `prefill`, `onSuccess`, `onDismiss` | loads script lazily |
| `MegaNav`, `MobileDrawer`, `SiteFooter`, `SiteHeader` | `session?` | |
| `Prose` (MDX) | `content` | headings anchor-linked |

**Data layer:** redo uses SWR + Zustand (AGENTS.md react-query rule applies only to legacy `deeptech_frontend`). Keep SWR; single `lib/api.ts` client; public pages fetch in RSC with `fetch(..., { next: { revalidate } })`.

### 3d. SEO & metadata
- **Title pattern:** `%s | ASTEAI`; home `ASTEAI - Hiring, Delivered | Talent Delivery System`. Observed per page:

| Route | Title | Description (≤160) |
|---|---|---|
| `/` | ASTEAI - Hiring, Delivered \| Talent Delivery System | Autonomous talent delivery system … 48h fulfillment SLA across technical, professional, and frontline tracks. |
| `/for-companies` | Hire with ASTEAI — Enterprise Talent Delivery Platform | Deploy pre-assessed talent with verifiable passports … 48-hour SLA … |
| `/jobs` | Explore Open Jobs — ASTEAI Verified Opportunities | Browse high-impact technical, professional, and engineering roles … |
| `/pricing` | Pricing & Delivery Plans \| ASTEAI | Transparent talent delivery pricing with milestone escrow protection, 48h shortlist … |
| `/how-it-works` | How It Works \| ASTEAI | From requirement to verified shortlist … |
| `/blog` | ASTEAI Journal — Insights on Technical Hiring, AI & Talent Systems | Perspectives, engineering breakdowns … |
| `/blog/[slug]` | `{post.title} — ASTEAI Journal` | `post.excerpt` |
| `/case-studies` | Case Studies \| ASTEAI | How companies hire faster … |
| `/marketplace` | Enterprise AI Talent Sourcing \| ASTEAI | Verified, AI-matched engagements … |
| `/about` | About Us \| ASTEAI | Who we are … |
| `/contact` | Contact Us \| ASTEAI | Talk to the ASTEAI team … |
| `/careers` | Careers at ASTEAI | Open roles at ASTEAI … |
| `/consent-preferences` | Consent Preferences \| ASTEAI | — |
| `/legal/do-not-sell` | Do Not Sell or Share My Personal Information \| ASTEAI | — |
| **Missing (D2)** `/for-experts`, `/experts`, `/services`, `/products`, `/auth/*`, `/pricing?audience=employer` | define | define; `/auth/*` → `noindex` |

- **OG/Twitter:** `og:type website`, `og:image https://asteai.com/og-image.png` (1200×630), `og:site_name ASTEAI`, `twitter:card summary_large_image`, `twitter:site` (one handle, D10). Per-route OG via `next/og` for blog/jobs/certificates.
- **Canonical:** apex `https://asteai.com{path}`; strip query except `?page`.
- **JSON-LD:** `Organization` (logo, sameAs: all 5 socials), `EmploymentAgency` with `OfferCatalog` (Technical / Professional / Frontline tracks), `FAQPage` (per-page FAQs, generated from Accordion data), `JobPosting` (jobs), `Article`/`BlogPosting`, `BreadcrumbList`, `EducationalOccupationalCredential` (certificates). Remove stale "DeepTech marketplace" Service/FAQ blocks (D9).
- **robots.txt:** allow all; disallow `/platform/`, `/auth/`, `/api/`; `Sitemap: https://asteai.com/sitemap.xml`. Drop `Crawl-delay` (ignored by Google).
- **sitemap.xml:** all §1a routes + dynamic `/blog/*`, `/case-studies/*`, `/jobs/*` (published only), `/experts/*` (verified, opted-in). Remove `/auth/*` from current redo sitemap.
- **Meta extras:** `theme-color #03010a` (dark) / `#ffffff` (light media query), manifest, `lang` per locale + `hreflang` when i18n ships.

---

## 4. Backend & API Contract Specification

Conventions (redo, keep): prefix `/api/v1`; envelope `{ data, meta? }` / `{ error: { code, message, details? } }` via `ResponseTransformInterceptor` + `HttpExceptionFilter`; JWT bearer (15 m) + refresh (7 d, rotate, `refresh_tokens`); `@Roles()` guard; Throttler global + per-route; pagination `?limit&cursor` → `meta.nextCursor`.

### 4a. New / changed endpoints required for live parity

| Method | Endpoint | Request | Response | Auth / Rate-limit |
|---|---|---|---|---|
| POST | `/leads` | `{track:'technical'\|'professional'\|'frontline', roleTitle, skills?, workMode:'remote'\|'hybrid'\|'onsite', timeline:'immediate'\|'2weeks'\|'flexible', company, contactName, email, phone, utm?:{source,medium,campaign}, website, turnstileToken}` | `{id, status:'received'}` | Public · 5/min/IP · Turnstile |
| POST | `/contact` | `{name(2–120), email(≤254), subject(3–200), message(10–5000), intent:'contact'\|'demo', website}` | `{id}` | Public · 5/min/IP |
| POST | `/newsletter/subscribe` | `{email, website, source?}` | `{status:'pending'\|'subscribed'}` | Public · 5/min/IP |
| POST | `/newsletter/confirm` | `{token}` | `{status}` | Public |
| POST | `/newsletter/unsubscribe` | `{token}` | `{status:'unsubscribed'}` | Public |
| POST | `/careers/applications` | `{roleSlug, fullName, email, profileUrl?, message?}` | `{received:true}` | Public · 3/min/IP |
| GET | `/careers/roles` | — | `CareerRole[]` | Public · cache 300 s |
| GET | `/jobs/public` | `?limit(≤50)&cursor&q&location&locationType&department&employmentType&salaryMin&salaryMax&frontlineRole` | `{items: PublicJob[], total, nextCursor}` (shape in `apps/web/src/features/jobs/types.ts`) | Public · cache 60 s |
| GET | `/jobs/public/:id` | — | `PublicJob & {requirements[], description, applyOpen:boolean}` | Public; non-published → 404 |
| GET | `/plans` | `?audience=individual\|employer` | `Plan[]` | Public · cache 300 s |
| GET | `/public-settings/credits` | — | `{welcome_bonus_amount, referral_bonus_amount, max_referrals_per_user, proposal_budget_tier1..3, costs: Record<Feature,int>}` | Public · cache 60 s |
| GET | `/public/stats` | — | `{total_users, verified_experts, total_projects, active_projects, total_contracts, active_contracts, completed_contracts}` | Public · cache 60 s |
| GET | `/geo` | — | `{country, regionCode}` (from CloudFront `CloudFront-Viewer-Country`) | Public |
| GET | `/currency/rates` | `?base=INR` | `{base, rates:Record<ISO,number>, fetchedAt}` | Public · cache 1 h |
| POST | `/subscriptions/order` | `{planId, interval:'month'\|'year', coupon?}` | `{razorpay:{orderId\|subscriptionId,keyId,amount,currency}, finalPrice, coupon?}` | Auth · 10/min |
| POST | `/coupons/validate` | `{code, planId}` | `{valid, discountPercent, finalPrice}` | Auth · 10/min |
| GET | `/subscriptions/me` | — | `{plan, status, current_period_end, credits_remaining}` | Auth |
| POST | `/subscriptions/cancel` | `{atPeriodEnd:true}` | `{status}` | Auth |
| POST | `/auth/email/send-otp` | `{email, purpose:'register'\|'login', turnstileToken}` | `{sent:true, resendAfter:60}` | Public · 3/min/email, 10/min/IP |
| POST | `/auth/email/verify-otp` | `{email, otp}` | `{otpTicket}` (10 min) | Public · 5 attempts |
| POST | `/auth/register` (change) | `{otpTicket, firstName, lastName, password, role, tenantName?(Employer)}` | `{accessToken, user}` + refresh cookie | Public |
| POST | `/auth/login` (change) | `{email, password, remember, turnstileToken}` | `{accessToken,user}` \| `{twoFactorRequired, challengeId}` | Public · 10/min |
| GET | `/auth/oauth/:provider/start` | `?role&next` | 302 to Google/GitHub (PKCE, state) | Public |
| GET | `/auth/oauth/:provider/callback` | `code,state` | 302 → `/auth/callback#ok` + cookie | Public |
| POST | `/auth/google/one-tap` | `{credential}` | `{accessToken,user}` | Public |
| POST | `/auth/switch-role` | `{role}` | `{accessToken,user}` | Auth |
| POST | `/auth/invites/accept` | `{token, password?}` | `{accessToken,user}` | Public |
| POST | `/auth/reactivate` | `{email}` | `{sent}` | Public · 3/min |
| GET | `/certificates/:id/public` | — | `{holder, title, tier, score, issuedAt, status, ogImageUrl}` | Public |
| GET | `/profiles` (change) | `?type=expert&domain&rateMin&rateMax&sort&cursor` | `PublicProfile[]` | **Public** (verified only) |
| GET | `/services` / `/services/:slug` | existing | existing | make **Public** read |
| GET | `/products`, `/products/:id` | `?q&category&cursor` | `Product[]` | Public |
| POST/PUT | `/products`, `/products/:id` | `{title, description, price, currency, category, fileKey, license}` | `Product` | Freelancer |
| POST | `/products/:id/purchase` | — | Razorpay order | Buyer |
| GET | `/products/orders/me` | — | `ProductOrder[]` | Auth |
| POST | `/ai/search` | `{q, scope:'experts'\|'gigs'\|'projects', voice?:boolean}` | `{results[], creditsCharged}` | Auth · credits (15/6/3) · 20/min |
| POST | `/ai/expert-chat` | `{messages[]}` | stream (SSE) | Auth · 15 cr/session |
| GET | `/rankings/experts` | `?period` | `LeaderRow[]` | Auth |
| POST | `/code/runs` | `{languageId, source, challengeId}` | `{runId}` → poll `GET /code/runs/:id` | Auth · 30/min (Judge0) |
| POST | `/interviews/frontline` | `{role, language}` | `{sessionId, wsUrl}` | Candidate |
| GET/POST | `/support/tickets`, `/support/tickets/:id`, `/support/tickets/:id/messages`, `/support/tickets/:id/resolve` | `{categoryId, subject, body}` / `{body}` | `SupportTicket(Detail)` | Auth |
| GET | `/support/categories` | — | `Category[]` | Public (replaces `api.asteai.com/help-desk/categories`) |
| GET/PATCH | `/admin/support/tickets` | `?status` / `{status, assigneeId}` | | Admin |
| GET | `/admin/llm-usage` | `?from&to&model` | token/cost aggregates | Admin |
| GET | `/admin/leads` | `?status&cursor` | `Lead[]` | Admin |

### 4b. Existing redo endpoints (keep; verified in `apps/api/src/modules/*`)
`auth` (register, login, refresh, logout, password forgot/reset/change, verify-email send/verify, 2fa get/setup/enable/disable, login/2fa, sessions list/revoke) · `users/me` (get/put/delete, consents, export) · `tenants` (team, pools, outreach, credits) · `requisitions` (CRUD, fund) · `applications` (by req/candidate/me, apply, stage, scorecards) · `assessments` (sessions, answer, result, integrity-queue, admin reset) · `interviews` (catalogue, mock CRUD/session/assessment/certificate, ai-results webhook) · `passports` (me, verify, share) · `certificates/verify/:id` · `profiles` · `projects` (open, mine, assigned, stage, milestones) · `proposals` (award) · `contracts` (sign/decline/cancel/refund, milestones fund/submit/revision/accept/release) · `gigs` (services CRUD/packages/submit/pause/resume; admin status; orders deliver/revision/accept/cancel/review) · `payments/razorpay` (verify, webhook) · `payments/unapplied` (admin refund) · `invoices` (+pdf) · `payouts` (account, request, admin approve/mark-paid/reject) · `ledger` (wallet, entries) · `disputes` · `chats` · `notifications` · `analytics/employer` (dashboard, fairness) · `admin` (stats, audit, flags, trust) · `assistant/command` · `voice` (translate, detect) · `health` (`livez`, `readyz`).

### 4c. Core data models (new tables; existing 001–014 retained)

```sql
leads(id uuid pk, track text check in('technical','professional','frontline'), role_title text not null,
  skills text, work_mode text, timeline text, company text not null, contact_name text not null,
  email citext not null, phone text not null, utm jsonb, ip inet, user_agent text,
  status text default 'new' check in('new','contacted','qualified','won','lost'), owner_id uuid fk users,
  created_at timestamptz default now())
contact_messages(id, name, email citext, subject, message, intent text check in('contact','demo'),
  status text default 'open', ip inet, created_at)
newsletter_subscribers(id, email citext unique, status text check in('pending','subscribed','unsubscribed'),
  source text, confirm_token_hash text, confirmed_at, unsubscribed_at, created_at)
career_roles(id, slug unique, title, team, location, type, description_md, is_open bool, sort int)
career_applications(id, role_id fk, full_name, email citext, profile_url, message, resume_key, created_at)
plans(id text pk, audience text, name, price_minor int, currency char(3), interval text,
  monthly_credits int, features jsonb, razorpay_plan_id text, is_active bool, sort int)
subscriptions(id, user_id|tenant_id fk, plan_id fk, status text, razorpay_subscription_id unique,
  current_period_start, current_period_end, cancel_at_period_end bool, created_at)
coupons(code pk, discount_percent int check 1..100, plan_ids text[], max_redemptions int,
  redeemed int default 0, first_purchase_only bool, expires_at)
credit_costs(feature text pk, cost int)   -- seeds: expert_autofill 15, ai_chat 15, ai_search 15, voice_search 3,
                                          -- ai_gig 15, ai_project 15, semantic_gig 6, project_recs 6, dispute 3
platform_settings(key text pk, value jsonb)  -- welcome_bonus 5, referral_bonus 10, max_referrals 3, proposal tiers
email_otps(id, email citext, purpose text, code_hash text, attempts int default 0, expires_at, consumed_at)
oauth_accounts(id, user_id fk, provider text, provider_user_id text, unique(provider, provider_user_id))
invites(id, tenant_id fk, email, role, token_hash, expires_at, accepted_at)
products(id, seller_id fk users, slug unique, title, description, category, price_minor, currency,
  file_key, license text, status text check in('draft','pending','active','paused','rejected'), created_at)
product_orders(id, product_id fk, buyer_id fk, amount_minor, currency, razorpay_order_id, status, download_count, created_at)
support_categories(id, name, sort) ; support_tickets(id, user_id, category_id, subject, status, assignee_id, created_at)
support_messages(id, ticket_id fk, author_id, body, created_at)
code_runs(id, user_id, challenge_id, language_id int, source text, status, judge0_token, result jsonb, created_at)
llm_usage(id, user_id, feature, model, input_tokens int, output_tokens int, cost_minor int, created_at)
-- jobs: add requisitions.is_public bool, expires_at, reapply_after_days int default 180,
--       assessment_deadline_hours int default 48, interview_deadline_hours int default 48,
--       employment_type, location_type, frontline_role; tenants.is_test bool default false
```

**PublicJob** (response shape, from live): `{id, companyId, title, department, description, locationType:'onsite'|'remote'|'hybrid', location, salaryMin, salaryMax, salaryCurrency, requirements:string[], status, expiresAt, createdAt, updatedAt, reapplyAfterDays, assessmentDeadlineHours, interviewDeadlineHours, employmentType:'full_time'|'part_time'|'contract'|'internship', frontlineRole|null, company:{name, logoUrl, website}, applicationCount:int}` (numbers as numbers — live returns strings).

**Relationships:** users 1–n oauth_accounts · tenants 1–n requisitions 1–n applications n–1 users · applications 1–n assessment_sessions / ai_interviews → passports/certificates · users(Buyer) 1–n projects 1–n proposals → contracts 1–n milestones → ledger_entries/invoices/payouts · services 1–n packages 1–n gig_orders · products 1–n product_orders · subscriptions n–1 plans.

### 4d. External integrations & security

| Concern | Requirement |
|---|---|
| Payments | Razorpay Orders + Subscriptions + webhooks (HMAC verify, idempotent on event id); PayPal (employer plans) — optional Phase 4; INR primary, multi-currency display via `/currency/rates` |
| Email | Email outbox (migration 005) + worker → SES (or existing provider); templates: OTP, verify, reset, lead-ack, contact-ack, newsletter confirm, invite, application status, assessment invite (48 h deadline), payout, invoice. All with `List-Unsubscribe` header |
| Auth providers | Google OAuth2 (+ One Tap), GitHub OAuth; PKCE + `state`; link by verified email |
| Bot protection | Cloudflare Turnstile server-verify (`siteverify`) on: send-otp, login, register, leads, contact, newsletter, careers; honeypot `website`; temp-mail domain blocklist |
| AI | `deeptech_ai` FastAPI (`AI_BASE_URL`): IRT scoring, mock/frontline interviews (voice + WebSocket), translation, semantic search, Judge0 code runner; inbound results via `x-ai-results-key` header (existing guard); log tokens → `llm_usage` |
| Realtime | socket.io (chats, notifications) — WS origin must be in CSP `connect-src` |
| Storage | S3 presigned PUT (resumes, product files, avatars); private bucket; product downloads via signed GET (5 min) |
| Analytics | PostHog (EU/US host via env), New Relic browser, Sentry — all **consent-gated**; server events: `lead_submitted`, `signup_completed`, `checkout_started`, `purchase_completed`, `application_submitted` |
| CORS | allow-list `https://asteai.com`, `https://www.asteai.com` (until redirect), preview domains via env; `credentials: true`; methods GET/POST/PUT/PATCH/DELETE |
| CSP (web, via Next middleware w/ nonce) | `default-src 'self'; script-src 'self' 'nonce-…' https://challenges.cloudflare.com https://checkout.razorpay.com https://accounts.google.com/gsi/client; connect-src 'self' https://api.asteai.com wss://api.asteai.com https://*.posthog.com https://bam.nr-data.net https://*.ingest.sentry.io https://lumberjack.razorpay.com; frame-src https://challenges.cloudflare.com https://api.razorpay.com https://checkout.razorpay.com https://accounts.google.com; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` — no `unsafe-eval`, remove localhost ws entries present in live backend CSP |
| Other headers | HSTS `max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`, `Permissions-Policy camera=(self), microphone=(self), geolocation=()` (mic/cam needed for interviews) |
| Cookies | refresh: `__Host-rt; HttpOnly; Secure; SameSite=Lax; Path=/`; consent: `asteai_consent` (1 y, not HttpOnly); CSRF: double-submit token on cookie-auth mutations |
| Rate limits | Global 100/min/IP; public forms 5/min/IP; auth per table above; AI 20/min/user; webhooks exempt (signature-verified) |
| Privacy | GDPR/DPDP: export (`POST /users/me/export` ✅), delete (`DELETE /users/me` ✅), consent log, CCPA "Do Not Sell" page, GPC honored |

---

## 5. Phased Build Plan (`asteai-redo`)

Each phase = one session. Exit gate per phase: `bun run typecheck && bun run lint && bun run test && bun run build` green; Lighthouse (mobile) ≥ 90 perf/a11y/SEO on touched public pages.

### Phase 1 — Core Shell & Routing ✅ (2026-11-12)
- [x] Tokens: `--violet`, `--card`, `--on-accent`, alpha surfaces (`--header-bg`, `--glow-*`, `--shadow-lg`, `--overlay`), radius + 4px spacing scales; light theme (`:root[data-theme=light]`), no-flash init script + `ThemeToggle` (localStorage `asteai-theme`, OS fallback). Fixed pre-existing font bug (next/font vars renamed to `--font-sora/--font-manrope/--font-jetbrains`; the old self-referencing `--font-display` cycle rendered everything in Times).
- [x] `SiteHeader` audience mega-menus (`features/marketing/MegaNav.tsx`, `nav.ts`) + mobile sheet drawer; `SiteFooter` with Company/Product/Resources/Legal, socials (`lib/site.ts`), ISO badge dialog, consent link. Newsletter form deferred to Phase 3 with its endpoint (no fake submit).
- [x] UI kit (`components/ui/kit.tsx`): `Dialog` (+sheet), `Accordion`, `Tabs`, `OtpInput`, `PasswordField`, `Honeypot`, `ToastProvider/useToast`, `ThemeToggle`; plus `Stepper`, `Skeleton`, `EmptyState` in `index.tsx`. `FilterBar` = plain GET forms on listing pages.
- [x] Routes: `/for-companies`, `/for-experts`, `/careers` (apply by email until Phase 3), `/blog`, `/blog/[slug]`, `/case-studies`, `/case-studies/[slug]` (content ported to `features/content`), `/jobs`, `/jobs/[id]` (wired to Phase 2 `GET /jobs/public`; show an unavailable notice until then), `/marketplace` (overview; public listing Phase 3), `/services` (SSR from the existing public `GET /services`), `/products` (wired to Phase 2 `GET /products`), `/consent-preferences` (cookie `asteai_consent`, GPC-aware, tested), `not-found.tsx`, `error.tsx`. `/legal/do-not-sell` already existed. `/certificate/[id]` is a redirect for now (share page with OG image in Phase 4). `/unsubscribe` moves to Phase 3 with its endpoint.
- [x] Redirect map (§1d) + `www→apex`; sitemap (all public pages + posts + case studies, no `/auth`), robots (`/platform`, `/auth/`, `/api/` disallowed).
- [~] Landing: kept the redo's existing sections (no redesign); legacy anchors map onto them via redirects. Porting the live "tracks" / Submit-a-Requirement modal is Phase 3 (needs `POST /leads`).

### Phase 2 — Backend & Data Layer ✅ (2026-11-12, verified on local Postgres 16)
- [x] Migrations `015_marketing.sql` (leads, contact_messages, newsletter_subscribers, career_roles + 3 seeded roles, career_applications), `016_plans_settings.sql` (plans, credit_costs, platform_settings + seeds), `017_email_otps.sql`, `018_public_jobs.sql` (public-posting columns on `requisitions`; `tenants.is_test/logo_url/website`; board index), `019_products.sql`, `020_support.sql` (+ seeded categories). All idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- [x] `common/security`: `BotCheckService` (honeypot → silent drop, Cloudflare Turnstile siteverify, fail-closed; disposable-email blocklist). `TURNSTILE_SECRET_KEY` required in production, skipped with a boot warning in dev.
- [x] `marketing` module: `POST /leads`, `POST /contact`, `POST /newsletter/subscribe|confirm|unsubscribe` (double opt-in, hashed tokens, no "already subscribed" leak), `GET /careers/roles`, `POST /careers/applications`; admin `GET/PATCH /admin/leads`. Every write queues its internal notice + acknowledgement in the same transaction (`SALES_INBOX`, `SUPPORT_INBOX`, default support address).
- [x] `public` module: `GET /jobs/public` (keyset cursor, filters, hides private/closed/expired/test-tenant rows), `GET /jobs/public/:id`, `GET /plans?audience=`, `GET /public-settings/credits`, `GET /public/stats` (public counts only), `GET /geo` (CDN header). Edge `Cache-Control` set.
- [x] Requisitions: `PATCH /requisitions/:id/posting` (publish to the board, type, pay range, requirements, expiry; `published_at` stamped once); `Requisition.posting` in responses.
- [x] `products` module: public `GET /products`, `GET /products/:slug`; seller `GET /products/mine`, `POST`, `PUT`, `submit|pause|resume` (approved expert profile required to submit); admin `GET /admin/products`, `PATCH /admin/products/:id/status`.
- [x] `support` module: `GET /support/categories`, user tickets (`GET/POST /support/tickets`, `GET /support/tickets/:id`, `POST …/messages`, `POST …/resolve`), staff queue (`/admin/support/tickets`, staff replies emailed, staff names hidden from users).
- [x] Auth: `POST /auth/email/send-otp` / `verify-otp` (HMAC-stored 6-digit code, 10 min, 5 attempts, 60 s cooldown, no account enumeration) → 15-min `otpTicket`; `POST /auth/register` accepts it (account starts verified). `SIGNUP_REQUIRE_OTP=true` makes it mandatory — flip it when the Phase 3 sign-up UI ships.
- [x] Shared types in `packages/types/src/public.ts`; web `/jobs` and `/products` now use them. 10 email templates added (form recipients get a footer that doesn't claim they have an account; user text is escaped and kept out of subject-line newlines).
- [x] Tests: 59 new API tests (628 total pass), lint + build clean.
- [x] Verified on a local Docker Postgres 16: migrations 001–020 apply from empty and 015–020 re-run cleanly; the built API boots with all modules wired; a 75-check end-to-end smoke test (forms, newsletter double opt-in, OTP sign-up, job publishing + board + cursor paging + test-tenant hiding, product lifecycle, support, admin) passes with zero server errors. It found 3 parameter-type bugs (fixed with explicit `::text` casts). **Not yet applied to the shared RDS dev database.**
- Deferred: OAuth (Google/GitHub) and invites/reactivate → Phase 3 with their UI; `code_runs` / `llm_usage` tables → with the features that write them; currency rates → needs a provider decision; subscriptions/coupons/product purchases → Phase 3 (Razorpay flows).

### Phase 3 — Core Features & Forms 🟡 part 1 done (2026-11-12, verified in the browser against local Postgres)
Done:
- [x] F2 Submit-a-requirement dialog (3 steps, per-step validation, E.164 phone, UTM capture) → `POST /leads`; landing hero + final CTA + `/for-companies`; deep link `/?requirement=open&track=frontline`.
- [x] F3 (part) OTP-first sign-up: email → 6-digit code (paste/auto-advance, 60 s resend timer) → details with the verified email locked; `?role=` kept; `?next=` honoured after sign-up and sign-in (shared `safeNext`: same-site only, no `/auth` loops, no `//` or backslash tricks).
- [x] F4 (part) Job detail Apply: signed out → register/sign in and come back; candidate → one-click apply (idempotent); other roles told why. API: expired postings refuse applications.
- [x] F5 (part) `/pricing` reads `GET /plans` + `GET /public-settings/credits`, with Experts & buyers / Employers tabs (`?audience=employer`; `/hire/pricing` redirects there); static fallback if the API is down. Seed 016 corrected to the production plan copy + "Quick expert connect".
- [x] F6 Contact (+ `?intent=demo` prefill), F7 footer newsletter + `/newsletter/confirm` + `/unsubscribe` (click-to-act, so link scanners can't confirm/unsubscribe), F8 careers form from `GET /careers/roles`.
- [x] Cloudflare Turnstile widget (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`; renders nothing when unset), honeypot on every form, submit disabled until hydration + `method="post"` so fields can never land in a URL.
- [x] Workspace: `/platform/support` (all roles; `?ticket=` from the reply email), `/platform/support-queue`, `/platform/products` (seller lifecycle), `/platform/product-approvals`, `/platform/leads`; nav entries added.

Still to do (part 2):
- [ ] F3 rest: Google/GitHub OAuth + `/auth/callback` (needs OAuth client IDs), invite accept, refresh token → httpOnly cookie (cross-cutting; touches every API call).
- [ ] F4 rest: resume upload (S3 presigned) + AI autofill on apply.
- [ ] F5 rest: Razorpay subscription checkout, coupons, manage plan (needs Razorpay plan IDs; employer price list to confirm).
- [ ] F9 certificate share page with OG image; F10 `CreditCostConfirm` for AI search/chat; public `/marketplace` listing (make `GET /projects/open` public); `/products/[slug]` detail + purchase.
- [ ] `/platform/code` (Judge0), frontline voice interview, experts leaderboard, admin LLM-usage view.
- [ ] Flip `SIGNUP_REQUIRE_OTP=true` in each environment once this web build is deployed there.

### Phase 4 — Polish, SEO & Security 🟡 mostly done (2026-11-12, verified in the browser)
Done:
- [x] Metadata: title template `%s | ASTEAI`, site description, `applicationName`, OG/Twitter defaults with one handle (`@AsteAiAsteAi`, D10); every public page has a title + description + canonical (D2); `/auth/*` noindex-follow, `/platform/*` and certificate checks noindex-nofollow. `shareMeta()` re-applies OG/Twitter defaults on pages that customise them (Next replaces, not merges, those objects).
- [x] JSON-LD (`features/marketing/structuredData.ts`, unit-tested): Organization + EmploymentAgency with the 3-track OfferCatalog and WebSite on `/` (replaces the stale DeepTech FAQ/Service blocks, D9); FAQPage on `/pricing`, `/how-it-works`, `/for-companies`; BreadcrumbList on blog posts, case studies, jobs, legal pages; JobPosting and BlogPosting kept.
- [x] Share images via `next/og`: site default, per blog post, per job (falls back to a generic card). Edge runtime (next/og's Node runtime can't load its font on Windows builds). `app/icon.svg` favicon added (there was none).
- [x] Sitemap: + published jobs (cursor-walked, cap 1,000) and public expert profiles (cap 1,000), `/pricing?audience=employer`; regenerates hourly; ships the static part if the API is down.
- [x] Security headers on every page (`apps/web/securityHeaders.js`, unit-tested): CSP (`object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`, connect only to self + API + its websocket + Turnstile/Razorpay; no `unsafe-eval` outside dev; `upgrade-insecure-requests`), HSTS (prod), nosniff, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy (camera/mic self only), COOP; `X-Powered-By` removed. Verified: no CSP violations on public pages, the requirement dialog, theme toggle, or the signed-in workspace (API + websocket).
- [x] API helmet: HSTS 2 y + preload, frameguard deny, `Referrer-Policy: no-referrer`, CORP same-site, no `X-Powered-By`.
- [x] Contrast (`src/styles/contrast.spec.ts` reads `globals.css`): all text tokens ≥ 4.5:1 on every surface in both themes, and white button text on `--blue`. Fixed: dark `--fg-3` (#6B6E8A→#787B9B), dark `--blue` (#4D8BFF→#4073D4, was 3.25:1 under white text) + new `--blue-hover`, light mint/gold/amber/fg-3 slightly darker.
- [x] Already satisfied: `/users/me` is only called inside the workspace (D7); test tenants hidden from the board (D3, Phase 2); skip link, visible focus ring, `prefers-reduced-motion` already in place.

Decided / deferred:
- CSP uses `'unsafe-inline'` for scripts instead of a nonce: a per-request nonce would make every page dynamic and drop static generation. Revisit with Next's experimental SRI/hash support or if the marketing site moves to dynamic rendering anyway.
- Consent banner: not added, because the redo loads no analytics or marketing scripts yet (only strictly necessary storage). `/consent-preferences` + the `asteai:consent` event are ready; add the banner in the same change that adds PostHog/New Relic/Sentry, and gate them on the cookie. Termly is not used.
- [ ] Playwright e2e + axe in CI (needs browser binaries downloaded in CI; the API smoke script covers the backend flows meanwhile).
- [ ] `next/image` + AVIF for content images (the redo has none yet), JS budget check in CI.
- [ ] Admin moderation queue for public jobs.
