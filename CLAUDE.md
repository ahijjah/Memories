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

## Repo layout

```
apps/api          NestJS backend (modular monolith)
apps/mobile        (not yet created)
packages/ai         AI provider abstraction (Anthropic adapter)
packages/contracts   (not yet populated)
packages/domain      (not yet populated)
infra                Local dev (docker-compose.yml) + production
                     (docker-compose.prod.yml, nginx/, .env.production.example)
docs/adr             Architecture Decision Records — add a new ADR-00N
                     for any significant technical decision, don't just
                     make the change silently
docs/deployment.md   VPS deployment runbook
```

## Build order

Follow the epic order in spec §22: Mobile Foundation → Memory Platform →
Capture → AI → Memory UX → Search → Ask/RAG → Vault → Engagement →
Privacy/Account → Hardening. Currently implemented: the first vertical
slice only (auth-stub → create Memory → AI worker → Memory Detail). See
`README.md` "Status" section for the current checklist.

## Working conventions

- Build in vertical slices; keep the app runnable after each milestone
  (spec §1).
- Never block successful capture on AI completion (BR-001).
- Preserve original data / AI inference / user corrections separately —
  never overwrite one with another (spec §6 precedence rule).
- Use idempotency keys for capture creation and job execution; retries
  must never create duplicate Memories (spec §8, §17).
- Vault content never crosses its authorization boundary, and Vault
  content/document identifiers never appear in logs or analytics
  (spec §12, §19).
- Write tests for critical business/security logic as you go, not after.
- Use env vars/secrets management; never commit credentials. Real
  `.env` / `.env.production` files are gitignored — only the
  `.env*.example` templates are committed.
- If a requirement is ambiguous, pick the simplest behavior consistent
  with the product principles and record the assumption as a new entry
  in `docs/adr/` (or a decision log if one exists) rather than silently
  guessing.
- Any deviation from a MUST requirement needs to be explicitly called
  out — reason, impact, proposed resolution — not silently dropped.

## Deployment

Production runs on a VPS that also hosts other, unrelated projects — this
project is deliberately isolated from them:

- Own Docker Compose project (`infra/docker-compose.prod.yml`): own
  network (`memory-app-internal`), own volumes, own container names.
  Postgres/Redis are **not** exposed to the host, only reachable inside
  that Docker network.
- Own Nginx server block (`infra/nginx/memory-app.conf`) for
  **memories.ai970.cloud** — doesn't touch any other vhost on the box.
- Full one-time setup + rollback + teardown steps: `docs/deployment.md`.
- Auto-deploy on merge to `main` via `.github/workflows/deploy.yml`
  (SSH + `docker compose build/up`), gated on `DEPLOY_SSH_*` secrets
  being set in the repo.

Do not add ports, volumes, or container names that could collide with
other projects on that VPS — always prefix with `memory-app-`.

## Known gaps (don't assume these are solved)

- Auth is dev-only JWT (`apps/api/src/modules/auth`) — not production
  identity. Flagged in ADR-001; needs a real managed provider before
  real user data touches this.
- Object storage (`apps/api/src/modules/assets`) is stubbed —
  `stub://...` URLs, no real bucket wired up.
- No mobile app yet.
