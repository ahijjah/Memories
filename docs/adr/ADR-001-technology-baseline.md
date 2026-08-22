# ADR-001: Technology Baseline

**Status:** Accepted
**Date:** 2026-08-22
**Scope:** Phases 1–5 / MVP-V1, per `Claude_Code_App_Implementation_Specification.docx`

## Context

The spec (§4) leaves the concrete stack open, to be selected pragmatically
after short spikes, consistent with: modular monolith + async workers,
managed Postgres-compatible relational DB, provider-abstracted AI, managed
identity, private object storage, durable job queue.

## Decisions

| Area | Decision | Rationale |
|---|---|---|
| Backend language/framework | **Node.js + TypeScript, NestJS** | Chosen by project owner. NestJS gives modular-monolith structure (modules map cleanly to the spec's services: Memory, Ingestion, Search, Ask/RAG, Vault, Engagement, Privacy) out of the box, first-class DI, and a mature ecosystem for queues/ORM/testing. |
| ORM / migrations | **Prisma** | Type-safe schema-as-code, mandatory migrations (spec §4, §17), good Postgres + pgvector support. |
| Primary DB | **PostgreSQL** (local via Docker for dev; managed Postgres — e.g. RDS/Cloud SQL/Neon — for staging/prod) | Matches spec §4 baseline exactly. |
| Vector search | **Postgres `pgvector` extension** | Spec §4 explicitly allows "Postgres vector capability initially" — avoids standing up a separate vector DB before it's needed. Supports metadata/security filters via SQL. |
| Object storage | **S3-compatible private bucket** (provider TBD at deploy time — AWS S3 / R2 / MinIO for local dev), accessed only via signed URLs | Spec §4, §12 — no public Vault URLs, ever. |
| Job queue | **BullMQ (Redis-backed)** | Managed durable queue with retries + idempotency support; Redis is cheap to run locally and on any cloud. |
| Auth | **Managed identity provider (TBD — e.g. Auth0/Clerk/Cognito)**, abstracted behind an `AuthModule` interface | Spec §4 says "managed/established identity solution" without naming one; abstraction avoids lock-in during spikes. Interim dev auth uses JWT issued by the API itself. |
| AI provider | **Anthropic Claude (Messages API)** via a provider-abstraction layer in `packages/ai`, supporting OCR/multimodal/LLM/embeddings | Spec §4, §9 require provider abstraction and version tracking regardless of which vendor is used. |
| Mobile framework | **Not yet decided** — Flutter vs React Native pending a native-capability spike (Share extension, biometrics, camera/scan, background behavior) per spec §4, §29 (SP-01) | Backend work does not block on this; API contracts are framework-agnostic. |
| Monorepo tool | **npm workspaces** | Simplest option that satisfies spec §21's monorepo recommendation without adding tooling (Nx/Turborepo) before it's needed. |
| CI | **GitHub Actions** | Matches GitHub-hosted repo; free for private repos at this scale. |

## Consequences

- Vector search living inside Postgres means one fewer moving part in dev/staging, at the cost of needing to benchmark `pgvector` at scale before a real cutover decision (tracked as a future spike, per spec §4 "managed vector layer" as an alternative).
- Mobile framework choice is deferred; this is explicitly allowed by the spec's own phasing (§29 task 4 is a spike, not a commitment).
- Auth provider is deferred to a spike; the interim JWT approach in `apps/api` is dev-only and is *not* the spec's "managed/established identity solution" — do not treat it as production-ready.

## Non-goals reaffirmed

Per spec §28: no microservices split, no graph database, unless a specific
epic demonstrates the need.
