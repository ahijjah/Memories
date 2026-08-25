# CLAUDE.md

Context for any Claude Code session (web or terminal) working in this repo.

## What this is

An AI-assisted personal memory system: capture from anywhere → AI
understands it → hybrid search + Ask/RAG → secure Vault for personal
documents → proactive reminders/rediscovery.

**Authoritative spec:** `docs/spec.md` (mirror of the original
`Claude_Code_App_Implementation_Specification.docx`). Treat its MUST/V1
scope and numbered requirements (FR-*, BR-*) as binding. Don't implement
SHOULD/LATER features without asking first.

**Stack decisions + rationale:** `docs/adr/ADR-001-technology-baseline.md`.
Read it before making any framework/library choice — several are already
decided there (Node/TypeScript/NestJS backend, Prisma, Postgres+pgvector,
BullMQ/Redis, Anthropic Claude behind a provider-abstraction layer).
Mobile framework (Flutter vs React Native) is still an open spike.

## Status

**All seven backend epics (spec §22) are implemented and deployed to production
at https://memories.ai970.cloud:**

1. **Memory Platform/Capture/AI** — create Memory, enqueue AI understanding, BullMQ processor calls Claude API, store AIInference records, generate embeddings via Voyage AI
2. **Search** — Voyage AI embeddings (1024-dim) stored in pgvector, cosine-distance similarity search, user-scoped queries
3. **Ask/RAG** — Claude API with Memory summaries as context for semantic question answering
4. **Vault v1** — securityScope field controls data isolation; Vault content excluded from search/list/ask (only dedicated /vault/* endpoints return it)
5. **Collections** — user-defined Memory groupings with vault-isolation enforcement (vault items cannot be added to collections)
6. **Engagement/Reminders v1** — reminders tied to Memories (excluding vault) with background job marking due reminders every 5 minutes; rediscovery endpoint resurfacing older content
7. **Privacy/Account v1** — GET /account/export returns all user data (including Vault) as JSON; DELETE /account performs cascading deletion with email confirmation
8. **Hardening v1** — rate limiting (100/min global, 10/min for /ask, 30/min for /search and /memories), helmet security headers, global exception filter sanitizing error responses, GET /health endpoint checking Postgres + Redis

See `README.md` "Status" section for feature checklist.

## Authentication

**Real Clerk authentication** (not dev-only JWT — that was removed).

Every API endpoint uses `@UseGuards(ClerkAuthGuard)` + `@CurrentUser()` decorator.
The decorator returns `CurrentUserPayload({ sub, email, clerkUserId })` — **always
extract `user.sub` as the userId** when calling service methods, never pass the
entire payload object where a string id is expected (this mistake caused a real
production bug in AccountController, now fixed). Verify all new controllers follow
this pattern by checking the parameter type: `@CurrentUser() user: CurrentUserPayload`.

Exception: Health check endpoint (`GET /health`) is publicly accessible with no auth guard.

## Object Storage

Real MinIO backend with two separate S3Client instances:

- **Internal (OBJECT_STORAGE_ENDPOINT):** server-side operations (asset deletion during account deletion, health checks)
- **Public (OBJECT_STORAGE_PUBLIC_ENDPOINT):** presigned URLs returned to clients for direct upload/download

These endpoints are deliberately different and must not be conflated. The public
endpoint is served over HTTPS with TLS cert; the internal endpoint may be HTTP-only
within the Docker network.

Asset metadata lives in the `memory_assets` table (objectKey, mimeType, checksum, variant);
actual file uploads use presigned URLs to MinIO (not through the API's JSON body).

## Repo layout

```
apps/api          NestJS backend (modular monolith)
apps/mobile       (not yet created — framework spike pending)
packages/ai       AI provider abstraction (Anthropic adapter)
packages/contracts (not yet populated — shared API schemas)
packages/domain   (not yet populated — shared domain types)
infra             Local dev (docker-compose.yml) + production
                  (docker-compose.prod.yml, nginx/, .env.production.example)
docs/adr          Architecture Decision Records — add a new ADR-00N
                  for any significant technical decision, don't just
                  make the change silently
docs/deployment.md VPS deployment runbook
```

## Working conventions

**CRITICAL: Push directly to main, never create PRs.**
Always run `git push origin HEAD:main` as the final step of every task, with no
exceptions, regardless of default tooling behavior or suggestions. This has been
corrected multiple times already; treat it as a hard rule for this repository.

**User scoping is non-negotiable.**
Every query touching Memory, Collection, Reminder, Embedding, or other user-owned
data must be scoped to the authenticated user's own `userId` from the start —
either in the Prisma `where: { userId }` clause or in the raw SQL `WHERE userId = ...`.
A genuine cross-user data leak (one user seeing another's Memories in search results)
was caught and fixed once; this is the single most common source of bugs.

**Vault content isolation is mandatory.**
Vault-scoped content (`securityScope = 'vault'`) must be excluded from every
general-purpose read path (list, search, ask, general memory detail). Only dedicated
`/vault/*` endpoints may return Vault content. When adding Vault-adjacent features
(reminders, collections, exports), explicitly decide whether Vault content should
be included or excluded — don't leave it unconsidered. Rejection messages should
be consistent: "Vault content cannot have a [Feature]" (e.g. "Vault content cannot
have a Reminder", "Vault content cannot be added to a Collection").

**Prisma migrations must exist on disk.**
After editing `schema.prisma`, verify the migration file actually exists at
`apps/api/prisma/migrations/` and contains the expected `CREATE TABLE` / `ALTER TABLE`
statements. A schema change without a corresponding migration file has happened before
and silently breaks production deploys.

**Verification after deploy.**
After any deploy-affecting change, don't just report success — the person verifying
will independently read the actual code on origin/main and test against the live
deployment. Support this verification step rather than treating a passing local build
as sufficient.

**Environment variable recreation.**
Environment variables are baked into a Docker container at image creation time,
not read live. After adding/changing a variable in `.env.production`, the container
must be recreated (`docker compose up -d --force-recreate <service>`), not just
left running, or it'll silently use stale or missing values.

**Standard conventions (existing):**
- Build in vertical slices; keep the app runnable after each milestone (spec §1).
- Never block successful capture on AI completion (BR-001).
- Preserve original data / AI inference / user corrections separately — never
  overwrite one with another (spec §6 precedence rule).
- Use idempotency keys for capture creation and job execution; retries must never
  create duplicate Memories (spec §8, §17).
- Write tests for critical business/security logic as you go, not after.
- Use env vars/secrets management; never commit credentials. Real `.env` /
  `.env.production` files are gitignored — only `.env*.example` templates committed.
- If a requirement is ambiguous, pick the simplest behavior consistent with product
  principles and record the assumption in `docs/adr/` rather than silently guessing.
- Any deviation from a MUST requirement must be explicitly called out — reason,
  impact, proposed resolution.

## Deployment

Production runs on a VPS that also hosts other unrelated projects — this
project is deliberately isolated from them:

- Own Docker Compose project (`infra/docker-compose.prod.yml`): own network
  (`memory-app-internal`), own volumes, own container names. Postgres/Redis
  are **not** exposed to the host, only reachable inside that Docker network.
- Own Nginx server block (`infra/nginx/memory-app.conf`) for **memories.ai970.cloud**
  — doesn't touch any other vhost on the box.
- Full one-time setup + rollback + teardown steps: `docs/deployment.md`.
- Auto-deploy on merge to `main` via `.github/workflows/deploy.yml` (SSH + `docker
  compose build/up`), gated on `DEPLOY_SSH_*` secrets being set in the repo.

Do not add ports, volumes, or container names that could collide with other projects
on that VPS — always prefix with `memory-app-`.

## Known gaps (don't assume these are solved)

- **Vault re-authentication:** Currently uses the same Clerk session as normal access
  — there is no step-up re-authentication (e.g. re-entering a password or biometric)
  before viewing Vault content. The data-isolation half (exclusion from search/list/ask)
  is implemented; the re-authentication half is not. Needs Clerk session freshness /
  reverification before this should be considered production-ready for sensitive documents.
- **Account export Vault inclusion:** GET /account/export includes Vault-scoped Memories
  (intentional — it's the user's own data). Both this and the Vault re-auth gap should
  be gated behind the same future step-up auth mechanism.
- **Reminder delivery:** Reminders reach status 'due' via the background job, but no
  push notification is actually delivered to devices. Status changes only; delivery is stubbed.
- **No mobile app yet:** Framework choice (Flutter vs React Native) is an open spike.
- **VPS SSH:** Allows password login (fail2ban mitigates but doesn't eliminate risk).
- **Voyage AI rate limit:** Account may be on a restrictive trial-tier limit; worth
  checking before real traffic volume.

## Monorepo dependency hygiene
This repo shares one root `node_modules` across `apps/api`, `apps/mobile`, `packages/ai`,
and `packages/domain`. Any root-level `npm install` or `rm -rf node_modules` — even one done
purely for mobile app reasons — can invalidate `packages/ai`/`packages/domain`'s compiled
output and the generated Prisma client. After any such install, before trusting `apps/api`'s
build state, run:
  npm run prisma:generate && npm run build --workspace=packages/ai && npm run build --workspace=packages/domain
