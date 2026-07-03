import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { loadEnv } from "@notetaker/config";
import type { CreateMeetingRequest, MeetingSummary, Utterance } from "@notetaker/contracts";
import { getPrisma, toMeetingSummary, toUtterance } from "@notetaker/db";
import { RecallApiError, RecallClient } from "@notetaker/recall";

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);
  private readonly prisma = getPrisma();

  private recallClient(): RecallClient | undefined {
    const env = loadEnv();
    if (!env.RECALL_API_KEY) return undefined;
    return new RecallClient({ apiKey: env.RECALL_API_KEY, region: env.RECALL_REGION });
  }

  async createMeeting(input: CreateMeetingRequest): Promise<MeetingSummary> {
    const meeting = await this.prisma.meeting.create({
      data: { meetingUrl: input.meetingUrl, title: input.title },
    });
    const session = await this.prisma.meetingSession.create({
      data: {
        meetingId: meeting.id,
        joinAt: input.joinAt ? new Date(input.joinAt) : undefined,
      },
    });

    const recall = this.recallClient();
    if (!recall) {
      this.logger.warn(
        `RECALL_API_KEY not set — created meeting ${meeting.id} without starting a bot (dev mode)`,
      );
      return toMeetingSummary(meeting, session);
    }

    try {
      const env = loadEnv();
      const bot = await recall.createBot({
        meetingUrl: input.meetingUrl,
        joinAt: input.joinAt,
        transcriptWebhookUrl: `${env.APP_BASE_URL}/webhooks/recall`,
      });
      const captureSession = await this.prisma.captureSession.create({
        data: { meetingSessionId: session.id, provider: "recall", status: "created" },
      });
      await this.prisma.recallBot.create({
        data: { captureSessionId: captureSession.id, recallBotId: bot.id },
      });
      const updatedSession = await this.prisma.meetingSession.update({
        where: { id: session.id },
        data: { status: "bot_joining" },
      });
      return toMeetingSummary(meeting, updatedSession);
    } catch (err) {
      const reason = err instanceof RecallApiError ? err.message : String(err);
      this.logger.error(`Recall bot creation failed for meeting ${meeting.id}: ${reason}`);
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
