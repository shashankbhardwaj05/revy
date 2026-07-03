import {
  PrismaClient,
  type Meeting as MeetingRow,
  type MeetingSession as MeetingSessionRow,
  type TranscriptUtterance as TranscriptUtteranceRow,
} from "@prisma/client";
import type { MeetingSummary, Utterance } from "@notetaker/contracts";

export { PrismaClient, Prisma } from "@prisma/client";
export type {
  Meeting as MeetingRow,
  MeetingSession as MeetingSessionRow,
  TranscriptUtterance as TranscriptUtteranceRow,
} from "@prisma/client";

let cached: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!cached) cached = new PrismaClient();
  return cached;
}

export function toMeetingSummary(meeting: MeetingRow, session: MeetingSessionRow): MeetingSummary {
  return {
    id: meeting.id,
    title: meeting.title,
    meetingUrl: meeting.meetingUrl,
    status: session.status,
    createdAt: meeting.createdAt.toISOString(),
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
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
