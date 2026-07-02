import { z } from "zod";

/**
 * Meeting lifecycle for the V0 transcriber scope.
 * The full product lifecycle (segments, syncs) extends this — see docs/architecture.
 */
export const MeetingStatus = z.enum([
  "created",
  "scheduled",
  "bot_joining",
  "bot_joined",
  "recording",
  "meeting_ended",
  "processing",
  "completed",
  "failed",
]);
export type MeetingStatus = z.infer<typeof MeetingStatus>;

export const CreateMeetingRequest = z.object({
  meetingUrl: z
    .string()
    .url()
    .refine((u) => u.includes("meet.google.com"), {
      message: "Only Google Meet URLs are supported in V0",
    }),
  title: z.string().min(1).max(200).optional(),
  /** ISO timestamp — when set and in the future, the bot is scheduled instead of joining now */
  joinAt: z.string().datetime().optional(),
});
export type CreateMeetingRequest = z.infer<typeof CreateMeetingRequest>;

export const MeetingSummary = z.object({
  id: z.string(),
  title: z.string().nullable(),
  meetingUrl: z.string(),
  status: MeetingStatus,
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});
export type MeetingSummary = z.infer<typeof MeetingSummary>;

/** Normalized transcript utterance — provider-agnostic (Recall today, local capture later) */
export const Utterance = z.object({
  seq: z.number().int(),
  speaker: z.string(),
  text: z.string(),
  startedMs: z.number().int(),
  endedMs: z.number().int().nullable(),
  isFinal: z.boolean(),
});
export type Utterance = z.infer<typeof Utterance>;
