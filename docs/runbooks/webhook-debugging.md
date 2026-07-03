# Webhook Debugging

How to diagnose why a meeting's transcript or status isn't updating, and how to manually
recover a meeting whose bot already finished on Recall's side.

**Historical incident (2026-07-03, resolved):** the hosted app hit exactly the two
failure modes this runbook describes, back to back. First, `RECALL_WEBHOOK_SECRET` was
blank on Railway's `api` service — every bot-status webhook was rejected with 401 (§1
below), fixed by creating a Svix endpoint in Recall's dashboard and setting the generated
secret. Then, once that was fixed, a live test showed status advancing fine but *no
transcript ever appeared* — root cause was `APP_BASE_URL` being unset, defaulting to
`http://localhost:4000` (§2 below), which gets baked into each bot's *per-bot* transcript
webhook URL at creation time — a separate mechanism from the workspace-level status
webhook. Fixed by setting `APP_BASE_URL` to the `api` service's real public URL. Both are
now configured and verified working via a live end-to-end Google Meet call. Keeping this
note here since the exact symptom-to-cause mapping below is what solved it, and the same
two variables are the first thing to check if this ever regresses (e.g., after rotating
secrets or standing up a new environment).

## Symptom: meeting stuck at `bot_joining` forever, no transcript ever appears

This almost always means webhooks from Recall aren't reaching the API, or are being
rejected once they arrive. Diagnose in this order:

### 1. Is the API's webhook endpoint even reachable?

```bash
curl -s -w '\nHTTP %{http_code}\n' -X POST <api-url>/webhooks/recall \
  -H "Content-Type: application/json" -d '{}'
```

- **401 "Webhook receiver is not configured"** → `RECALL_WEBHOOK_SECRET` isn't set on the
  API service. This is the most common cause. Get the real secret from
  `https://{region}.recall.ai/dashboard/webhooks/` and set it, then redeploy.
- **Connection refused / timeout** → the API isn't publicly reachable at all. Check the
  service has a public domain generated (not just an internal `.railway.internal` one).
- **401 "Invalid webhook signature"** → the endpoint is configured but a real request
  failed verification. See §3 below.

### 2. Was the per-bot transcript webhook even configured for this bot?

The transcript webhook is set automatically at bot-creation time, from `APP_BASE_URL`
(see `apps/api/src/meetings/meetings.service.ts`). Check the bot's raw state directly
against Recall — this bypasses our system entirely and tells you what Recall itself
knows:

```bash
curl -s -H "Authorization: Token $RECALL_API_KEY" \
  "https://{region}.recall.ai/api/v1/bot/{recallBotId}/" | python3 -m json.tool
```

Look at `recording_config.realtime_endpoints` in the response — if it's `[]`, the bot was
created without a transcript webhook URL, meaning `APP_BASE_URL` was empty or pointed at
`localhost` when `POST /meetings` ran. Fix `APP_BASE_URL` and create a new meeting (this
can't be fixed retroactively for a bot that's already running).

### 3. Was the workspace-level status webhook configured?

Bot status events (`bot.joining_call`, `bot.in_call_recording`, `bot.done`, etc.) are
**not** part of the per-bot config above — they're a separate, workspace-level setting
in the Recall dashboard (`{region}.recall.ai/dashboard/webhooks/`) that applies to every
bot in the account. If that page has no webhook URL configured, or points at the wrong
URL, status will never advance past whatever the last real event was, even if the
transcript webhook works fine.

## Recovering a finished meeting's transcript manually

If a bot already completed its call (`status_changes` includes `done`) but our database
never got the data — the transcript is safe on Recall's side for 7 days by default (see
Costs in the README) and can be pulled directly:

```bash
# 1. Find the bot's final state and confirm the transcript is ready
curl -s -H "Authorization: Token $RECALL_API_KEY" \
  "https://{region}.recall.ai/api/v1/bot/{recallBotId}/" -o bot_final.json
python3 -c "
import json
d = json.load(open('bot_final.json'))
t = d['recordings'][0]['media_shortcuts']['transcript']
print(t['status']['code'], t['data']['download_url'])
"

# 2. Download the transcript (presigned S3 URL, no auth header needed)
curl -s "<download_url>" -o transcript.json
```

The downloaded JSON is one entry per **participant** (not per utterance — that's the
async/full-transcript shape, different from the smaller live-webhook chunks):

```json
[{
  "participant": { "name": "...", "is_host": true, ... },
  "words": [{ "text": "...", "start_timestamp": { "relative": 1.2 }, "end_timestamp": {...} }]
}]
```

Insert it into `transcript_utterances` via Prisma, grouping words into utterances by
pause gaps (>1.2s between words is a reasonable heuristic — mirrors how live delivery
would have chunked it), then update the meeting's `status` to `completed` and set
`endedAt` from the bot's `call_ended` status-change timestamp. There's no scripted tool
for this yet (it's been done twice by hand so far) — if this keeps happening, it's worth
promoting to a real `pnpm recall:backfill <meetingId>` script.

## Verifying a signature by hand

Useful when you suspect the secret itself is wrong, not just missing. Recall signs
`{webhook-id}.{webhook-timestamp}.{raw-body}` with HMAC-SHA256, keyed by the base64
portion of the `whsec_...` secret:

```js
const crypto = require("node:crypto");
const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
const expected = crypto.createHmac("sha256", key)
  .update(`${id}.${timestamp}.${rawBody}`)
  .digest("base64");
// compare against the "v1,<sig>" entries in the Webhook-Signature header
```

`verifyRecallWebhookSignature()` in `packages/recall/src/index.ts` does exactly this —
if you suspect a bug in verification itself rather than a missing/wrong secret, that's
the function to check first.
