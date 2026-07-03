import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { loadEnv } from "@notetaker/config";
import type { CreateMeetingRequest, MeetingSummary, Utterance } from "@notetaker/contracts";
import { getPrisma, toMeetingSummary, toUtterance } from "@notetaker/db";
import { RecallApiError, RecallBotProvider, RecallClient, type CaptureProvider } from "@notetaker/recall";

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);
  private readonly prisma = getPrisma();

  // Only one CaptureProvider exists today (Recall). This is the one seam that would need
  // to change to support a second provider (e.g. a future local/desktop capture) — see
  // @notetaker/recall's CaptureProvider interface for why it's kept deliberately minimal.
  private captureProvider(): CaptureProvider | undefined {
    const env = loadEnv();
    if (!env.RECALL_API_KEY) return undefined;
    if (!env.RECALL_WEBHOOK_SECRET) {
      // Starting a real bot here would be worse than not starting one at all: every
      // webhook it sends back gets rejected 401 by the receiver (RECALL_WEBHOOK_SECRET
      // unset), so the meeting would silently strand at "bot_joining" forever with no
      // error surfaced anywhere. Fail into dev mode instead, loudly, so this is caught
      // at config time rather than discovered by a stuck meeting.
      this.logger.warn(
        "RECALL_API_KEY is set but RECALL_WEBHOOK_SECRET is not — refusing to start a real bot, " +
          "since every webhook it sends back would be rejected and the meeting would be stuck at " +
          "bot_joining forever. Set RECALL_WEBHOOK_SECRET to enable real bots.",
      );
      return undefined;
    }
    return new RecallBotProvider(new RecallClient({ apiKey: env.RECALL_API_KEY, region: env.RECALL_REGION }));
  }

  async createMeeting(input: CreateMeetingRequest): Promise<MeetingSummary> {
    // Nested create so Meeting + its first MeetingSession commit atomically — a failure
    // between two separate creates used to leave an orphaned Meeting with zero sessions,
    // permanently invisible via the API (listMeetings/getMeeting/getTranscript all key
    // off having at least one session).
    const meeting = await this.prisma.meeting.create({
      data: {
        meetingUrl: input.meetingUrl,
        title: input.title,
        sessions: {
          create: { joinAt: input.joinAt ? new Date(input.joinAt) : undefined },
        },
      },
      include: { sessions: true },
    });
    const session = meeting.sessions[0];

    const provider = this.captureProvider();
    if (!provider) {
      // captureProvider() already logged the specific reason (missing API key vs missing
      // webhook secret) — this just records the outcome for this meeting.
      this.logger.warn(`Created meeting ${meeting.id} without starting a bot (dev mode)`);
      return toMeetingSummary(meeting, session);
    }

    let handle: Awaited<ReturnType<CaptureProvider["createSession"]>> | undefined;
    try {
      const env = loadEnv();
      handle = await provider.createSession({
        meetingUrl: input.meetingUrl,
        joinAt: input.joinAt,
        webhookUrl: `${env.APP_BASE_URL}/webhooks/recall`,
      });
      const recallBotId = handle.providerSessionRef;
      // Single transaction: either all three writes land (capture session, recall bot
      // record, status flip) or none do — no window where a real bot exists with a
      // half-written local record.
      const updatedSession = await this.prisma.$transaction(async (tx) => {
        const captureSession = await tx.captureSession.create({
          data: { meetingSessionId: session.id, provider: "recall", status: "created" },
        });
        await tx.recallBot.create({
          data: { captureSessionId: captureSession.id, recallBotId },
        });
        return tx.meetingSession.update({
          where: { id: session.id },
          data: { status: "bot_joining" },
        });
      });
      return toMeetingSummary(meeting, updatedSession);
    } catch (err) {
      const reason = err instanceof RecallApiError ? err.message : String(err);
      this.logger.error(`Recall bot creation failed for meeting ${meeting.id}: ${reason}`);
      if (handle) {
        // The bot itself was created successfully but its local record failed to
        // commit — without this it would keep running/billing with nothing pointing at
        // it and every webhook for it silently dropped. Best-effort stop it; if this also
        // fails, the session ref is at least in the log for manual cleanup.
        try {
          await provider.stopSession(handle.providerSessionRef);
        } catch (cleanupErr) {
          this.logger.error(
            `Failed to clean up orphaned capture session ${handle.providerSessionRef} for meeting ${meeting.id}: ${String(cleanupErr)}`,
          );
        }
      }
      const failedSession = await this.prisma.meetingSession.update({
        where: { id: session.id },
        data: { status: "failed" },
      });
      return toMeetingSummary(meeting, failedSession);
    }
  }

  async listMeetings(): Promise<MeetingSummary[]> {
    const meetings = await this.prisma.meeting.findMany({
      orderBy: { createdAt: "desc" },
      include: { sessions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return meetings
      .filter((m) => m.sessions.length > 0)
      .map((m) => toMeetingSummary(m, m.sessions[0]));
  }

  async getMeeting(id: string): Promise<MeetingSummary> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id },
      include: { sessions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!meeting || meeting.sessions.length === 0) throw new NotFoundException(`Meeting ${id} not found`);
    return toMeetingSummary(meeting, meeting.sessions[0]);
  }

  async getTranscript(id: string): Promise<Utterance[]> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id },
      include: { sessions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!meeting || meeting.sessions.length === 0) throw new NotFoundException(`Meeting ${id} not found`);
    const rows = await this.prisma.transcriptUtterance.findMany({
      where: { meetingSessionId: meeting.sessions[0].id },
      orderBy: { seq: "asc" },
    });
    return rows.map(toUtterance);
  }
}
