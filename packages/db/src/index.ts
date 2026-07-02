import { PrismaClient, type Meeting as MeetingRow } from "@prisma/client";
import type { MeetingSummary } from "@notetaker/contracts";

export { PrismaClient } from "@prisma/client";
export type { Meeting as MeetingRow } from "@prisma/client";

let cached: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!cached) cached = new PrismaClient();
  return cached;
}

export function toMeetingSummary(row: MeetingRow): MeetingSummary {
  return {
    id: row.id,
    title: row.title,
    meetingUrl: row.meetingUrl,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}
