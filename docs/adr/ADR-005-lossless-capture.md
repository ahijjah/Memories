# ADR-005: Lossless capture

**Status:** Accepted
**Date:** 2026-09-28
**Scope:** LOSSLESS-CAPTURE-01. Capture and data preservation only.

## Context

Text Memories kept only `input.substring(0, 100)`, stored as `title`; the `Memory` model had no
field for the rest. Shared text containing a link was saved as a text Memory unless the whole text
was the link, and the share handler used only the first delivered payload with a new idempotency
key per attempt.

## Invariant

What the user saves is either preserved completely or explicitly rejected. No silent truncation.

## Decisions

### D1: A separate `MemoryContent` table (`memory_contents`)

- 1:1 with `memories` (`memoryId` primary key, FK `ON DELETE CASCADE`), `text TEXT NOT NULL`,
  `createdAt`. No backfill: legacy Memories have no row and are never given invented text.
- Not a `Memory.body` column: about ten read paths return whole Memory rows (list `findMany`
  without `select`, engagement queries, raw `SELECT m.*` in rediscovery), and Prisma 5.22 has no
  stable way to leave a column out. A separate table is loaded only where it is asked for.
- Written in the same `prisma.memory.create` as the Memory (nested create: atomic). Immutable in
  this phase; editing is deferred.

### D2: API field `body`

- `POST /memories` accepts optional `body`; responses of create (including idempotent replays),
  `GET /memories/:id` and `GET /vault/:memoryId` return `body` (`null` when there is none).
  Account export includes it. No list, search, Ask, engagement, rediscovery, related or Near Me
  response loads it. A static test in the API suite fails if another module references the table.
- Vault: returned only by the Vault Detail path after its ownership and scope checks; ordinary
  Detail still returns 404 for Vault Memories.

### D3: Limit 20,000 characters, strict rejection

- `MAX_MEMORY_TEXT = 20000` Unicode code points (what PostgreSQL `char_length` counts). The DTO
  uses a code-point validator (class-validator's MaxLength discounts variation selectors and
  would accept text the database refuses); the migration adds
  `CHECK (char_length("text") <= 20000)` as a backstop.
- Over the limit nothing is saved: the API returns 400, the Capture screen disables Save with a
  counter, and the share flow shows an explicit error. Text is never cut, and no
  "save the first 20,000" option exists.
- The JSON body limit is raised from Express's 100 KB default to 256 KB, enough for 20,000
  characters at worst-case JSON escaping (about 120 KB).

### D4: Plaintext

The app field-encrypts only identity-document values (`documentNumber`, `owner`, `issuer`);
titles, source links and summaries are plaintext, and the key lives in the same server
environment. The body is the same class of data as the title, so it is plaintext: AI processing
and a future keyword search work directly, and export needs no decryption. Encrypting Vault
bodies belongs with the future Vault step-up/security phase.

### D5: Share text rules (mobile, `src/utils/share-text.ts`)

Links are `http(s)://…` or `www.…`; trailing sentence punctuation is removed, and a closing
bracket only when the link does not contain its opener. `www.` links get `https://` for
`sourceUri` only.

| Shared text | sourceType | sourceUri | body | title |
|---|---|---|---|---|
| exactly one link, nothing else meaningful | url | the link | none | the link |
| one link + other text | url | the link | full original text | first line of the other text |
| no link | text | none | full original text | first useful line |
| two or more links | text | none | full original text | first useful line without links |

The body is always the exact input string. Titles are display-only, at most 100 characters.

### D6: Share payloads and idempotency

- Every delivered payload is considered. Native today: Android delivers exactly one (text/link or
  one image; `EXTRA_TEXT` with an image and `ACTION_SEND_MULTIPLE` are not exposed by the current
  configuration), iOS may deliver one text, one link and one image. Text and link are combined
  into one Memory; one image is attached to it. Unsupported items and any extra image are listed
  to the user (the screen waits for "Open memory"); nothing is dropped silently.
- A module-level map from a delivery fingerprint (payload types, values and URIs) to one
  idempotency key, kept for 10 minutes and never persisted; an in-flight guard stops concurrent
  processing of the same delivery; completed saves are only reopened. After the window, or after
  an app restart, the same content can be saved again on purpose.
- The API returns the winner's Memory when two requests with the same key race (Prisma P2002 on
  `idempotencyKey`) instead of failing with 500.

### D7: AI input

- Text (and image) Memories: the AI receives the full body; legacy Memories keep using the title.
- URL Memories with a body: `UnderstandInput.userText` carries it, labelled
  "Text the user wrote or shared with this link. These are the user's own words: not content
  fetched from or verified by the linked page." The link stands in for the text (as for a bare
  link) and admitted page metadata keeps its own label. Requests without user text are built
  exactly as before.
- Trust is unchanged: user text never admits page metadata and never replaces the link-only
  fallback, so a Facebook link without admitted metadata or a user image still ends `partial`
  without an AI call. Runs with user text keep the `llm_extraction` provenance.

### D8: Deletion

Memory finalization deletes the content row in the same transaction as setting
`lifecycleState = 'deleted'`; restore is only possible before that. Account deletion cascades.
Other Memory data keeps its existing retention (a separate issue).

## Deployment and compatibility

- **Order: API and migration first, then the app.** New app with an old API fails: the global
  `ValidationPipe` has `forbidNonWhitelisted` and rejects the unknown `body` field.
- Old app with the new API keeps working (body optional) but keeps cutting text until updated.
- No native build: no `app.json`, `expo-sharing` or dependency changes.

## Out of scope (separate phases)

Hybrid/keyword search, notifications, Home, SSE-C/storage, social trust beyond Facebook,
understanding a partial link from user text alone, attachment deletion, location, editing the
body, Android multi-image and image-caption shares (native), Vault body encryption.
