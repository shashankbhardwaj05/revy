# AI Notetaker — Orchestration & Architecture

**Status of this document:** authoritative long-term plan. Anything not marked ✅ below is
not built yet. If a future session (human or model) is unsure what to do next, read this
file before touching code.

Legend: ✅ Done &nbsp;·&nbsp; 🚧 Partial / scaffolded but not real &nbsp;·&nbsp; ⬜ Not started

---

## 0. Vision

Build an AI meeting notetaker that:

1. Joins Google Meet calls as a bot (Recall.ai in V1).
2. Live-transcribes the meeting.
3. Runs a **segment-detection engine** that checks whether required meeting segments
   (Introductions, Discovery, Demo, Pricing, Next Steps, etc.) have been covered — segments
   are fully user-defined via editable **playbooks**, not hardcoded.
4. Surfaces live segment completion in a **Chrome extension widget** overlaid on the Meet
   tab.
5. After the call: stores transcript, summary, checklist completion, and evidence snippets.
6. Syncs the final analysis to **Airtable** (internal ops mirror) and then to **HubSpot**
   (on the matching deal/contact/company).

Long-term, the bot-based capture (Recall.ai) should be swappable for a Granola-style
local/desktop capture with no visible meeting bot — hence the `CaptureProvider`
abstraction from day one, even though only `RecallBotProvider` is implemented in V1.

Versions:

- **V1** — manual URL input → Recall bot → live transcript → live segment detection →
  extension widget → basic admin dashboard → Airtable sync → HubSpot sync (mock mode OK).
- **V2** — Calendar auto-join, better HubSpot matching, deal-specific playbooks, post-meeting chat.
- **V3** — Live coaching (objection detection, talk ratio, question quality, risk score).
- **V4** — Granola-style local/desktop capture, botless mode, `CaptureProvider` swap.
- **V5** — Full RevOps meeting intelligence platform (AE analytics, playbook experiments, coaching loops).

---

## 1. Current Status — what's actually built (tick list)

This is the honest state of `~/ai-notetaker` as of this document's authoring. Two commits
exist (`58db0ce` bootstrap, `3dff5f9` meetings persistence). Everything below that isn't
ticked is **not built**, regardless of what any earlier conversation may have implied.

### Repo / infra
- ✅ pnpm workspace + Turborepo monorepo scaffolded
- ✅ TypeScript strict mode base config shared across packages
- ✅ Postgres hosted on Supabase (all environments incl. local dev) — migrated, verified end-to-end
- ⬜ Docker Compose for local Redis (Postgres no longer needs this — Supabase covers it everywhere)
- ⬜ Redis running/installed at all
- ⬜ CI (no `.github/workflows`)
- ⬜ Lint config (no ESLint/Prettier)
- ⬜ Tests of any kind

### Apps
- 🚧 `apps/api` — NestJS + Fastify adapter running, health check, but only a bare `MeetingsModule`
  (`POST/GET /meetings`) — no webhooks, no sessions, no auth, no orgs
- 🚧 `apps/web` — Next.js app with a paste-link form and a meeting library list — no admin
  dashboard, no playbook editor, no transcript viewer
- 🚧 `apps/worker` — process boots, zero BullMQ processors wired
- ⬜ `apps/extension` — **does not exist yet**

### Packages
- 🚧 `packages/contracts` — only `MeetingStatus`, `CreateMeetingRequest`, `MeetingSummary`,
  `Utterance` — none of the playbook/segment/sync contracts exist
- ✅ `packages/config` — env loading/validation via Zod
- ✅ `packages/recall` — bot creation, status polling, and transcript retrieval
  confirmed against a real bot + live call (2026-07-03, see §18 M2 findings); only the
  real-time webhook delivery path remains unverified (needs M4's public endpoint)
- 🚧 `packages/db` — Prisma + Postgres wired and migrated, but schema has **one table**
  (`meetings`) — none of the 20+ entities in §6 exist
- ⬜ `packages/hubspot`, `packages/airtable`, `packages/ai`, `packages/ui`, `packages/shared` — don't exist

### Functional capability
- ✅ Paste a Meet URL → row persisted in Postgres → shows in a library UI
- ✅ If `RECALL_API_KEY` is set, creates a real Recall bot that joins, records, and
  transcribes — confirmed working end-to-end against a live call (2026-07-03)
- ⬜ Real-time transcript ingestion (no webhook/websocket receiver exists)
- ⬜ Segment detection engine
- ⬜ Chrome extension of any kind
- ⬜ Playbooks (editable checklists) — the `MeetingStatus` enum doesn't even have `transcribing`,
  `processing_final_analysis`, `synced_to_airtable`, `synced_to_hubspot` yet — the lifecycle
  needs to be widened to match §5 below
- ⬜ Airtable sync
- ⬜ HubSpot sync
- ⬜ Auth / orgs / users (no `organizations`, `users`, `auth_accounts` tables)

### Process
- ⬜ Git branching strategy — both commits went straight to `main`, no feature branches used yet
- 🚧 Commit style — messages are Conventional-Commits-shaped but there's been no PR flow (solo, direct-to-main)
- ⬜ `docs/architecture/*.md` suite (event-flow, data-model, extension, recall-ai, airtable-hubspot-sync) — only this file exists so far
- ⬜ `docs/runbooks/webhook-debugging.md`, `docs/runbooks/failed-sync-retry.md`

**Bottom line:** what exists today is V1 step 1, confirmed working end-to-end against a
real Recall bot and a live call (manual URL → persisted row → real bot → real
transcription). Steps 2–8 of the vision (real-time ingestion, segment detection,
extension, Airtable, HubSpot) are all still ahead of us, as is widening the data model to
support playbooks/orgs/multi-tenancy at all.

---

## 2. Stack Decisions (with justification)

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Already in place; incremental caching per-package matters once `packages/ai`, `packages/hubspot`, etc. are added. |
| Backend API | **NestJS + Fastify adapter** (already chosen) | Nest's module/DI system scales well once we add auth guards, org-scoped middleware, and a WebSocket gateway (`@nestjs/websockets` is first-class) — all things this project needs. Fastify adapter keeps raw HTTP throughput high for the webhook endpoint, which must ack fast. Picked over bare Express/Fastify because the segment engine, sync jobs, and multi-provider capture abstraction benefit from Nest's structured module boundaries more than they'd suffer from its ceremony. |
| Realtime | Nest `@nestjs/websockets` gateway (Socket.IO adapter) | One gateway, rooms keyed by `meetingSessionId`; the extension and admin dashboard both subscribe to the same room. Reconnect/resync is a solved problem in Socket.IO — don't hand-roll raw WS reconnection logic. |
| Queue | BullMQ + Redis | Webhook handlers must ack in <200ms and hand off; BullMQ gives retries, backoff, and dead-letter queues out of the box, which every async job here (transcript processing, segment detection, Airtable sync, HubSpot sync) needs for idempotency and observability. |
| Database | PostgreSQL, hosted on **Supabase** (all environments, including local dev) | Relational integrity matters here — meetings, sessions, transcripts, playbooks, segments, sync jobs are all foreign-keyed to each other; this is not a document-shaped problem. Supabase was chosen over self-hosted/Neon because it bundles Postgres + Auth + S3-compatible Storage in one project, which is the actual "fewer moving parts" win — an Airtable-as-primary-DB alternative was considered and rejected: Airtable's 5 req/s rate limit, lack of transactions, and no jsonb support make it unworkable for the live transcript/segment-detection hot path (still used as the ops mirror per §11, exactly as originally planned). |
| ORM | **Prisma** (already chosen) over Drizzle | This schema has ~20 entities with many relations and enums (§6). Prisma's declarative schema + `migrate dev`/`migrate deploy` workflow is a better fit for a schema that will churn quickly across V1–V3 than Drizzle's more SQL-adjacent, migration-by-hand style. Trade-off accepted: Prisma's runtime is heavier and query control is less granular — acceptable here since none of these tables are on a latency-critical hot path. |
| Chrome extension | Manifest V3, TypeScript, React, content script + popup + background service worker | Required by Chrome policy (MV3 mandatory for new extensions). React only in the popup and the injected widget's shadow-DOM root, not the whole content script, to keep the injected bundle small. |
| Web dashboard | Next.js | Already chosen; server components suit the admin/review surfaces (meeting detail, transcript viewer) that primarily read data. |
| Internal ops mirror | Airtable API | Per vision — ops mirror, not source of truth. |
| CRM sync | HubSpot API | Per vision. |
| Object storage | Supabase Storage (S3-compatible) | For raw provider payload dumps, long transcript exports, debug artifacts — keeps Postgres row sizes sane. Same Supabase project as the database, no separate bucket/provider to manage. |
| Auth | Google OAuth via Supabase Auth first, email/password as fallback | Sales orgs already live in Google Workspace; OAuth also gives us the participant email needed for HubSpot contact matching for free. Supabase Auth avoids standing up a separate auth provider. Design allows org/team workspaces from the first migration (`organizations` table exists even if only one org is seeded initially). |
| Deployment | Render (or Railway/Fly — pick one at deploy time) for api/worker/web; Supabase Postgres; Redis add-on | Small team, no need for k8s yet; Supabase covers the database identically across local/staging/prod, Render/Railway covers compute + Redis with minimal ops overhead. Revisit if/when scale demands it. |

---

## 3. System Architecture

```
                                   ┌─────────────────────┐
                                   │   Chrome Extension   │
                                   │ (content script in   │
                                   │  meet.google.com)    │
                                   └──────────┬───────────┘
                                     WS (rooms per session)
                                              │
┌──────────────┐   HTTPS    ┌────────────────▼───────────────┐    ┌───────────────┐
│  Next.js Web │───────────▶│         apps/api (NestJS)       │───▶│  Postgres      │
│  Dashboard   │◀───────────│  REST + WebSocket Gateway        │    │  (source of    │
└──────────────┘            │  /meetings /playbooks /webhooks  │    │  truth)        │
                             └───────┬───────────────┬─────────┘    └───────────────┘
                                     │ enqueue        │ webhook verify
                                     ▼                │
                             ┌───────────────┐        │
                             │  Redis/BullMQ │        │
                             └───────┬───────┘        │
                    ┌────────────────┼─────────────┐  │
                    ▼                ▼             ▼  │
          ┌──────────────┐  ┌────────────────┐ ┌──────────────┐
          │ Transcript    │  │ Segment        │ │ Sync workers │
          │ processing    │  │ detection      │ │ (Airtable,   │
          │ worker        │  │ worker         │ │  HubSpot)    │
          └──────┬────────┘  └───────┬────────┘ └──────┬───────┘
                 │ writes            │ writes           │
                 ▼                   ▼                  ▼
             Postgres            Postgres          Airtable / HubSpot APIs
                                                           ▲
                                                           │
                                                   ┌────────────────┐
                                                   │   Recall.ai    │
                                                   │ (bot, webhook) │
                                                   └────────────────┘
```

`apps/api` is the only thing that talks to Postgres for writes coming from HTTP; workers
own the queue-driven writes. The Recall webhook endpoint does **verification + enqueue
only** — no processing inline.

---

## 4. Event Flow — meeting start to HubSpot sync

1. **Session creation** — user (via dashboard or extension) pastes a Meet URL, optionally
   picks a playbook. `POST /sessions` → `MeetingScheduler` creates a `meeting` +
   `meeting_session` row, resolves org/user/playbook, calls
   `CaptureProvider.createSession()`.
2. **Bot dispatch** — `RecallBotProvider.createSession()` calls Recall.ai to create/schedule
   a bot with transcript config + our webhook URL. Response stored in `recall_bots` +
   `capture_sessions`. Session status → `scheduled` / `bot_joining`.
3. **Bot joins** — Recall sends a `bot.joined` webhook. `RecallWebhookController` verifies
   the signature, enqueues a `webhook-events` job, stores the raw payload in
   `transcript_raw_events`, acks 2xx immediately. A queue consumer updates session status →
   `bot_joined` → `recording` → `transcribing`, and emits the new status over the WebSocket
   gateway to any connected extension/dashboard clients.
4. **Live transcript** — Recall streams `transcript.data` webhook events (or websocket,
   whichever the spike confirms is the real mechanism — see §11). Each event is verified,
   stored raw, and enqueued onto the `transcript-processing` queue.
5. **Transcript processing worker** normalizes the raw payload into
   `transcript_utterances`/`transcript_words`, appends to the meeting's live transcript
   state, and emits an incremental transcript update over the WebSocket gateway. It also
   pushes the latest rolling window of text onto the `segment-detection` queue.
6. **Segment detection worker** runs the hybrid rule+LLM check (§9) against the rolling
   window for every `not_started`/`detected_in_progress` segment in the session's playbook.
   On a state change it writes `meeting_segment_states` + `segment_evidence`, and emits the
   update over the WebSocket gateway — this is what flips a tick in the extension widget
   live.
7. **Meeting ends** — Recall sends a `bot.left`/`call_ended` webhook (or the worker detects
   no further transcript events past a timeout). Session status → `meeting_ended` →
   `processing_final_analysis`. A finalization job: pulls the full transcript, generates
   `meeting_summaries`/`meeting_analysis` (LLM), marks any required segment still
   `not_started` as `missed`.
8. **Airtable sync** — `airtable-sync` job picks up the finalized `meeting_analysis`,
   upserts an idempotent record keyed by `meeting_session.id`, logs the job in
   `airtable_sync_jobs`. Status → `synced_to_airtable`.
9. **HubSpot sync** — `hubspot-sync` job resolves the matching deal/contact/company using
   the fallback order in §11, upserts custom properties + creates a note/engagement, logs in
   `hubspot_sync_jobs`. Status → `synced_to_hubspot` → `completed`.

Any step can fail independently without corrupting earlier state — each writes its own
status and the meeting lifecycle (§5) reflects exactly how far it got, with `failed` used
only when a step exhausts its retries.

---

## 5. Meeting & Segment Lifecycles

### Meeting session lifecycle
`created → scheduled → bot_joining → bot_joined → recording → transcribing →
meeting_ended → processing_final_analysis → synced_to_airtable → synced_to_hubspot →
completed` (with `failed` reachable from any state).

> ⚠️ The current `packages/contracts` `MeetingStatus` only has 9 of these 12 states
> (missing `transcribing`, `processing_final_analysis`, `synced_to_airtable`,
> `synced_to_hubspot`). This needs a migration before webhook ingestion work starts.

### Segment lifecycle
`not_started → detected_in_progress → completed_ai | completed_manual |
marked_not_applicable | rejected_low_confidence`, with `missed` assigned at
finalization for anything still `not_started` that was marked required by the playbook.

---

## 6. Database Schema Outline

Postgres, one schema, org-scoped via `organization_id` FK on every tenant-owned table.

| Entity | Purpose | Key fields | Status |
|---|---|---|---|
| `organizations` | Tenant boundary | id, name, created_at | ⬜ |
| `users` | People who log in | id, org_id, email, name, role | ⬜ |
| `auth_accounts` | OAuth/local credentials per user | id, user_id, provider, provider_account_id | ⬜ |
| `meetings` | Logical meeting (could be recurring series) | id, org_id, title, platform, meeting_url, playbook_id, hubspot_deal_id?, created_by | ⬜ |
| `meeting_sessions` | One instance/occurrence of a meeting being captured | id, meeting_id, status (lifecycle §5), started_at, ended_at | ⬜ (today's `meetings` table is really this, flattened) |
| `capture_sessions` | Provider-agnostic capture attempt (supports retry/rejoin) | id, meeting_session_id, provider (`recall`\|`local_desktop`), provider_session_ref, status | ⬜ |
| `recall_bots` | Recall-specific bot record | id, capture_session_id, recall_bot_id, raw_last_payload (jsonb) | ⬜ |
| `participants` | Attendees seen in a session | id, meeting_session_id, name, email?, is_host | ⬜ |
| `transcript_utterances` | Normalized speaker turns | id, meeting_session_id, speaker, text, started_ms, ended_ms, is_final | 🚧 (contract type `Utterance` exists, no table) |
| `transcript_words` | Word-level timing (optional granularity) | id, utterance_id, word, started_ms, ended_ms, confidence | ⬜ |
| `transcript_raw_events` | Raw provider payloads, for debugging/replay | id, capture_session_id, provider, event_type, payload (jsonb), received_at | ⬜ |
| `playbooks` | User-defined checklist templates | id, org_id, name, is_default | ⬜ |
| `playbook_segments` | Segments belonging to a playbook | id, playbook_id, name, description, is_required, order | ⬜ |
| `segment_detection_rules` | Deterministic rule config per segment (keywords/regex) | id, playbook_segment_id, rule_type, rule_config (jsonb) | ⬜ |
| `meeting_segment_states` | Live/final status of a segment for a given session | id, meeting_session_id, playbook_segment_id, status (lifecycle §5), confidence, detected_at, speaker | ⬜ |
| `segment_evidence` | Transcript snippets backing a detection | id, meeting_segment_state_id, utterance_id, snippet, reason_text | ⬜ |
| `manual_overrides` | Human corrections to AI segment calls | id, meeting_segment_state_id, user_id, previous_status, new_status, note | ⬜ |
| `meeting_summaries` | LLM-generated summary/action items | id, meeting_session_id, summary_text, action_items (jsonb) | ⬜ |
| `meeting_analysis` | Final rollup used for sync | id, meeting_session_id, score, required_segments_completed, missing_segments (jsonb), pilot_pitched, pricing_discussed, next_step_confirmed | ⬜ |
| `airtable_sync_jobs` | Sync attempt log | id, meeting_session_id, status, attempt_count, last_error, airtable_record_id | ⬜ |
| `hubspot_sync_jobs` | Sync attempt log | id, meeting_session_id, status, attempt_count, last_error, hubspot_object_type, hubspot_object_id | ⬜ |
| `external_crm_mappings` | Cached deal/contact/company resolution | id, meeting_id, hubspot_deal_id?, hubspot_contact_id?, hubspot_company_id?, matched_via | ⬜ |
| `webhook_events` | Inbound webhook audit trail (all providers) | id, provider, event_type, signature_valid, payload (jsonb), processed_at | ⬜ |
| `audit_logs` | Who did what, when | id, org_id, actor_user_id, action, target_type, target_id, metadata (jsonb) | ⬜ |

Today's schema is just `meetings` (flattened `meeting` + `meeting_session` + a couple of
`capture_session`/`recall_bots` fields bolted on). Migrating to the table above should
happen **before** webhook ingestion work (§4 step 3) starts, since normalizing raw events
into `transcript_utterances` needs the real tables to exist.

---

## 7. API Route Design

```
# Auth
POST   /auth/google/callback
POST   /auth/login                       (email/password fallback)

# Orgs / users
GET    /orgs/:orgId
GET    /orgs/:orgId/users

# Playbooks
GET    /playbooks
POST   /playbooks
GET    /playbooks/:id
PATCH  /playbooks/:id
POST   /playbooks/:id/segments
PATCH  /playbooks/:id/segments/:segmentId
DELETE /playbooks/:id/segments/:segmentId

# Sessions (renamed from today's /meetings)
POST   /sessions                         create session, dispatch CaptureProvider
GET    /sessions
GET    /sessions/:id
GET    /sessions/:id/transcript
GET    /sessions/:id/segments
POST   /sessions/:id/segments/:segmentId/override   (manual override)
GET    /sessions/:id/summary

# Provider webhooks — verify signature, enqueue, ack fast
POST   /webhooks/recall

# Sync retry (admin/debug)
POST   /sessions/:id/sync/airtable/retry
POST   /sessions/:id/sync/hubspot/retry

# Realtime
WS     /ws/sessions/:id                  extension + dashboard subscribe here

# Health
GET    /healthz
```

Today's `/meetings` CRUD maps roughly onto `/sessions` but without org scoping, playbooks,
transcript, or segment endpoints — those are net-new.

---

## 8. Queue / Job Design (BullMQ + Redis)

| Queue | Producer | Consumer | Retry policy | Idempotency key |
|---|---|---|---|---|
| `recall-webhook-ingest` | Webhook controller | Ingestion worker | 5 attempts, exponential backoff | Recall event id |
| `transcript-processing` | Ingestion worker | Transcript worker | 5 attempts | (session_id, utterance seq) |
| `segment-detection` | Transcript worker | Segment worker | 3 attempts, short backoff (near-realtime) | (session_id, segment_id, window hash) |
| `meeting-finalization` | Session status transition (`meeting_ended`) | Finalization worker | 5 attempts | session_id |
| `airtable-sync` | Finalization worker / manual retry | Airtable sync worker | 5 attempts, backoff to hours | session_id (upsert, not insert) |
| `hubspot-sync` | Airtable sync success / manual retry | HubSpot sync worker | 5 attempts, backoff to hours | session_id (upsert by matched object id) |

All webhook handlers: verify → ack 2xx → enqueue. No synchronous processing in the request
path, ever. Every queue writes a row to `webhook_events` or the relevant `*_sync_jobs`
table on every attempt (success or failure) so retries are auditable.

---

## 9. Chrome Extension Architecture

- **Manifest V3.**
- **Content script** injected on `meet.google.com/*`, renders a movable/collapsible widget
  into a shadow DOM root (isolates styling from the host page). Widget shows: active
  playbook name, per-segment tick state, confidence indicator, bot/transcription connection
  status, a manual override control per segment, and a free-text notes box.
- **Background service worker** owns the auth token (from the popup login), maps the active
  tab → `meeting_session_id` (resolved via `GET /sessions?meetingUrl=` once a session
  exists for that tab's Meet URL), and proxies the WebSocket connection so only one socket
  exists per browser even across multiple tabs.
- **Popup** — login (Google OAuth handoff) + shows current session status.
- The extension **never persists transcript text**. It holds only the current playbook +
  segment state in memory (and `chrome.storage.session`, which is cleared on browser close)
  — never `chrome.storage.local`. This satisfies "must not store sensitive transcript data
  permanently" from the vision brief.
- V1 does **not** capture audio from the extension — it is a pure UI overlay driven by
  backend WebSocket pushes. Audio/transcript capture is entirely Recall's job in V1.

---

## 10. AI Segment Detection Design

Hybrid, per playbook segment, run against a rolling transcript window (e.g., last N
minutes or last M utterances — tune during implementation):

1. **Deterministic pass** — cheap keyword/regex rules from `segment_detection_rules` run
   first (e.g., "pricing", "cost", "$" for a Pricing segment). A hit alone does **not**
   complete a segment — it only raises it to `detected_in_progress` and biases the LLM pass.
2. **LLM classifier pass** — the rolling window + segment description is sent to an LLM with
   structured output: `{status, confidence (0-1), evidence_quote, reason}`. Only a
   confidence above a configured threshold (start at 0.75, tune empirically) can move a
   segment to `completed_ai`.
3. **Never tick on one weak phrase** — the classifier is instructed to require the segment's
   *intent* to be substantively covered, not just a keyword mention; the deterministic pass
   is a gate to reduce LLM calls, not a source of truth by itself.
4. **Manual override always wins** — `manual_overrides` records are terminal; the detection
   worker skips segments in `completed_manual`/`marked_not_applicable` states.
5. Every state change persists `segment_evidence` (the exact transcript snippet + reason),
   so the dashboard/extension can always show *why* something ticked.
6. At meeting finalization, any required segment still `not_started` becomes `missed` — this
   is what feeds `meeting_analysis.missing_segments`.

---

## 11. Airtable Schema (internal ops mirror)

| Table | Purpose | Key fields |
|---|---|---|
| `Meetings` | Mirror of finalized `meeting_analysis` | Meeting Session ID (link back to Postgres), Title, Date, Org, AE, Score, Summary |
| `Segment Completion` | One row per segment per meeting | Meeting link, Segment Name, Status, Confidence, Evidence |
| `Playbooks` (optional) | If ops wants to manage playbooks from Airtable instead of the admin dashboard | Name, Segments (linked/JSON) — **pulled into Postgres**, not read live at request time |
| `Sync Log` | Mirrors `airtable_sync_jobs` for ops visibility | Meeting link, Status, Last Attempt, Error |

Airtable is fed *from* Postgres (source of truth) — the only inbound direction is the
optional playbook pull, and even that gets materialized into Postgres before use, per the
vision brief ("Postgres should remain source of truth").

---

## 12. HubSpot Field / Object Mapping

- **Matching order:** (a) `external_crm_mappings.hubspot_deal_id` if already known → (b)
  meeting metadata (e.g., calendar invite deal association, once V2 calendar integration
  exists) → (c) participant email domain → company → (d) contact email exact match.
- **Objects touched:** Deal (primary), Contact, Company — whichever resolves first; a
  Note/Engagement is attached to all resolved objects.
- **Custom properties written** (create if missing on first sync):
  - `first_meeting_completed` (bool)
  - `first_meeting_score` (number)
  - `required_segments_completed` (number)
  - `missing_segments` (multi-line text / list)
  - `pilot_pitched` (bool)
  - `pricing_discussed` (bool)
  - `next_step_confirmed` (bool)
  - `ai_meeting_summary` (long text)
- **Idempotency:** upsert keyed by `external_crm_mappings` + `hubspot_sync_jobs`; re-running
  a sync for the same session updates the same note/properties rather than duplicating.

---

## 13. Security Model

- **Webhook verification:** every inbound Recall webhook is checked against
  `RECALL_WEBHOOK_SECRET` before anything is enqueued; unverified requests are rejected
  with 401 and logged to `webhook_events` with `signature_valid=false` (for debugging
  attempted spoofing, not processed).
- **Secrets:** `.env` per app locally (never committed — already enforced by
  `.gitignore`); a real secret manager (Render/Railway secrets, or Vault later) in
  deployed environments.
- **AuthN/Z:** session-based or JWT for dashboard/extension users; every tenant-scoped
  table carries `organization_id` and every query is scoped to the caller's org —
  no cross-org data access, enforced at the service layer (not just the DB).
- **Extension data handling:** no permanent transcript storage on-device (see §9).
- **Rate limiting:** the public webhook endpoint gets a rate limit + payload size cap to
  bound abuse, independent of signature verification.
- **Least privilege:** Airtable/HubSpot API keys scoped to only the objects/tables they
  need; Recall API key scoped per environment (dev/staging/prod use different bots/keys).
- **Audit trail:** `audit_logs` for admin actions (playbook edits, manual overrides, sync
  retries) — who did what, when.
- **Encryption:** TLS everywhere in transit; S3 objects (raw exports/debug payloads)
  server-side encrypted; Postgres encryption at rest via the managed provider.

---

## 14. Local Development Setup

- Postgres: a Supabase project, shared across local/staging/prod — no local install. Get
  the pooled (`DATABASE_URL`) and direct (`DIRECT_URL`) connection strings from
  **Project → Connect → ORMs → Prisma** in the Supabase dashboard.
- `docker-compose.yml` at repo root (not yet added): Redis only, once M4 needs it.
- `pnpm install && pnpm build && pnpm dev` — unchanged from today.
- Each app keeps its own `.env` (from `.env.example`), never committed.
- `pnpm recall:spike` — must be run once per environment change to confirm the real Recall
  contract before trusting `packages/recall`.
- Extension: `pnpm --filter extension dev` builds an unpacked extension you load via
  `chrome://extensions` → "Load unpacked".

---

## 15. Deployment Plan

- **Environments:** local → staging → production, each with its own Postgres, Redis,
  Recall API key, and Airtable/HubSpot credentials (HubSpot sandbox for staging).
- **Hosting:** `apps/api` + `apps/worker` as two services on Render/Railway (same image,
  different start command); `apps/web` as a Next.js service or Vercel; managed Postgres +
  Redis add-ons.
- **Extension:** built artifact uploaded to Chrome Web Store, unlisted/private distribution
  initially (internal tool), promoted to public listing later if needed.
- **Infra as code:** `infra/` folder holds Render/Railway service definitions (or Terraform
  if we outgrow the managed-PaaS model) — not built yet, currently everything is run
  locally only.
- **Migrations:** `prisma migrate deploy` runs as a release step before the new API version
  goes live.

---

## 16. Git Branching Strategy

Trunk-based, short-lived feature branches:

- `main` — always production-ready.
- `develop` — optional, only introduce if release cadence needs a staging integration
  branch; skip for now given team size.
- `feature/<area>-<short-description>`
- `fix/<area>-<short-description>`
- `chore/<area>-<short-description>`
- `docs/<area>-<short-description>`
- `release/vX.Y.Z`
- `hotfix/<short-description>`

**Correction needed now:** both existing commits (`58db0ce`, `3dff5f9`) went straight to
`main`. Starting immediately, all new work should branch — suggested first branches, in
build order:

1. `docs/v1-architecture` — this document + the rest of §19's doc suite
2. `feature/db-schema` — full data model migration (§6)
3. `feature/recall-provider` — run the real spike, fix `packages/recall` against confirmed contract
4. `feature/realtime-ingestion` — webhook receiver + BullMQ + transcript worker + WS gateway
5. `feature/segment-engine` — rules + LLM hybrid detector
6. `feature/extension-widget` — new `apps/extension`
7. `feature/admin-playbooks` — dashboard CRUD for playbooks/segments
8. `feature/airtable-sync`
9. `feature/hubspot-sync`

## 17. Commit Strategy

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`).
Every PR description must include: what changed, why, how to test, screenshots/video for
UI changes, migration notes if the schema changed, new env vars, and rollback notes. No PR
template exists yet — add `.github/PULL_REQUEST_TEMPLATE.md` as part of
`docs/v1-architecture`.

---

## 18. Build Roadmap with Milestones

| Milestone | Scope | Status |
|---|---|---|
| M0 — Repo bootstrap | Monorepo, apps skeletons, health check | ✅ Done |
| M1 — Basic persistence | Manual meeting URL → Postgres row → best-effort Recall bot → library UI | ✅ Done (this is as far as we've gotten) |
| M2 — Recall contract verified | Run `pnpm recall:spike` for real, fix `packages/recall` against confirmed behavior | ✅ Done 2026-07-03 — see findings below |
| M3 — Full data model | Migrate to the schema in §6 (orgs, users, playbooks, segments, sync jobs, etc.) | ⬜ Not started |
| M4 — Realtime ingestion | Webhook receiver w/ signature verification, Redis+BullMQ, transcript worker, WS gateway | ⬜ Not started |
| M5 — Segment detection | Hybrid rule+LLM engine, evidence + confidence, manual override | ⬜ Not started |
| M6 — Chrome extension | `apps/extension`, widget, popup, background worker | ⬜ Not started |
| M7 — Admin dashboard | Playbook CRUD, meeting/transcript/segment review UI | ⬜ Not started |
| M8 — Airtable sync | Idempotent sync job + retry UI | ⬜ Not started |
| M9 — HubSpot sync | Matching + property writeback, mock mode fallback | ⬜ Not started |
| M10 — V1 complete | End-to-end: paste URL → bot → live segments in extension → Airtable → HubSpot | ⬜ Not started |

We are past M2, at the start of M3.

### M2 findings (verified 2026-07-03 against a real bot + live Google Meet call)

- **Base URL, auth header, region list — all confirmed correct** as originally coded:
  `https://{region}.recall.ai/api/v1`, `Authorization: Token <key>`, regions are
  `us-west-2` / `us-east-1` / `eu-central-1` / `ap-northeast-1` (fully separate
  deployments, separate keys). This account's key works against `us-west-2`.
- **Bug found and fixed:** the transcript provider key was wrong —
  `recording_config.transcript.provider.meeting_captions` doesn't exist; the correct
  key is `recallai_streaming` (Recall's built-in provider, no third-party transcription
  API key needed for V0). Fixed in `packages/recall`.
- **Real bot status codes observed, in order:** `joining_call` → `in_waiting_room` →
  `in_call_not_recording` → `in_call_recording` → `call_ended` (with
  `sub_code: "timeout_exceeded_everyone_left"` when the last participant leaves) →
  `recording_done` → `done`. The spike script's terminal-state check
  (`["done", "fatal", "call_ended"]`) is correct as originally written.
- **Transcript retrieval (post-call):** `GET /bot/{id}/` returns
  `recordings[0].media_shortcuts.transcript.data.download_url` once
  `media_shortcuts.transcript.status.code === "done"` — a presigned S3 URL, no auth
  header needed, that returns the full transcript as one JSON array with one entry per
  **participant** (not per utterance): `{ participant: { id, name, is_host, ... },
  words: [{ text, start_timestamp: { relative, absolute }, end_timestamp: {...} }] }`.
  This is the shape for the async/full-transcript download — the real-time
  `transcript.data` webhook (still unexercised — needs a public URL, see M4) delivers
  smaller incremental chunks and was NOT validated by this spike.
- **Webhook signature verification confirmed** (docs, not yet live-tested — no
  receiver exists): headers `Webhook-Id` / `Webhook-Timestamp` / `Webhook-Signature`,
  HMAC-SHA256 over `{id}.{timestamp}.{payload}`, key = base64 portion of a
  `whsec_<base64>` secret, signature header may carry multiple space-separated
  `v1,<sig>` values during rotation. Implemented as
  `verifyRecallWebhookSignature()` in `packages/recall`, ready for M4 to wire up —
  not yet used anywhere.
- **Legacy endpoint trap:** `GET /bot/{id}/transcript/` (singular, no `/v1.10/`) is
  deprecated and returns a string array telling you to use the retrieve-bot flow
  above instead — don't use it.
- **Minor shape note:** the bot object echoes `meeting_url` back as an object
  (`{ meeting_id, platform }`), not the string we sent — irrelevant today since
  `RecallBot` is a catch-all type, but worth remembering if we ever parse this field.

---

## 19. Risks & Tradeoffs

- **Recall.ai contract drift risk (highest priority):** `packages/recall` is built entirely
  from doc-pattern guesses (`VERIFY` comments throughout). Nothing downstream (webhooks,
  transcript normalization) should be built on top of it until the spike confirms real
  behavior — building M3/M4 before M2 risks a rewrite.
- **LLM segment detection cost & accuracy:** false positives erode trust in the widget,
  false negatives make it useless. Needs a confidence threshold tuned empirically, plus a
  cheap deterministic pre-filter (§9) to avoid calling an LLM on every transcript window.
- **Webhook security:** an unverified or replayable webhook could inject fake transcript
  data or trigger fake syncs — signature verification is non-negotiable before any webhook
  handler does real work.
- **`CaptureProvider` abstraction — premature generalization risk:** only one implementation
  (`RecallBotProvider`) exists for years potentially. Keep the interface minimal
  (`createSession/startRecording/stopRecording/getStatus/handleProviderWebhook`) and resist
  adding speculative methods until `LocalDesktopCaptureProvider` actually needs them (V4).
- **Chrome Web Store review risk:** MV3 extensions requesting broad host permissions
  (`meet.google.com`) and background auth can trigger manual review delays — start the
  listing/review process early once the extension has a working V1, don't leave it to the
  end.
- **Cost of running bots per meeting:** Recall.ai bills per bot-minute — worth tracking
  usage from day one so V1 pilot usage doesn't produce a surprise bill.
- **Data privacy/compliance:** transcripts are sensitive (deal-stage sales conversations).
  Retention policy for `transcript_raw_events` and S3 exports needs to be decided before
  any customer-facing usage, not after.
- **Monorepo scope creep:** adding `packages/hubspot`, `packages/airtable`, `packages/ai`,
  `apps/extension` all at once would be a lot of surface area with no working segment
  engine yet — sequence per §18, don't parallelize prematurely.

---

## 20. Exact Next Steps (once this document is approved)

In order — each should be its own branch/PR per §16:

1. `docs/v1-architecture` — commit this file + stub out
   `docs/architecture/event-flow.md`, `data-model.md`, `extension.md`, `recall-ai.md`,
   `airtable-hubspot-sync.md`, `docs/runbooks/webhook-debugging.md`,
   `docs/runbooks/failed-sync-retry.md` (can start as skeletons, filled in as each
   milestone lands). Add `.github/PULL_REQUEST_TEMPLATE.md`.
2. Add `docker-compose.yml` (Postgres + Redis) and migrate local dev off the bare Homebrew
   Postgres install.
3. **Run the real Recall spike** (`pnpm recall:spike` with a real API key against a live
   Meet call) and correct every `VERIFY` assumption in `packages/recall` against actual
   observed behavior — this gates everything else.
4. Widen `packages/contracts` and the Prisma schema to the full data model in §6
   (`feature/db-schema`), including the widened meeting lifecycle from §5.
5. Build the Recall webhook receiver with signature verification + BullMQ enqueue
   (`feature/realtime-ingestion`), plus the transcript processing worker and WebSocket
   gateway.
6. Build the segment detection worker (`feature/segment-engine`).
7. Scaffold `apps/extension` (`feature/extension-widget`).
8. Build playbook CRUD + admin dashboard surfaces (`feature/admin-playbooks`).
9. Build Airtable sync (`feature/airtable-sync`), then HubSpot sync
   (`feature/hubspot-sync`, mock mode if credentials aren't ready yet).
10. Only after all of the above: revisit auth/orgs hardening, tests, and CI as a dedicated
    pass — don't block early milestones on this, but don't ship V1 to real users without it.

Nothing in apps/api, apps/web, or packages/db should change again until step 3 (the Recall
spike) has actually run — that's the one dependency everything else in V1 sits on top of.
