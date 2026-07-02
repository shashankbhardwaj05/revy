import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { loadEnv } from "@notetaker/config";
import type { CreateMeetingRequest, MeetingSummary } from "@notetaker/contracts";
import { getPrisma, toMeetingSummary } from "@notetaker/db";
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
    const row = await this.prisma.meeting.create({
      data: {
        meetingUrl: input.meetingUrl,
        title: input.title,
        joinAt: input.joinAt ? new Date(input.joinAt) : undefined,
      },
    });

    const recall = this.recallClient();
    if (!recall) {
      this.logger.warn(
        `RECALL_API_KEY not set — created meeting ${row.id} without starting a bot (dev mode)`,
      );
      return toMeetingSummary(row);
    }

    try {
      const bot = await recall.createBot({
        meetingUrl: input.meetingUrl,
        joinAt: input.joinAt,
      });
      const updated = await this.prisma.meeting.update({
        where: { id: row.id },
        data: { recallBotId: bot.id, status: "bot_joining" },
      });
      return toMeetingSummary(updated);
    } catch (err) {
      const reason = err instanceof RecallApiError ? err.message : String(err);
      this.logger.error(`Recall bot creation failed for meeting ${row.id}: ${reason}`);
      const failed = await this.prisma.meeting.update({
        where: { id: row.id },
        data: { status: "failed" },
      });
      return toMeetingSummary(failed);
    }
  }

  async listMeetings(): Promise<MeetingSummary[]> {
    const rows = await this.prisma.meeting.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(toMeetingSummary);
  }

  async getMeeting(id: string): Promise<MeetingSummary> {
    const row = await this.prisma.meeting.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Meeting ${id} not found`);
    return toMeetingSummary(row);
  }
}
