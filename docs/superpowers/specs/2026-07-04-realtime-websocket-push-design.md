# M4 (partial): Real-Time WebSocket Push — Design Spec

**Status:** Approved in conversation 2026-07-04; written up here for the record before
implementation.

## Goal

Replace the meeting detail page's 2-second HTTP polling with instant push: the moment a
meeting's status changes or its transcript is written, the browser finds out immediately
instead of waiting up to 2 seconds. This is a **delivery-mechanism** improvement, not a
data-correctness one — it does not change what data exists or when the transcript is
actually generated (that's governed by Recall's `prioritize_accuracy` mode and the
async-backfill fix from earlier tonight; see `Orchestration.md` §1, finding #11).

**Explicitly out of scope for this pass:** Redis, BullMQ, a transcript-processing worker
process. The original M4 milestone description bundles these in, but at current traffic
(~10 meetings total) they add real infrastructure cost (a new Railway service, queue
setup, retry/idempotency plumbing) for a benefit (durability under backpressure) this
project doesn't need yet. This is a deliberate scope reduction, revisit when real load
justifies it.

## Architecture

A new Nest WebSocket gateway (`MeetingsGateway`) runs alongside the existing REST API in
`apps/api`, using Socket.IO. Rooms are keyed by **`meetingId`** (not `meetingSessionId`):
V1 only ever has one session per meeting, and keying by `meetingId` lets the browser join
a room the instant it loads `/meetings/[id]` with zero extra lookups; the server can
broadcast using `session.meetingId`, which every webhook handler already has in hand.

The existing webhook handling code (`webhooks.service.ts`) keeps doing exactly what it
does today — write to Postgres — and additionally emits over the socket right after each
write. No queue, no new infrastructure, no rewrite of the write path.

## Backend

### New file: `apps/api/src/realtime/meetings.gateway.ts`

```ts
import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody, ConnectedSocket } from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import type { MeetingStatus, Utterance } from "@notetaker/contracts";

@WebSocketGateway({ cors: { origin: true } })
export class MeetingsGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage("join")
  onJoin(@MessageBody() meetingId: string, @ConnectedSocket() client: Socket) {
    client.join(meetingId);
  }

  emitStatus(meetingId: string, status: MeetingStatus) {
    this.server.to(meetingId).emit("status", { status });
  }

  /** One new utterance arrived live (rare in practice — see Orchestration.md finding #11 —
      but the code path still exists for the cases where transcript.data does fire). */
  emitTranscriptAppend(meetingId: string, utterance: Utterance) {
    this.server.to(meetingId).emit("transcript-append", utterance);
  }

  /** The full transcript was (re)written — the async-backfill case. Clients must treat
      this as authoritative and replace their whole utterance list, not merge it. */
  emitTranscriptReplace(meetingId: string, utterances: Utterance[]) {
    this.server.to(meetingId).emit("transcript-replace", utterances);
  }
}
```

### `apps/api/src/realtime/realtime.module.ts` (new)

```ts
import { Module } from "@nestjs/common";
import { MeetingsGateway } from "./meetings.gateway";

@Module({
  providers: [MeetingsGateway],
  exports: [MeetingsGateway],
})
export class RealtimeModule {}
```

Imported by `AppModule` and by `WebhooksModule` (so `WebhooksService` can inject
`MeetingsGateway`).

### `apps/api/src/main.ts` — one addition

Fastify requires explicitly registering the Socket.IO adapter (not auto-detected the way
it is on Express):

```ts
import { IoAdapter } from "@nestjs/platform-socket.io";
// after NestFactory.create(...):
app.useWebSocketAdapter(new IoAdapter(app));
```

New dependencies on `apps/api`: `@nestjs/websockets`, `@nestjs/platform-socket.io`,
`socket.io`.

### `apps/api/src/webhooks/webhooks.service.ts` — wiring

`WebhooksService` gets `MeetingsGateway` injected via constructor. Three emit points,
each right after the existing DB write it corresponds to:

1. **`handleTranscriptData`** (the rare live-arrival case) — after
   `transcriptUtterance.create(...)` succeeds, call
   `this.gateway.emitTranscriptAppend(session.meetingId, toUtterance(created))`. After the
   status update to `"transcribing"`, call
   `this.gateway.emitStatus(session.meetingId, "transcribing")`.
2. **`handleBotStatus`** — after `meetingSession.update(...)` succeeds, call
   `this.gateway.emitStatus(session.meetingId, nextStatus)`.
3. **`backfillFinalTranscript`** — after the `$transaction` that deletes and recreates all
   utterances, fetch the newly-created rows and call
   `this.gateway.emitTranscriptReplace(meetingId, utterances.map(toUtterance))`. This
   method needs `meetingId` threaded in from its caller (`handleBotStatus` already has
   `session.meetingId` in scope).

`toUtterance` is already exported from `@notetaker/db` and used by the REST endpoint —
reusing it here means the socket payload and the HTTP payload are always identical shape.

## Frontend

### New dependency: `socket.io-client` on `apps/web`

### `apps/web/src/app/meetings/[id]/page.tsx` changes

- Keep the existing initial HTTP fetch on mount exactly as today (covers first paint and
  anything that happened before the socket connects).
- If the fetched status is already terminal (`completed`/`failed`), don't open a socket at
  all — nothing more will ever happen.
- Otherwise, open a socket to `API_BASE_URL`, emit `join` with `params.id`, and listen for:
  - `status` → `setMeeting((m) => m ? { ...m, status: payload.status } : m)`
  - `transcript-append` → `setUtterances((u) => [...u, payload])`
  - `transcript-replace` → `setUtterances(payload)` (full replace, not merge)
- **Fallback behavior (already decided), exact state machine:** Socket.IO auto-reconnects
  by default (no config needed for that part). Additionally:
  - On the socket's `disconnect` event, start a 5-second `setTimeout`. If the socket's
    `connect` event fires before that timer elapses, clear the timer — no fallback needed,
    it was a brief blip.
  - If the timer elapses without reconnecting, start the existing polling loop (same
    `poll()` function and 2-second interval already in the file).
  - On the socket's `connect` event (including a reconnect after fallback polling had
    already started), stop the polling loop (`clearTimeout` on its timer) — the socket is
    the source of truth again.
  - This means the polling code doesn't get deleted — it becomes the fallback path,
    started/stopped by socket connection state, not the always-on primary path.
- Keep the polling loop's existing error-retry behavior (fixed earlier tonight) as-is —
  it's now the fallback path's own resilience, not the primary path's.

### Scope

Real-time push applies to the **meeting detail page only**. The meeting library (list)
page is unchanged — still loads once per page load, no live updates. (Already decided —
smaller surface area for this first real-time slice.)

## Error handling / edge cases

- **Multiple browser tabs on the same meeting:** both join the same Socket.IO room by
  `meetingId`, both receive every emit. No special handling needed — Socket.IO rooms
  already broadcast to every connected member.
- **Socket connects after an event already fired:** the initial HTTP fetch on mount
  already covers "catch up to current state" — the socket only needs to carry *future*
  events from the moment it joins, not backfill missed ones itself.
- **Gateway emit called with no listeners in that room:** a no-op (Socket.IO rooms with no
  members simply don't error) — safe if, e.g., the backfill fires after the user has
  already navigated away.

## Testing

No test framework exists in this project (documented, known gap, not something this
change should block on — matches how the entire project has been verified so far). The
existing verification pattern applies: `pnpm typecheck` across the monorepo, then a real
live Google Meet smoke test — this time specifically confirming (a) status updates appear
in the browser within roughly a second of the webhook arriving (not up to 2s later), (b)
killing/restarting the `api` service mid-call causes the page to fall back to polling and
then recover once the socket reconnects, (c) the final transcript backfill triggers a
`transcript-replace` that actually updates the page without a manual refresh.
