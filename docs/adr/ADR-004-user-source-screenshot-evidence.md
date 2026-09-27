# ADR-004: User source screenshot evidence

**Status:** Accepted
**Date:** 2026-09-27
**Scope:** FACEBOOK-USER-EVIDENCE-01. Builds on the Facebook deny-by-default (PR16) and the
Facebook correspondence diagnostics (PR-FB-A); changes neither.

## Context

A Facebook share on Android delivers one URL and nothing else (runtime diagnostic: `text/plain`,
`EXTRA_TEXT` is a single URL, ClipData only duplicates it, no subject/title/HTML/stream). Fetching
that URL logged out does not return trustworthy item content, and Facebook page metadata stays
denied for AI enrichment. Such Memories end `partial`: a saved link without AI understanding.

The processor already analyses a URL Memory's own uploaded images when page metadata is rejected,
but nothing recorded what those images are, the model was not told, and the resulting inferences
were indistinguishable from any other.

## Decisions

### D1: Explicit, immutable evidence role on the asset

- New enum `AssetEvidenceRole { source_screenshot }` and nullable `MemoryAsset.evidenceRole`.
  `NULL` is an ordinary attachment (all existing rows; no backfill).
- The role is set only by `POST /assets/complete-upload` (`evidenceRole: "source_screenshot"`),
  when the asset row is created. There is no endpoint that changes it.
- Rules for `source_screenshot`, on top of the existing ones (owner, not deleted, object key bound
  to the Memory, object exists): the Memory is `sourceType = url` with a `sourceUri`; the declared
  type is one of `image/jpeg|png|gif|webp` (the provider's vision formats); the stored object's
  type matches the declared type. The row stores the canonical type (lower-case, no parameters),
  which is what the AI receives. Ordinary uploads keep the declared type unchanged.
- Retries of complete-upload for the same key: 409 if the role, type, page index or (when both
  sides have one) checksum differs. A matching retry while the Memory is still `queued` re-runs the
  normal image-source enqueue, recovering a first request whose enqueue failed; `jobId = memoryId`
  makes that a no-op while the job exists, and once a run starts the state leaves `queued`.
- Not Facebook-only, and no new Vault rule: Vault uploads are already allowed for the owner.

### D2: The screenshot is user evidence, never source evidence

- It enters the AI only through the user-asset channel. It does not touch URL trust
  classification, correspondence, the Facebook deny-by-default, or og:image admission.
- When a source screenshot is among the images sent, the provider labels every image and the text
  with fixed server-authored text, e.g. *"A screenshot the user provided, claimed to show the
  shared link. It was not obtained from or verified by the linked site."* The link is presented as
  *"Link the user shared (not opened or verified by this system)"*.
- Requests without a source screenshot are built exactly as before (verified byte-for-byte).

### D3: Inference provenance and evidence references

- Output of a run that used a source screenshot is stored with
  `provenance = 'llm_user_source_screenshot'` and `AIInference.evidenceRefs` (JSONB):
  `{ v: 1, assets: [{ id, role: 'source_screenshot' | null }], pageMetadata: 'none' | 'admitted' | 'rejected' }`.
  `assets` lists, in prompt order, exactly the user assets whose bytes reached the model.
- Runs without one write the same rows as before (`llm_extraction`, no `evidenceRefs`).
- The stale-output cleanup on a link-only fallback deletes both LLM provenances.
- Inferences are appended and each field resolves to its newest present value. So when a
  successful run did not send a source screenshot to the model (for example the screenshot failed
  to load while another photo did), the same batch transaction that writes the new results first
  deletes the Memory's `llm_user_source_screenshot` rows. This happens only after the AI call
  succeeded, never in a run that used a screenshot, and only on Memories that have a source
  screenshot asset (the only place such rows can exist).

### D4: Mobile

A partial link Memory (outside the Vault) offers "Add screenshot", which reuses the existing
picker/upload/reprocess flow with the role. Screenshot-derived understanding shows "Based on a
screenshot you added. Not verified with Facebook." (or "…the linked site."). The public resolved
contract (ADR-003) is unchanged; the app reads provenance from the owner's detail `aiInferences`.

## Consequences and follow-ups (not done here)

- **DB uniqueness for complete-upload:** retries are idempotent in the service (same key and role
  returns the existing asset; a different role or shape is 409), but two concurrent first requests
  can still both register. A unique index on `memory_assets.objectKey` needs a production duplicate
  check first.
- **Vault reprocess:** Vault Detail and the document scanner call `POST /memories/:id/reprocess`,
  which returns 404 for Vault Memories. The screenshot prompt is therefore not shown in the Vault.
- **Failed or partial screenshot run (UX):** once a screenshot exists the prompt hides; if that run
  fails or falls back to a partial link, the app offers no retry, replace or delete path.
- **Single-asset deletion:** none exists; a wrong screenshot can only be corrected by field
  confirmations or deleting the Memory. Any future asset deletion must also reprocess or clean up
  inferences that reference it.
- **Official provider evidence (e.g. Meta oEmbed):** not implemented; `provider_authenticated` is a
  reserved evidence kind that nothing produces.
- **Screenshot relevance:** nothing proves a screenshot shows the linked item; it is presented as
  the user's claim only.
