import { Injectable, Logger } from "@nestjs/common";
import { loadEnv } from "@notetaker/config";
import type { MeetingStatus } from "@notetaker/contracts";
import { getPrisma, Prisma } from "@notetaker/db";
import { RecallClient } from "@notetaker/recall";

interface RecallWord {
  text: string;
  start_timestamp?: { relative: number } | null;
  end_timestamp?: { relative: number } | null;
}

interface RecallTranscriptDataEvent {
  event: "transcript.data";
  data: {
    bot: { id: string };
    data: {
      words: RecallWord[];
      participant: { id: number; name: string | null };
    };
  };
}

interface RecallBotStatusEvent {
  event: string;
  data: {
    bot: { id: string };
    data: { code: string; sub_code: string | null };
  };
}

/** Workspace-level bot status events → our meeting lifecycle. Anything not listed is ignored. */
const STATUS_EVENT_MAP: Record<string, MeetingStatus> = {
  "bot.joining_call": "bot_joining",
  "bot.in_waiting_room": "bot_joining",
  "bot.in_call_not_recording": "bot_joined",
  "bot.in_call_recording": "recording",
  "bot.call_ended": "meeting_ended",
  // "processing" here means Recall's OWN pipeline (recording -> transcript) is
  // finishing — distinct from "processing_final_analysis" (our future LLM summary step,
  // set nowhere yet). See the MeetingStatus enum in @notetaker/contracts for the full note.
  "bot.recording_done": "processing",
  "bot.done": "completed",
  "bot.fatal": "failed",
};

/**
 * Lifecycle order (§5 of Orchestration.md). A status update is only applied when it
 * moves forward in this sequence — never backward, and never sideways. This replaces a
 * flat "terminal status" set, which incorrectly blocked legitimate forward progress: e.g.
 * `meeting_ended` used to be treated as terminal, but `recording_done`/`done` webhooks
 * (which want to advance to `processing`/`completed`) arrive strictly *after*
 * `call_ended` (which sets `meeting_ended`) — so every meeting that finished normally got
 * silently stuck at `meeting_ended` forever.
 */
const STATUS_ORDER: MeetingStatus[] = [
  "created",
  "scheduled",
  "bot_joining",
  "bot_joined",
  "recording",
  "transcribing",
  "meeting_ended",
  "processing",
  "processing_final_analysis",
  "synced_to_hubspot",
  "completed",
];

/** `failed` can be reached from anywhere and, once set, is never overwritten by a late/stray event. */
function isForwardTransition(from: MeetingStatus, to: MeetingStatus): boolean {
  if (to === "failed") return true;
  if (from === "failed") return false;
  return STATUS_ORDER.indexOf(to) > STATUS_ORDER.indexOf(from);
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly prisma = getPrisma();

  private recallClient(): RecallClient | undefined {
    const env = loadEnv();
    if (!env.RECALL_API_KEY) return undefined;
    return new RecallClient({ apiKey: env.RECALL_API_KEY, region: env.RECALL_REGION });
  }

  async handleRecallEvent(payload: unknown, webhookId: string): Promise<void> {
    if (isTranscriptDataEvent(payload)) return this.handleTranscriptData(payload, webhookId);
    if (isBotStatusEvent(payload)) return this.handleBotStatus(payload);
    this.logger.warn(`Ignoring unrecognized Recall event: ${JSON.stringify(payload).slice(0, 200)}`);
  }

  private async findSessionByBotId(botId: string) {
    const recallBot = await this.prisma.recallBot.findUnique({
      where: { recallBotId: botId },
      include: { captureSession: { include: { meetingSession: true } } },
    });
    return recallBot?.captureSession.meetingSession;
  }

  private async handleTranscriptData(payload: RecallTranscriptDataEvent, webhookId: string): Promise<void> {
    const { bot, data } = payload.data;
    const session = await this.findSessionByBotId(bot.id);
    if (!session) {
      this.logger.warn(`No meeting session found for Recall bot ${bot.id}`);
      return;
    }
    if (data.words.length === 0) return;

    const text = data.words.map((w) => w.text).join(" ");
    const startedMs = toMs(data.words[0].start_timestamp);
    const endedMs = toMs(data.words[data.words.length - 1].end_timestamp);
    const speaker = data.participant.name ?? `Participant ${data.participant.id}`;

    try {
      await this.prisma.transcriptUtterance.create({
        data: {
          meetingSessionId: session.id,
          speaker,
          text,
          startedMs,
          endedMs,
          isFinal: true,
          recallWebhookId: webhookId,
        },
      });
    } catch (err) {
      // Recall uses at-least-once delivery — a redelivered webhook (e.g. after a slow
      // ACK) reuses the same Webhook-Id. The unique constraint on recallWebhookId turns
      // that into a no-op instead of a duplicate transcript row.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        this.logger.warn(`Ignoring duplicate transcript.data webhook ${webhookId} (already processed)`);
        return;
      }
      throw err;
    }

    if (isForwardTransition(session.status as MeetingStatus, "transcribing")) {
      await this.prisma.meetingSession.update({ where: { id: session.id }, data: { status: "transcribing" } });
    }
  }

  private async handleBotStatus(payload: RecallBotStatusEvent): Promise<void> {
    const nextStatus = STATUS_EVENT_MAP[payload.event];
    if (!nextStatus) return;

    const session = await this.findSessionByBotId(payload.data.bot.id);
    if (!session) {
      this.logger.warn(`No meeting session found for Recall bot ${payload.data.bot.id}`);
      return;
    }
    if (!isForwardTransition(session.status as MeetingStatus, nextStatus)) return;

    await this.prisma.meetingSession.update({
      where: { id: session.id },
      data: {
        status: nextStatus,
        endedAt: nextStatus === "meeting_ended" ? new Date() : undefined,
      },
    });

    if (nextStatus === "completed") {
      // Best-effort — the bot-status transition above is the important part of this
      // webhook and must not fail because of a transcript-fetch problem. Runs at most
      // once per session: isForwardTransition already guarantees "completed" is only
      // reached once, so this can't double-fetch on a redelivered bot.done event.
      await this.backfillFinalTranscript(session.id, payload.data.bot.id).catch((err) => {
        this.logger.error(`Failed to backfill final transcript for bot ${payload.data.bot.id}: ${String(err)}`);
      });
    }
  }

  /**
   * `recallai_streaming` in `prioritize_accuracy` mode uses async, non-real-time models —
   * the live `transcript.data` webhook can arrive very late or not at all (see
   * docs/runbooks/webhook-debugging.md). Once the bot is fully done, fetch Recall's
   * complete async transcript directly instead of relying on it ever having streamed
   * live. Replaces (not appends to) any utterances already in place, since the async
   * transcript is the authoritative, complete version regardless of what partial live
   * data may have already arrived.
   */
  private async backfillFinalTranscript(sessionId: string, botId: string): Promise<void> {
    const recall = this.recallClient();
    if (!recall) return;

    const utterances = await recall.getFinalTranscript(botId);
    if (!utterances || utterances.length === 0) return;

    await this.prisma.$transaction([
      this.prisma.transcriptUtterance.deleteMany({ where: { meetingSessionId: sessionId } }),
      this.prisma.transcriptUtterance.createMany({
        data: utterances.map((u) => ({
          meetingSessionId: sessionId,
          speaker: u.speaker,
          text: u.text,
          startedMs: u.startedMs,
          endedMs: u.endedMs,
          isFinal: true,
        })),
      }),
    ]);
    this.logger.log(`Backfilled ${utterances.length} utterance(s) for session ${sessionId} from Recall's async transcript`);
  }
}

function toMs(ts?: { relative: number } | null): number | null {
  return ts ? Math.round(ts.relative * 1000) : null;
}

function isTranscriptDataEvent(payload: unknown): payload is RecallTranscriptDataEvent {
  const p = payload as RecallTranscriptDataEvent | undefined;
  return p?.event === "transcript.data" && typeof p.data?.bot?.id === "string" && Array.isArray(p.data?.data?.words);
}

function isBotStatusEvent(payload: unknown): payload is RecallBotStatusEvent {
  const p = payload as RecallBotStatusEvent | undefined;
  return (
    typeof p?.event === "string" &&
    p.event.startsWith("bot.") &&
    typeof p.data?.bot?.id === "string" &&
    typeof p.data?.data?.code === "string"
  );
}
