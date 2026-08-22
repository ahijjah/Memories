**Application Implementation Specification for Claude Code**

*Consolidated Product + UX + MVP + Architecture + Requirements +
Delivery Handoff*

**Implementation Baseline: Phases 1-5 \| MVP/V1**

# 1. How Claude Code Should Use This Document

This is the primary implementation handoff. Claude Code should treat the
MUST/V1 scope and numbered requirements as authoritative. Where a
technology is not explicitly fixed, choose a pragmatic, maintainable
option consistent with the architecture principles, document the
decision, and avoid expanding scope.

-   Do not implement SHOULD/LATER features unless needed as a technical
    foundation or explicitly approved.

-   Build in vertical slices and keep the application runnable after
    each milestone.

-   Never block successful capture on AI completion.

-   Never expose Vault content outside its authorization boundary.

-   Preserve original data, AI inference and user-confirmed corrections
    separately.

-   Write automated tests for critical business/security behavior.

-   Use environment variables/secret management; never commit
    credentials.

-   Create migrations, seed/demo data, README setup instructions and API
    documentation as the implementation evolves.

-   Use feature flags for incomplete or experimental
    intelligence/engagement features.

-   If a requirement is ambiguous, prefer the simplest behavior
    consistent with the product principles and record the assumption in
    an implementation decision log.

  -----------------------------------------------------------------------
  **PRODUCT PROMISE: SAVE ANYTHING. FIND ANYTHING. USE IT WHEN IT
  MATTERS.**
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

# 2. Product Definition

The application is an AI-assisted personal memory system. Users capture
useful information from social media, websites, screenshots, photos,
text and personal documents. The system understands and organizes
captures automatically, allows retrieval from vague clues, supports
questions across saved information, securely stores personal documents,
and proactively resurfaces useful information.

  -----------------------------------------------------------------------
  Core Loop                           Meaning
  ----------------------------------- -----------------------------------
  Capture                             Save with minimum friction from
                                      external apps or inside the app.

  Understand                          AI extracts meaning, type,
                                      entities, dates, intent, summary
                                      and searchable representation.

  Find                                Keyword + semantic search retrieves
                                      information even when exact
                                      source/date is forgotten.

  Use                                 Ask, summarize, extract, share,
                                      remind or take a contextual action.

  Rediscover                          Bring relevant saved information
                                      back when timing/context makes it
                                      useful.
  -----------------------------------------------------------------------

# 3. MVP Scope Boundary

  --------------------------------------------------------------------------------
  MUST / V1                        SHOULD / V1.x           LATER
  -------------------------------- ----------------------- -----------------------
  Capture: Share, URL,             Smart Workspaces        Advanced monitoring
  image/screenshot, camera, text,                          
  document scan                                            

  AI understanding + OCR           Compare / Travel /      Collaboration / family
                                   Learning intelligence   accounts

  Memory Library + Detail + basic  Calendar integration /  Deep integrations /
  Collections                      voice capture           marketplace

  Hybrid Search                    Basic monitoring /      Desktop/browser
                                   imports                 extension

  Ask My Memory with evidence      Advanced Collections    Commercial ecosystem

  Basic contextual actions                                 

  Vault + versions + expiry                                

  Reminder + Upcoming +                                    
  Rediscovery + weekly digest                              

  Security/privacy/export/delete                           
  --------------------------------------------------------------------------------

# 4. Target Platforms & Technical Baseline

The final stack may be selected by the implementation team after short
spikes. Recommended baseline:

  --------------------------------------------------------------------------------
  Area                    Preferred Baseline      Implementation Note
  ----------------------- ----------------------- --------------------------------
  Mobile                  Flutter or React Native Select after verifying native
                                                  Share, biometrics, camera/scan
                                                  and background behavior.

  Backend                 Modular monolith +      Avoid premature microservices.
                          asynchronous workers    

  Primary DB              Managed                 Use JSON where useful;
                          PostgreSQL-compatible   migrations mandatory.
                          relational DB           

  Vector Search           Postgres vector         Must support metadata/security
                          capability initially or filters.
                          managed vector layer    

  Object Storage          Private encrypted       No public Vault URLs.
                          managed object storage  

  Queue                   Managed durable job     Retry + idempotency required.
                          queue                   

  AI                      Provider abstraction    Support
                                                  OCR/multimodal/LLM/embeddings;
                                                  record model versions.

  Authentication          Managed/established     Secure token/session lifecycle.
                          identity solution       

  Push                    APNs + FCM abstraction  Channel rules configurable.

  Infrastructure          Managed cloud services  Dev/Staging/Prod separation.

  Observability           Logs + metrics +        No sensitive Vault content in
                          crash/error reporting   telemetry.
  --------------------------------------------------------------------------------

# 5. Logical Architecture

  -----------------------------------------------------------------------
  **MOBILE / SHARE -\> AUTH/API -\> INGESTION -\> DB + OBJECT STORAGE -\>
  JOB QUEUE -\> AI WORKERS -\> INDEX/RELATIONSHIPS -\> SEARCH/RAG -\>
  ACTIONS/ENGAGEMENT**
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Module                              Responsibilities
  ----------------------------------- -----------------------------------
  Mobile Client                       Onboarding, Home, Capture, Memory,
                                      Search, Ask, Vault, Activity,
                                      Settings.

  Share Extension/Target              Fast external capture with minimum
                                      UI.

  API Layer                           Auth, authorization, validation,
                                      CRUD, signed uploads/access.

  Memory Service                      Memory lifecycle, metadata,
                                      relationships, collections,
                                      corrections.

  Ingestion Service                   Durable capture, asset handling,
                                      dedupe, enqueue AI processing.

  AI Worker                           OCR, understanding, extraction,
                                      summary, embeddings,
                                      confidence/provenance.

  Search Service                      Full-text + semantic + metadata
                                      retrieval and ranking.

  Ask/RAG Service                     Retrieve authorized evidence, build
                                      context, answer, return Memory
                                      evidence.

  Vault Service                       Protected documents, people,
                                      versions, expiry, secure
                                      retrieval/share.

  Engagement Service                  Reminders, Upcoming, Rediscovery,
                                      digest, Activity.

  Privacy Service                     Export/delete orchestration and
                                      retention handling.

  Analytics/Operations                Product events, failures, latency
                                      and cost metrics.
  -----------------------------------------------------------------------

# 6. Core Data Model

  -----------------------------------------------------------------------
  Entity                              Required Fields / Notes
  ----------------------------------- -----------------------------------
  User                                id, profile, locale, plan,
                                      preferences, created_at.

  DeviceSession                       user_id, device_id, push_token,
                                      security/session metadata.

  Memory                              id, user_id, source_type,
                                      source_uri, memory_type, title,
                                      captured_at, processing_state,
                                      lifecycle_state, security_scope.

  MemoryAsset                         id, memory_id, object_key,
                                      mime_type, checksum, page/variant
                                      metadata.

  AIInference                         memory_id, field/type, value_json,
                                      confidence, provenance,
                                      model_version, created_at.

  UserConfirmation                    memory_id, field/type,
                                      confirmed_value, created_at.

  Entity                              id, entity_type,
                                      normalized_name/attributes.

  MemoryEntity                        memory_id, entity_id,
                                      relation_type, confidence,
                                      confirmed.

  Collection                          id, user_id, title,
                                      collection_type, automatic/manual.

  CollectionMemory                    collection_id, memory_id.

  Person                              id, user_id, name, relationship,
                                      optional protected metadata.

  VaultDocument                       memory_id, person_id,
                                      document_type, issue_date,
                                      expiry_date, version_status,
                                      previous/current linkage.

  Reminder                            id, user_id, memory_id, trigger_at,
                                      recurrence, status.

  Embedding                           memory/entity reference,
                                      embedding/model version, access
                                      scope.

  ActivityEvent                       id, user_id, event_type, target,
                                      importance, channel,
                                      feedback/status.

  Conversation                        id, user_id, scope/context,
                                      created_at.

  ConversationMessage                 conversation_id, role, content,
                                      evidence references, created_at.
  -----------------------------------------------------------------------

Precedence rule: User-confirmed value \> valid AI inference \>
original/raw fallback. Never destroy the original capture when a user
corrects AI metadata.

# 7. Required Processing States

  -----------------------------------------------------------------------
  State Group                         States
  ----------------------------------- -----------------------------------
  Capture                             local_pending, uploading, saved,
                                      upload_failed

  AI Processing                       queued, processing, understood,
                                      partial, failed

  Memory Lifecycle                    active, archived,
                                      deleted_pending/deleted

  Vault                               locked_client_state, authorized,
                                      historical/current/expired

  Reminder                            scheduled, triggered, completed,
                                      cancelled

  AI Confidence                       high, medium/verify_if_critical,
                                      low/avoid_action
  -----------------------------------------------------------------------

# 8. Capture Pipeline

-   Client creates capture request with source type and minimum
    metadata.

-   Backend creates durable Memory and upload target if asset is
    required.

-   Asset is uploaded and checksum recorded.

-   Server marks Memory saved and enqueues processing using an
    idempotency key.

-   Client receives Saved before AI processing completes.

-   Worker extracts/understands content and stores AIInference records.

-   Worker generates embedding/search document.

-   Worker evaluates relationships, dates/reminders and rediscovery
    candidates.

-   Client refreshes processing state; optional event/push can notify
    when enrichment materially changes the experience.

-   Retry must not create duplicate Memory records.

# 9. AI Processing Contract

  ----------------------------------------------------------------------------------------------------------------
  Output                              Expected Structure
  ----------------------------------- ----------------------------------------------------------------------------
  Title                               Short meaningful title.

  Type                                Controlled enum:
                                      article/video/post/image/note/document/event/place/product/tutorial/other.

  Topics                              List of normalized topics.

  Entities                            Typed entities with source/provenance and confidence.

  Intent                              Controlled values such as Learn, Try, Buy, Compare, Visit, Attend, Remember,
                                      Research.

  Dates                               value, semantic role, source text/page, confidence.

  Summary                             Short faithful summary.

  Useful Fields                       Type-specific structured JSON.

  OCR                                 Text plus page/region reference where available.

  Embedding Input                     Canonical searchable text assembled from safe fields.

  Confidence                          Per critical field, not only one global score.
  ----------------------------------------------------------------------------------------------------------------

-   Use JSON/structured schemas for extraction.

-   Critical dates/document fields at low/medium confidence must not
    silently create irreversible actions.

-   Store model/provider/prompt or pipeline version sufficient for
    debugging/evaluation.

-   Do not use Vault/document content for model training.

-   Provider failures must result in partial/failed enrichment, not loss
    of capture.

# 10. Search Specification

-   Implement hybrid retrieval: full-text + semantic vector + structured
    filters.

-   Supported filters: type, source, date, intent, available
    location/entity/person context.

-   Default context is All Memory.

-   Search launched from a narrower context may inherit that scope.

-   Apply authorization/security scope before content is returned.

-   Rank for recognition: title, summary/snippet, source/date and useful
    visual cue.

-   Weak results must be presented as possible matches rather than
    certainty.

-   Provide a path from Search to Ask when no strong match exists.

# 11. Ask My Memory / RAG Specification

-   Input: user question + conversation ID + current Memory Context.

-   Retrieve authorized candidate Memories using hybrid search.

-   Build compact evidence with Memory IDs and relevant
    excerpts/structured fields.

-   Generate answer constrained to evidence for personal-Memory facts.

-   Return answer + evidence list + optional contextual actions.

-   If evidence is insufficient, explicitly say so and show best
    available Memories.

-   Follow-up questions reuse conversation context but re-run retrieval
    as needed.

-   Vault evidence is excluded unless the security policy says the
    current session/context is authorized.

-   Conversation is not automatically saved as Memory.

  -----------------------------------------------------------------------
  **RAG RULE: PERSONAL FACTS REQUIRE SUPPORTING MEMORY EVIDENCE.**
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

# 12. Vault & Personal Documents

  -----------------------------------------------------------------------
  Capability                          Required Behavior
  ----------------------------------- -----------------------------------
  Entry                               Vault Home may be visible, but
                                      protected content requires
                                      authorization.

  Scan                                Multi-page document scan,
                                      crop/quality feedback.

  OCR/Extraction                      Document type, owner, issue/expiry
                                      and critical fields.

  Verification                        User confirms uncertain critical
                                      fields.

  Versioning                          New current document may replace
                                      current status; previous copy
                                      remains historical.

  Retrieval                           Search/browse by person, type,
                                      expiry and history.

  Share                               Generate authorized temporary
                                      access/share flow; never public
                                      permanent URL.

  Security                            Private storage, strong
                                      auth/session, biometrics gate,
                                      least privilege.

  Logging                             No document numbers/full OCR text
                                      in normal logs/analytics.

  Deletion                            Remove original and derived
                                      representations according to
                                      retention policy.
  -----------------------------------------------------------------------

Implementation must include a documented Vault threat model and security
review before real sensitive beta data is encouraged.

# 13. Main Screens to Implement

  --------------------------------------------------------------------------
  ID                      Screen                     Core Content
  ----------------------- -------------------------- -----------------------
  S01                     Onboarding & First Capture Value proposition,
                                                     Share teaching, first
                                                     capture.

  S02                     Home                       Ask shortcut, For You,
                                                     Suggestions, Upcoming,
                                                     Rediscover, Recent.

  S03                     External Share Capture     Saved confirmation,
                                                     processing, optional
                                                     actions, return to
                                                     source.

  S04                     Internal Capture           Camera,
                                                     screenshot/photo, scan
                                                     document, link, text.

  S05                     Memory Library & Search    Search, filters,
                                                     list/cards,
                                                     Collections.

  S06                     Memory Detail              Original, AI
                                                     understanding, summary,
                                                     actions, related,
                                                     correction.

  S07                     Ask My Memory              Scope, conversation,
                                                     evidence cards,
                                                     actions.

  S08                     Smart Workspace            Architecture-ready but
                                                     SHOULD/V1.x; do not
                                                     block MVP.

  S09                     Vault Home                 Documents, People,
                                                     Expiring, Scan.

  S10                     Document                   Scan, extract, verify,
                          Scan/Verification/Detail   version, secure detail.

  S11                     Activity                   Attention, suggestions,
                                                     monitoring
                                                     placeholder/history,
                                                     feedback.

  S12                     Settings                   Account, security,
                                                     privacy, AI,
                                                     notifications,
                                                     export/delete.
  --------------------------------------------------------------------------

# 14. Navigation

  -----------------------------------------------------------------------
  **BOTTOM NAVIGATION: HOME \| MEMORY \| + CAPTURE \| ASK \| VAULT**
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

-   Activity is accessible from Home header.

-   Settings/profile is accessible from account/profile entry.

-   Back navigation must preserve current Search/Ask state where
    reasonable.

-   Protected Vault routes must re-check authorization according to
    session policy.

-   Deep links from notifications should resolve to the correct
    authorized Memory/action.

# 15. Core Functional Requirements

  -----------------------------------------------------------------------
  ID                                  Requirement
  ----------------------------------- -----------------------------------
  FR-CAP-001                          Native OS share capture shall save
                                      without mandatory folder/tag
                                      selection.

  FR-CAP-002                          MVP shall support URL,
                                      image/screenshot, camera, text and
                                      document scan.

  FR-CAP-003                          Capture success shall be
                                      independent of AI success.

  FR-MEM-001                          User shall browse all authorized
                                      Memories.

  FR-MEM-002                          Memory Detail shall expose original
                                      content, AI interpretation, actions
                                      and related Memories.

  FR-MEM-003                          User shall correct AI-generated
                                      metadata.

  FR-SRCH-001                         Search shall support vague
                                      natural-language queries.

  FR-SRCH-002                         Search shall support hybrid ranking
                                      and filters.

  FR-ASK-001                          Ask shall answer across authorized
                                      Memories.

  FR-ASK-002                          Memory-grounded answers shall
                                      expose supporting Memories.

  FR-VLT-001                          User shall securely
                                      scan/store/retrieve personal
                                      documents.

  FR-VLT-002                          Vault shall support person, type,
                                      issue/expiry and historical
                                      versions.

  FR-ENG-001                          System shall support explicit
                                      reminders and Upcoming.

  FR-ENG-002                          System shall support basic
                                      Rediscovery and weekly digest.

  FR-PRV-001                          User shall export/delete account
                                      data.

  FR-SEC-001                          Ownership/security authorization
                                      shall apply to every private
                                      content access.
  -----------------------------------------------------------------------

# 16. Business Rules

  -----------------------------------------------------------------------
  ID                                  Rule
  ----------------------------------- -----------------------------------
  BR-001                              Successful capture remains saved
                                      even if AI fails.

  BR-002                              User-confirmed data overrides
                                      conflicting AI inference.

  BR-003                              Original content is retained
                                      separately from AI interpretation.

  BR-004                              Critical uncertain document/date
                                      fields require verification.

  BR-005                              Vault content cannot be exposed
                                      without required authorization.

  BR-006                              Removing a relationship/Collection
                                      does not delete the Memory.

  BR-007                              Replacing a document version does
                                      not delete historical versions.

  BR-008                              Push is for explicit/high-value
                                      time-sensitive events; relevance
                                      belongs on Home/digest.

  BR-009                              Source-platform limitations must be
                                      handled gracefully.

  BR-010                              Plan limits and engagement
                                      thresholds are
                                      configuration-driven.
  -----------------------------------------------------------------------

# 17. Error, Offline & Idempotency Requirements

-   Use client/server idempotency keys for capture creation and job
    execution.

-   Temporary network loss should queue normal capture locally where
    feasible.

-   Upload retry must resume/retry safely without creating duplicate
    Memories.

-   AI provider timeout/failure must leave Memory readable.

-   Source-unavailable state preserves Memory metadata/preview already
    stored.

-   Ask/Search failures return retryable controlled errors.

-   Vault authentication failure reveals no protected details.

-   Backend errors include non-sensitive correlation IDs.

-   Queue jobs use bounded retries + dead-letter/error handling.

# 18. Security & Privacy Implementation Requirements

-   TLS for all external/internal transport as applicable.

-   Encryption at rest using managed cloud capabilities and approved key
    management.

-   Least-privilege service/database/object permissions.

-   Private object storage; signed/short-lived access.

-   Secure secret storage and rotation.

-   Server-side authorization; never rely only on client hiding.

-   Sensitive log redaction.

-   Dev/Staging/Prod isolation.

-   Data export and deletion orchestration includes DB, objects,
    vector/search data and derived AI records.

-   Backup/recovery policy and tested restoration.

-   Dependency/security scanning and pre-launch penetration/security
    assessment.

-   Document third-party AI processor retention/training behavior.

# 19. Analytics Events

  ------------------------------------------------------------------------------------------------------------------
  Domain                              Required Events
  ----------------------------------- ------------------------------------------------------------------------------
  Activation                          onboarding_started/completed, first_capture_started/saved/understood

  Capture                             capture_started/saved/ai_failed/retry, duplicate_detected

  Memory                              memory_opened/corrected/archived/deleted

  Search                              search_submitted/result_opened/no_result/filter_used

  Ask                                 ask_submitted/answered/insufficient_evidence/evidence_opened/action_taken

  Vault                               unlock_attempt/unlocked/document_scan_started/document_saved/document_shared

  Engagement                          reminder_created, rediscovery_shown/opened/not_useful, digest_opened

  Retention                           2nd/5th/10th capture and cohort retention

  Cost                                AI units/cost, Ask cost, storage, processing latency
  ------------------------------------------------------------------------------------------------------------------

Never place sensitive Vault content or document identifiers in analytics
payloads.

# 20. API Surface - Minimum Logical Endpoints

  -------------------------------------------------------------------------------
  Area                                Example Logical Operations
  ----------------------------------- -------------------------------------------
  Auth/User                           session/profile/preferences/devices/plan.

  Memory                              create, get, list, update/correct, archive,
                                      delete, processing-status.

  Assets                              create-upload, complete-upload,
                                      authorized-download/preview.

  Search                              query + filters + context.

  Ask                                 ask, follow-up, conversation retrieval.

  Collections                         list/create/update/add/remove Memory.

  Vault                               unlock/session policy, documents
                                      list/detail, scan finalize, version update,
                                      secure share.

  People                              list/create/update for Vault association.

  Reminder                            create/list/update/cancel.

  Activity                            list/feedback/action.

  Privacy                             export request/status, delete
                                      request/status.

  Admin/Operations                    health/readiness only; no user-sensitive
                                      admin exposure.
  -------------------------------------------------------------------------------

Exact REST/GraphQL choice is implementation-specific. Publish an
OpenAPI-equivalent contract if REST is used.

# 21. Repository / Code Organization Recommendation

Use a monorepo unless team/tooling strongly prefers otherwise.

  -----------------------------------------------------------------------
  Path                                Purpose
  ----------------------------------- -----------------------------------
  /apps/mobile                        Mobile application.

  /apps/api                           Backend API / modular monolith.

  /apps/worker                        Async AI/processing workers if
                                      separated from API runtime.

  /packages/contracts                 Shared schemas/API models where
                                      language/tooling permits.

  /packages/ai                        AI provider adapters, schemas,
                                      prompts/pipeline versions,
                                      evaluations.

  /packages/domain                    Domain rules/types where practical.

  /infra                              Infrastructure-as-code and
                                      environment configuration
                                      templates.

  /docs                               Architecture decisions, API docs,
                                      threat model, runbooks.

  /tests/e2e                          Critical end-to-end scenarios.

  /scripts                            Development, migration, seed and
                                      evaluation utilities.
  -----------------------------------------------------------------------

# 22. Engineering Epics & Implementation Order

  ------------------------------------------------------------------------------------------
  Order                   Epic                    Definition
  ----------------------- ----------------------- ------------------------------------------
  0                       Spikes                  Share, AI/OCR, Search, RAG,
                                                  Vault/security, offline.

  1                       E1 Mobile Foundation    App shell, auth, navigation, settings.

  2                       E3 Memory Platform      DB, APIs, storage, lifecycle.

  3                       E2 Capture              Share + internal capture + queue/upload.

  4                       E4 AI                   OCR/understanding/extraction/embeddings.

  5                       E5 Memory UX            Library, Detail, corrections, related.

  6                       E6 Search               Hybrid retrieval and filters.

  7                       E7 Ask                  RAG and evidence.

  8                       E8 Vault                Secure document end-to-end.

  9                       E9 Engagement           Reminder, Upcoming, Rediscovery, digest,
                                                  Activity.

  10                      E10 Privacy/Account     Export/delete/settings/plan.

  11                      E11/E12 Hardening       Analytics, QA, CI/CD, observability,
                                                  release.
  ------------------------------------------------------------------------------------------

# 23. Definition of Done for Each Feature

-   Requirement and acceptance criteria implemented.

-   Automated tests added for critical logic.

-   API/schema/migration changes documented.

-   Loading, empty, failure and permission states implemented.

-   Analytics added where specified and verified for privacy.

-   Security/authorization checks covered.

-   Accessibility basics checked.

-   Feature works in Staging.

-   No known Critical/High defect.

-   README/runbook updated where operational behavior changes.

# 24. Required End-to-End Tests

-   T01 External social/web share -\> Saved -\> AI enrichment -\> Memory
    Detail.

-   T02 Screenshot/photo -\> OCR -\> vague Search -\> intended Memory.

-   T03 Multiple product Memories -\> Ask comparison -\> evidence.

-   T04 Event capture -\> date verification -\> Upcoming/reminder.

-   T05 Son passport -\> scan -\> OCR -\> person/expiry -\> previous
    version -\> secure retrieve/share.

-   T06 AI wrong metadata -\> user correction -\> Search/Detail use
    corrected value.

-   T07 AI provider failure after capture -\> Memory survives -\> retry
    succeeds.

-   T08 Temporary network failure -\> queued/retried capture -\> no
    duplicate.

-   T09 Rediscovery -\> Home -\> open -\> Useful/Not Useful feedback.

-   T10 Export/delete -\> primary + derived data workflow.

# 25. Seed / Demo Dataset

-   Istanbul Trip: restaurant post, hotel link, attraction video and
    event/date.

-   New Laptop Decision: 3 product/article Memories with specs and
    prices captured as content, not live monitoring.

-   Gardening Learning: YouTube tutorial + notes + related older
    content.

-   Conference: event poster/page with date and location.

-   Family Documents: synthetic sample passport documents for
    parent/child with current + expired version. Never commit real
    personal documents.

-   General saved social posts, screenshots, articles and notes.

# 26. MVP Acceptance Gate

1\. Share capture works reliably and quickly.

2\. Capture survives AI failure.

3\. AI understands representative normal captures at acceptable quality.

4\. User finds an item from vague clues.

5\. Ask answers with visible supporting Memories.

6\. Vault document is securely captured, versioned, retrieved and
shared.

7\. Reminder/rediscovery provides useful automatic value.

8\. AI correction works.

9\. Export/delete works.

10\. Production observability/backups/security controls are operational.

11\. AI and infrastructure cost per active user is measurable.

# 27. Implementation Deliverables Expected from Claude Code

-   Runnable mobile application and backend.

-   Database migrations and seed/demo data.

-   Share-extension/target implementation for supported platforms.

-   AI processing pipeline with provider adapters and structured
    schemas.

-   Hybrid Search and Ask/RAG implementation.

-   Vault secure document flow.

-   Reminder/engagement baseline.

-   Automated unit/integration/end-to-end tests.

-   CI configuration and environment templates.

-   API documentation.

-   Architecture Decision Records (ADRs) for major stack/security
    decisions.

-   Vault threat model/data-flow documentation.

-   README with local development, test and deployment instructions.

-   Operational runbook for queues, AI failures, backups and incident
    basics.

-   AI evaluation scripts/test corpus and cost/latency measurement.

# 28. Explicit Non-Goals for MVP

-   Do not build a full social network.

-   Do not implement deep API integration with every social platform.

-   Do not build advanced price monitoring.

-   Do not build collaborative Workspaces or family accounts.

-   Do not build desktop/browser extensions.

-   Do not build a marketplace or commercial recommendation engine.

-   Do not build sophisticated travel itinerary optimization.

-   Do not over-engineer microservices or introduce a graph database
    without demonstrated need.

# 29. First Implementation Tasks

1.  Create repository/monorepo skeleton and development README.

2.  Create ADR-001 covering mobile framework, backend
    language/framework, cloud, database and AI provider baseline.

3.  Implement Dev environment and CI skeleton.

4.  Build SP-01 Share Extension prototype on iOS and Android.

5.  Build SP-02 representative AI/OCR benchmark using only
    synthetic/non-sensitive samples.

6.  Create initial ERD/migrations for User, Memory, Asset, AIInference
    and UserConfirmation.

7.  Implement authenticated create-Memory + asset upload + Saved
    response.

8.  Implement durable processing queue and idempotent worker skeleton.

9.  Build the first vertical slice: Share URL/Image -\> Saved -\> AI
    title/summary -\> Memory Detail.

10. Add analytics/error instrumentation before expanding the feature
    set.

# 30. Handoff Instruction

  -----------------------------------------------------------------------
  **IMPLEMENT THE MVP IN VERTICAL SLICES. KEEP CAPTURE RELIABLE, AI
  EVIDENCE-GROUNDED, VAULT SECURE, AND SCOPE CONTROLLED.**
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

Claude Code should begin with architecture spikes and the first vertical
slice rather than attempting to generate the entire application in one
pass. At each milestone, run tests, update documentation, record
architecture decisions, and verify the current build against this
specification. Any deviation from a MUST requirement should be
explicitly documented with reason, impact and proposed resolution.
