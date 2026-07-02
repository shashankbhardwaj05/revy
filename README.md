# AI Notetaker

An AI meeting notetaker. Current scope (V0 "simple transcriber"): paste a Google Meet
link → a Recall.ai bot joins, records, and transcribes → the finished meeting
(recording + transcript + AI summary) lands in the meeting library (and optionally
Google Drive).

Full product architecture (live segment checklist, Chrome extension, Airtable/HubSpot
sync) lives in `docs/architecture/Orchestration.md` — this is the authoritative long-term
plan, including a section ticking off what's actually built vs. still planned. Read it
before making non-trivial changes.

## Structure

- `apps/api` — NestJS (Fastify) backend: HTTP API + Recall webhooks
- `apps/worker` — background job processor (BullMQ)
- `apps/web` — Next.js internal dashboard (paste link, meeting library)
- `packages/contracts` — shared Zod schemas & types (single source of truth)
- `packages/config` — environment loading/validation
- `packages/recall` — typed Recall.ai client + webhook verification
- `scripts/` — dev utilities (Recall spike, transcript simulator)

## Quickstart

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # fill in RECALL_API_KEY
pnpm dev                                  # api :4000, web :3000, worker
```

Postgres is hosted on Supabase (all environments, including local dev); Redis (Phase 3+)
is installed via Homebrew — see `docs/runbooks/local-dev.md`.

## Recall spike

Proves the Recall.ai account works before building on it:

```bash
RECALL_API_KEY=... MEETING_URL=https://meet.google.com/xxx-xxxx-xxx pnpm recall:spike
```
