<p align="center">
  <img src="apps/web/public/logo.png" alt="BEAM" width="360" />
</p>

<h1 align="center">Revy Notetaker</h1>

<p align="center">
  An AI meeting notetaker for <strong>BEAM</strong> (Attentive.ai). Paste a Google Meet
  link — a bot named <strong>Revy Notetaker</strong> joins, records, and live-transcribes
  the call, right in your browser.
</p>

---

## What works today

- Paste a Google Meet link → a real Recall.ai bot joins the call (branded as **Revy
  Notetaker**, BEAM logo as its camera tile).
- The transcript streams into the web app **live**, speaker-attributed, as the meeting
  happens.
- When the meeting ends, the transcript is saved — every past meeting stays in your
  library, accessible any time.

That's it, deliberately — no playbooks, segment detection, Chrome extension, or CRM sync
yet. Those are real, planned, and documented (see below), just not built. What's here is
verified end-to-end against live Google Meet calls, not just typechecked.

## Vision & orchestration

This is being built toward a full meeting-intelligence platform: live segment/checklist
detection against user-defined playbooks, a Chrome extension overlay, and syncing final
meeting analysis to Airtable and then HubSpot. The **complete architecture — stack
decisions, data model, event flow, security model, git strategy, and build roadmap —
lives in [`docs/architecture/Orchestration.md`](docs/architecture/Orchestration.md).**

That document is the single source of truth for where this project is going and is kept
in sync with reality — read its "Current Status" section (§1) for an honest, ticked-off
account of what's built vs. planned, and don't make non-trivial changes without reading
it first.

### Milestones

| # | Milestone | Status |
|---|---|---|
| M0 | Repo bootstrap | ✅ |
| M1 | Basic persistence (paste link → DB row → bot) | ✅ |
| M2 | Recall.ai contract verified against a live call | ✅ |
| — | Live transcript ingestion (webhooks → DB → polling UI) | ✅ |
| — | Hosted on Railway | 🚧 in progress |
| M3 | Full data model (orgs, users, playbooks, segments, sync jobs) | ⬜ |
| M4 | WebSocket gateway + BullMQ (upgrading past polling) | ⬜ |
| M5 | Segment detection engine (hybrid rules + LLM) | ⬜ |
| M6 | Chrome extension | ⬜ |
| M7 | Admin dashboard for playbooks | ⬜ |
| M8 | Airtable sync | ⬜ |
| M9 | HubSpot sync | ⬜ |

Full detail on every row above — including *why* each decision was made — is in
`Orchestration.md`.

## Structure

```
apps/
  api/      — NestJS (Fastify): meetings API + Recall webhook receiver
  web/      — Next.js: paste-link UI, meeting library, live transcript view
  worker/   — background job processor (boots today; BullMQ processors land in M4)
packages/
  contracts/ — shared Zod schemas & types (single source of truth for API shapes)
  config/    — environment loading/validation
  db/        — Prisma schema + client (Postgres, hosted on Supabase)
  recall/    — typed Recall.ai client, webhook signature verification, bot branding asset
docs/
  architecture/Orchestration.md — the plan (read this first)
  runbooks/local-dev.md         — local environment setup
scripts/
  recall-spike.ts — live-call verification tool against the real Recall.ai API
```

## Quickstart

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # fill in Supabase + Recall values
pnpm --filter @notetaker/db migrate:deploy
pnpm dev                                  # api :4000, web :3000, worker
```

Postgres is hosted on Supabase for every environment, including local dev — there is no
local database to install. Get connection strings from your Supabase project's
**Connect → ORMs → Prisma** panel. See
[`docs/runbooks/local-dev.md`](docs/runbooks/local-dev.md) for full setup details.

Then open http://localhost:3000, paste a Google Meet link you're about to join, and admit
the bot when it knocks.

## Recall spike

A standalone tool for verifying the Recall.ai API against a real, live call — useful any
time the contract needs re-checking (region, payload shape, new event types):

```bash
RECALL_API_KEY=... MEETING_URL=https://meet.google.com/xxx-xxxx-xxx pnpm recall:spike
```

It creates a real bot, polls status transitions live, and dumps the full raw payload to
`scripts/fixtures/` once the call ends.

## Deployment

Hosted on **Railway** — two services (`api`, `web`) in one project, both rooted at the
repo root (required for the pnpm workspace to resolve):

| Service | Build | Start |
|---|---|---|
| `api` | `pnpm install && pnpm build` | `pnpm --filter @notetaker/api start` |
| `web` | `pnpm install && pnpm build` | `pnpm --filter @notetaker/web start` |

**`api` env vars:** `RECALL_API_KEY`, `RECALL_REGION`, `RECALL_WEBHOOK_SECRET`,
`DATABASE_URL`, `DIRECT_URL`, `APP_BASE_URL` (set to the `api` service's own public URL —
this is what Recall sends live transcript events to).

**`web` env vars:** `NEXT_PUBLIC_API_URL` (the `api` service's public URL).

One manual step outside the API: configure a workspace webhook in the Recall dashboard
(`{region}.recall.ai/dashboard/webhooks/`) pointing to `<api-url>/webhooks/recall` — this
delivers bot status events (join/leave/done) separately from the per-bot transcript
webhook, which is wired automatically via `APP_BASE_URL`.

## Contributing

Trunk-based development, short-lived feature branches
(`feature/<area>-<description>`, `fix/...`, `docs/...`), Conventional Commits. Full
branching and commit conventions are in `Orchestration.md` §16–17.
