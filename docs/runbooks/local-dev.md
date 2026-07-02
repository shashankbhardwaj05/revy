# Local Development

## Prerequisites

- Node.js ≥ 22 (installed)
- pnpm ≥ 10 (`npm install -g pnpm`)
- Homebrew (for Postgres + Redis from Phase 2: `brew install postgresql@16 redis`)

## Running everything

```bash
pnpm install
pnpm build          # first time, so package dist/ outputs exist
pnpm dev            # api :4000 · web :3000 · worker
```

Verify: `curl http://localhost:4000/healthz` → `{"ok":true,...}` and open http://localhost:3000.

## Environment

Copy `.env.example` → `.env` in each app that needs one (`apps/api`, `apps/worker`).
Never commit `.env` files. Every new env var must be added to the matching
`.env.example` in the same PR.

## Recall spike (Phase 1 checkpoint)

Requires a Recall.ai API key (dashboard → API keys) and a Google Meet call you're in:

```bash
RECALL_API_KEY=xxx MEETING_URL=https://meet.google.com/xxx-xxxx-xxx pnpm recall:spike
```

Expected: bot asks to join your call → admit it → script prints status changes →
when you end the call, the raw payload is saved to `scripts/fixtures/`.

⚠️ First run only: verify the `VERIFY`-marked assumptions in
`packages/recall/src/index.ts` against https://docs.recall.ai.
