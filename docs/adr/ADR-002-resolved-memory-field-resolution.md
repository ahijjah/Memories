# ADR-002: Resolved Memory Field Resolution

**Status:** Accepted
**Date:** 2026-09-26
**Scope:** P0 Resolved Memory foundation, PR1 (server-side resolution primitive)

## Context

A Memory's fields have three separate sources (spec §6): the original capture, AI
inferences, and user confirmations. They are stored separately and never overwrite each
other:

- `ai_inferences` is append-only. Reprocessing adds a new row per field, and older rows are
  kept. `(memoryId, field)` is not unique.
- `user_confirmations` has one row per `(memoryId, field)`. It is upserted, and it has no
  `updatedAt`.
- `Memory.title` is the original capture input: the typed title, the text excerpt or the URL.
  The AI processor reads it as input and never overwrites it. There is no summary column.

Before this ADR, each surface resolved fields its own way, mostly with `.find()` or `[0]`
over **unordered** relation includes or `findMany` results. After a reprocess, Postgres could
return the older inference first. Search, Ask, Related, Upcoming, Workspaces and mobile
Memory Detail could then show a stale AI value, while Calendar, which ordered its rows,
showed the newer one. Empty-value handling also differed between paths, because they relied
on JavaScript truthiness.

## Decision

Add one pure resolution primitive, `resolveMemoryField`, in
`apps/api/src/common/resolve-memory-field.util.ts`. It is a primitive, not a model: no
materialised ResolvedMemory table or cache exists.

### Precedence (per field)

1. **User confirmation.** It wins regardless of AI confidence, and no confidence is
   fabricated for it.
2. **Latest valid AI inference for that field.**
3. **Explicit raw fallback**, only where the caller supplies one. Today that is `title` from
   `Memory.title`.
4. **None**, returned as `{ value: null, source: 'none' }`. Compatibility wrappers such as
   `resolveTitleFromFields` may still return `''`. Display placeholders ("Untitled",
   "Memory", "${sourceType} Memory") remain the caller's concern.

The result carries `source` (`user | ai | original | none`) and metadata for future
adoption: `confidence`, `provenance`, `modelVersion` and `inferredAt` for AI values, and
`confirmedAt` for confirmations.

### Presence (D1)

- `null`/`undefined` are absent.
- A string is present only if `trim().length > 0`.
- An array is present only if it is non-empty.
- A non-null object is present.
- Numbers are present, including `0`, and booleans are present, including `false`.
- A value whose type does not match the field's expected shape (for example a non-string
  title) is ignored.

An empty or whitespace confirmation therefore **falls through**. It does not mean "the user
cleared this field". Explicit clearing is future work and needs a product, schema and UI
representation. No sentinel is introduced.

### History (D3): per-field latest

Each field independently takes its latest valid inference. If a newer processing run omits a
field, or writes an empty value for it, the older valid inference for that field stays
effective. Latest-run-only semantics are intentionally not used. Invalidating evidence is
separate work.

### Deterministic ordering

AI rows are ordered by `createdAt DESC, id DESC`:

- Prisma uses the shared `LATEST_AI_INFERENCE_ORDER`.
- SQL LATERALs use `ORDER BY "createdAt" DESC, "id" DESC`.

The resolver also sorts its input itself, so it never depends on the order a query
returned. The `id` tie-break is arbitrary but deterministic, so every surface agrees.

### Content type authority (D2)

`Memory.memoryType` is the canonical current content type. The resolution order is:

1. an explicit user confirmation, where a server path already supports one;
2. `Memory.memoryType`, normalised to the current taxonomy;
3. `GENERIC`.

`memoryType` is written in the same transaction as the latest `type` inference. The
historical `type` inference rows remain useful for confidence, provenance and history, but
must not replace a newer canonical `memoryType`. PR1 documents this rule but does not
migrate existing type readers. The remaining inconsistencies are listed below.

### Security boundary

The resolver is pure. It performs no queries, authorization or decryption, does not log
values, and does not mutate its inputs. Endpoints keep sole responsibility for:

- `userId` scoping;
- Vault selection and exclusion;
- decrypting sensitive fields (`documentNumber`, `owner`, `issuer`).

Callers must pass rows that have already been authorized, selected and decrypted.

### Public API

PR1 does not change any response shape and does not add a public `resolved` object.
Response values become deterministic: server-resolved titles are latest-wins, and
`aiInferences` arrays in Memory Detail, Vault Detail and the Memory list are ordered
newest-first. The existing mobile `[0]` and `.find()` consumers therefore pick the latest
inference.

## Consequences

- Server paths that go through `resolveTitleFromFields` (Search, Ask, Related, Near Me,
  Calendar, Workspaces), plus Upcoming and Compare, share one precedence rule and are
  latest-wins.
- A title may visibly change on reprocessed Memories, to the correct latest value.

### Known gaps and future work

- Mobile `getActionsForMemory` still ignores user confirmations. It becomes latest-AI only
  through the ordered response.
- Mobile CompactCard and ShareCard still show raw `Memory.title`.
- Mobile clients do not consume resolved state from the server. That needs a public
  `resolved` contract, which is a later PR.
- Type readers are not yet unified under D2:
  - cards use `memoryType`;
  - mobile actions use the latest `type` inference with a confidence gate;
  - Workspaces use the latest `type` inference, then `memoryType`;
  - Calendar uses a `type` confirmation, then the latest `type` inference.
- Workspace topic membership SQL still considers historical `topics` rows.
- `summarizeMemory` and `extractKeyPoints` read one summary inference with `take: 1` and no
  ordering.
- `UserConfirmation` has no `updatedAt`, so `confirmedAt` is the first confirmation time.
- There is no server-side allowlist for confirmable fields.
- Explicit "clear field" semantics are not defined.
