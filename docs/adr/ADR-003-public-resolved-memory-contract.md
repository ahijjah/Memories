# ADR-003: Public Resolved Memory Contract

**Status:** Accepted
**Date:** 2026-09-26
**Scope:** P0 Resolved Memory, PR2 (additive public API contract). Builds on ADR-002.

## Context

ADR-002 added one internal resolution primitive: user confirmation → latest valid AI
inference → explicit raw fallback → none. Clients still received only raw evidence:
`Memory.title`, `Memory.memoryType`, `aiInferences` and `userConfirmations`. Mobile therefore
re-implemented resolution itself, and it did so inconsistently. CompactCard shows the raw title,
and the actions code ignores confirmations.

This ADR defines the public contract that exposes resolved state, so clients can adopt it in a
later PR. It is a projection built at request time. **No ResolvedMemory table, cache or
materialized model exists.**

## Decisions

### D4: Public field shape

```ts
type ResolvedSource = 'user' | 'ai' | 'original';
interface ResolvedFieldView<T> { value: T; source: ResolvedSource; confidence: number | null }
```

- **Omission:** unresolved fields are omitted. There are no `null` values and no `source: 'none'`.
- **`confidence`:** the selected AI row's stored per-field confidence when `source === 'ai'`,
  otherwise `null`. It is the AI pipeline's self-reported score (`fieldConfidence[field]`, falling
  back to the overall confidence). **It is not a calibrated probability.**
- **Not public:** `provenance`, `modelVersion`, `inferredAt` and `confirmedAt` stay internal.
  - `provenance` is always `'llm_extraction'` today. That names the extraction method, not the
    evidence behind a value.
  - Evidence provenance (which asset, text span or metadata a value came from) does not exist
    yet. If it is added later, it will be an optional key.
- **Where the types live:** in `packages/domain`: `ResolvedSource`, `ResolvedFieldView`,
  `CanonicalMemoryType`, `CANONICAL_MEMORY_TYPES`, `ResolvedMemoryField` and
  `ResolvedMemoryView`. The Prisma-coupled resolver and the projection stay in the API
  (`common/resolved-memory.projection.ts`).

### D5: Endpoint scope

A single `resolved` object. Each endpoint returns its own field set:

| Endpoint | Field set |
|---|---|
| `GET /memories/:id` | `DETAIL_RESOLVED_FIELDS` (27 fields) |
| `GET /vault/:id` | `DETAIL_RESOLVED_FIELDS` (27 fields) |
| `GET /memories` | `LIST_RESOLVED_FIELDS`: title, type, date, location, price, category |

These do not get `resolved` in this PR: Collections, Related, Search, Ask, engagement projection
DTOs, Workspaces, and the Vault list.

**Shape validation per field:**
- String fields reject non-strings.
- `topics` and `entities` must be non-empty arrays of strings. This matches how the processor
  stores them.
- `dateYearInferred` must be a boolean; `false` is a valid value.
- Only valid rows are candidates, so a malformed newer value falls back to the latest valid one.

### D6: Raw evidence and backward compatibility

- **Existing fields keep their values and meaning.**
  - The top-level `title` on Memory entities is still the original captured evidence.
  - `memoryType` is still the raw stored value.
  - Detail and Vault Detail still return full `aiInferences` (newest first) and
    `userConfirmations`.
  - The list still returns raw `aiInferences` for date, location, price and category only, and
    it still returns no `userConfirmations`.
- **Extra rows loaded by the list** (title/type inferences and preview confirmations) are used to
  resolve the preview. They are removed before the response is serialized.
- **Title naming rule:**
  - On a **Memory entity**, top-level `title` is raw evidence, and `resolved.title` is the value
    to display.
  - On **projection DTOs** (Search, Ask, Related, Near Me, Calendar, Upcoming, Workspaces), `title`
    is already server-resolved. That is unchanged.
- **Placeholders** such as "Untitled" stay in the client.

### D7: Sensitive fields

`issuer`, `owner` and `documentNumber` are encrypted at rest.

- **List:** they are never loaded or returned. No list field set contains them, and tests enforce
  this.
- **Detail endpoints:** they are resolved only on Memory Detail and Vault Detail, which already
  return the decrypted values in `aiInferences`/`userConfirmations`.
- **Order of operations:** resolution runs on the rows after `decryptSensitiveFields`. The
  projection does no queries, authorization, decryption or logging, and it never mutates its input.
- **Unchanged:** endpoint ownership checks, Vault scoping and 404s.
- **Existing gap:** Vault step-up re-authentication is still missing and is out of scope here.

### D8: Vault notes

`notes` is not part of `resolved`. It is user-authored Vault application state, not Memory
understanding, and it keeps its existing behaviour.

### D9: Type authority

`Memory.memoryType` is the canonical persisted type. Its only writer is the AI processor,
which sets it on successful understanding. `resolved.type` is an ordinary `ResolvedFieldView`,
resolved in this order:

1. **A user `type` confirmation that normalizes to a canonical type.** Result: that value with
   `source: 'user'` and `confidence: null`. Empty, unknown or invalid confirmations fall through.
2. **A non-null `memoryType` that normalizes.** Result: the normalized value with
   `source: 'ai'`.
   - Its confidence is taken from the **newest** type inference (`createdAt DESC, id DESC`),
     and only if that inference normalizes to the same value. Otherwise it is `null`.
   - Older inferences that happen to match are never used.
3. **Otherwise,** `type` is omitted.

Type inference history never supplies the value.

**`GENERIC`:**
- A null `memoryType` means *not understood yet* (queued, processing or failed). It is left
  unresolved and is **not** turned into `GENERIC`.
- Consumers render `resolved.type?.value ?? 'GENERIC'`. That is ADR-002's `GENERIC` fallback,
  applied as a rendering default.
- A **stored** `GENERIC` is a real classification ("doesn't fit the other categories") and is
  emitted as such, as are the legacy values that map to it.

**Normalization** is server-side and case-insensitive. Canonical uppercase values pass through.
Legacy values map as follows:

| Legacy value | Canonical value |
|---|---|
| `event` | `EVENT` |
| `place` | `PLACE` |
| `product` | `PRODUCT` |
| `article`, `tutorial` | `ARTICLE_LEARNING` |
| `video`, `post` | `VIDEO_SOCIAL` |
| `document` | `DOCUMENT` |
| `image`, `note`, `other` | `GENERIC` |

`OFFER` has no legacy alias. Raw `memoryType` is never rewritten, in the response or in the
database.

## Migration phases

1. **PR2 (this ADR):** the API contract only. `resolved` is added alongside the raw arrays, with
   no mobile change and no breaking change.
2. **PR3:** mobile adopts `resolved`.
   - Memory Detail and Vault Detail switch to it.
   - CompactCard and ShareCard use `resolved.title`.
   - `getActionsForMemory` becomes confirmation-aware and gates on `resolved.type` and its
     confidence.
   - How mobile gets the shared types (a `@memory-app/domain` dependency or a pinned mirror of
     the types) is decided there.
3. **Later:** reduce the raw history in responses once no shipped client reads it. This needs an
   app-version policy.

## Consequences

- Clients get one authoritative value per field, with enough metadata (source and confidence)
  for "verify" hints and confirmed states.
- The list payload grows by one small preview object per Memory.

**Known follow-ups, not addressed here:**
- Search and Ask summaries have no `id` tie-break and don't use confirmation or latest-valid
  semantics.
- `summarizeMemory` and `extractKeyPoints` select the summary without ordering.
- For You and Continue don't use latest-valid semantics.
- Workspace membership still counts historical topic rows.
- A Facebook partial reprocess can keep an older `memoryType` whose type inference has been
  deleted. It resolves with `confidence: null`.
- There is no allowlist of confirmable fields.
- `UserConfirmation` has no `updatedAt`.
- There are no explicit clear-field semantics.
