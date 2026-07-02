import {
  PrismaClient,
  type Meeting as MeetingRow,
  type TranscriptUtterance as TranscriptUtteranceRow,
} from "@prisma/client";
import type { MeetingSummary, Utterance } from "@notetaker/contracts";

export { PrismaClient } from "@prisma/client";
export type { Meeting as MeetingRow, TranscriptUtterance as TranscriptUtteranceRow } from "@prisma/client";

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

export function toUtterance(row: TranscriptUtteranceRow): Utterance {
  return {
    seq: row.seq,
    speaker: row.speaker,
    text: row.text,
    startedMs: row.startedMs ?? 0,
    endedMs: row.endedMs,
    isFinal: row.isFinal,
  };
}
