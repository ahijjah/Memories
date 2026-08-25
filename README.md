# Memory App

> **Save anything. Find anything. Use it when it matters.**

An AI-assisted personal memory system: capture from anywhere → AI understands it →
hybrid search + Ask/RAG → secure Vault for personal documents → proactive
reminders and rediscovery.

Built against `docs/Claude_Code_App_Implementation_Specification.docx` (mirrored
in `docs/spec.md`). See `docs/adr/ADR-001-technology-baseline.md` for the
stack decisions and open questions.

## Status

**Phase 0/1 — architecture spike + first vertical slice**, per the spec's own
recommended build order (§22, §29). Currently implemented:

- Monorepo skeleton (`apps/`, `packages/`, `infra/`, `docs/`)
- `apps/api`: NestJS backend with the first vertical slice —
  `Create Memory → enqueue AI understanding → BullMQ worker calls Claude → AIInference stored → Memory Detail`
- Prisma schema for `User`, `DeviceSession`, `Memory`, `MemoryAsset`, `AIInference`, `UserConfirmation`
- Dev-only JWT auth (**not** production-ready — see ADR-001)
- Asset upload endpoints (stubbed — no real object storage wired yet)
- CI (lint/build/test against real Postgres+Redis services)
- Deploy workflow template (SSH + git pull) — inactive until secrets are set

**Not yet built:** mobile app, Vault, Search, Ask/RAG, Collections, Reminders/
Engagement, Privacy export/delete. These follow the epic order in spec §22.

## Prerequisites

- Node.js ≥ 20
- Docker (for local Postgres + Redis)
- An Anthropic API key (for the AI worker) — get one at https://console.anthropic.com

## Local development

```bash
# 1. Install dependencies (from repo root)
npm install

# 2. Start Postgres + Redis
npm run infra:up

# 3. Configure environment
cp apps/api/.env.example apps/api/.env
# then edit apps/api/.env and set ANTHROPIC_API_KEY

# 4. Run migrations + seed demo data
npm run prisma:migrate
npm run prisma:seed

# 5. Start the API in watch mode
npm run dev:api
```

The API listens on `http://localhost:3000`. Swagger docs are at
`http://localhost:3000/docs`.

### Trying the vertical slice end-to-end

See `docs/testing-with-clerk.md` for instructions on obtaining a Clerk test token and testing the API endpoints.

## Testing

```bash
npm run test:api
```

## Repository layout

See `docs/adr/ADR-001-technology-baseline.md` and spec §21. Summary:

```
apps/api          NestJS backend (modular monolith)
apps/mobile        (not yet created — pending framework spike)
packages/ai         AI provider abstraction (Anthropic adapter)
packages/contracts   (not yet populated — shared API schemas)
packages/domain      (not yet populated — shared domain types)
infra                docker-compose for local dev services
docs/adr             Architecture Decision Records
scripts               dev/migration/seed utilities
```

## Deployment

CI (`.github/workflows/ci.yml`) runs on every push/PR to `main`.

`deploy.yml` is a template for SSH-based deploy-on-push to a server you
control. It stays inert until you add these repo secrets (Settings → Secrets
and variables → Actions):

- `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY`, and optionally `DEPLOY_SSH_PORT`

It assumes the repo is already `git clone`d on the target server at
`~/apps/memory-app` and that a process manager (pm2 suggested) is available.
See the workflow file for the exact commands it runs.

## Known limitations / follow-ups

- **Vault:** Currently uses the same Clerk session as normal access — there is no additional step-up re-authentication (e.g. re-entering a password or biometric) before viewing Vault content yet, despite the spec calling for a stricter authorization boundary. The data-isolation half of Vault (exclusion from normal search/list/ask) is implemented and enforced; the re-authentication half is not. Needs a follow-up using Clerk's session freshness / reverification features before this should be considered production-ready for actually sensitive documents.
- **Account data export (GET /account/export) includes Vault content**, consistent with Vault's existing lack of step-up re-authentication — both should be gated behind the same future step-up auth mechanism together.
- `packages/ai` and `packages/domain` are consumed via TS path aliases in
  dev (`ts-node` + `tsconfig-paths`); production builds will need either a
  build step for those packages or a bundler — not yet set up.
- No mobile app yet — framework choice (Flutter vs React Native) is an open
  spike per spec §4/§29.

---

**Last verified deploy:** 2026-08-23 (pipeline test - workspace modules verified)
**CI:** Manual workflow dispatch enabled for on-demand testing
**Workspace packages:** ai and domain pre-compiled in build pipeline
