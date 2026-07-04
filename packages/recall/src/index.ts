/**
 * Typed Recall.ai client. This is the ONLY module in the codebase allowed to
 * talk to Recall — everything else consumes normalized types from @notetaker/contracts.
 *
 * Verified 2026-07-03 against https://docs.recall.ai (base URL, auth header, region
 * list, transcript provider name, webhook signature scheme). Anything still marked
 * VERIFY below has not been confirmed against a real API response yet — the live
 * spike (`pnpm recall:spike`) is what confirms those.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Default bot camera image (BEAM logo), shown via `automatic_video_output` — confirmed
 * 2026-07-03 against docs.recall.ai: base64 JPEG, 16:9, ~1280x720, max 1.3MB, no public
 * hosting required. Anonymous bots have no "avatar" field; a static camera feed is the
 * only way to show a picture next to the bot's name.
 */
const DEFAULT_BOT_CAMERA_JPEG_BASE64 = readFileSync(
  join(__dirname, "../assets/bot-camera.jpg"),
).toString("base64");

export interface RecallClientOptions {
  apiKey: string;
  /**
   * Recall region — confirmed valid values: "us-west-2", "us-east-1", "eu-central-1",
   * "ap-northeast-1". Regions are fully separate deployments with separate API keys —
   * VERIFY this key's actual region empirically (a 401 means wrong region, not a bad key).
   */
  region: string;
}

export interface CreateBotParams {
  meetingUrl: string;
  botName?: string;
  /** ISO timestamp: schedule the bot to join at this time instead of immediately */
  joinAt?: string;
  /** Realtime transcript webhook endpoint (Phase 3). Omit for record-only. */
  transcriptWebhookUrl?: string;
  /** Base64 JPEG shown as the bot's camera feed. Defaults to the BEAM logo. */
  cameraImageBase64Jpeg?: string;
}

/** Raw bot object as returned by Recall — mostly stored verbatim; `getFinalTranscript`
    below reads a few nested fields off it once the call has ended. */
export type RecallBot = Record<string, unknown> & { id: string };

interface RecallTranscriptWord {
  text: string;
  start_timestamp?: { relative: number } | null;
  end_timestamp?: { relative: number } | null;
}

interface RecallTranscriptParticipantEntry {
  participant: { id: number; name: string | null };
  words: RecallTranscriptWord[];
}

export interface FinalTranscriptUtterance {
  speaker: string;
  text: string;
  startedMs: number | null;
  endedMs: number | null;
}

export class RecallApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message?: string,
  ) {
    super(message ?? `Recall API error ${status}: ${body.slice(0, 500)}`);
    this.name = "RecallApiError";
  }
}

export class RecallClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: RecallClientOptions) {
    this.apiKey = opts.apiKey;
    // Confirmed per docs.recall.ai/docs/regions
    this.baseUrl = `https://${opts.region}.recall.ai/api/v1`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        // Confirmed per docs.recall.ai/reference/authentication
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new RecallApiError(res.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Create a bot that joins the meeting and records + transcribes.
   * `recording_config.transcript.provider.recallai_streaming` is confirmed per the
   * docs.recall.ai quickstart — no third-party transcription API key required for V0.
   * `realtime_endpoints` shape (webhook url + events array) is confirmed at a high
   * level; exact optional fields are still VERIFY until exercised in M4 with a
   * publicly reachable webhook URL.
   */
  async createBot(params: CreateBotParams): Promise<RecallBot> {
    const cameraImage = params.cameraImageBase64Jpeg ?? DEFAULT_BOT_CAMERA_JPEG_BASE64;
    const payload: Record<string, unknown> = {
      meeting_url: params.meetingUrl,
      bot_name: params.botName ?? "Revy Notetaker",
      automatic_video_output: {
        in_call_recording: { kind: "jpeg", b64_data: cameraImage },
        in_call_not_recording: { kind: "jpeg", b64_data: cameraImage },
      },
      recording_config: {
        transcript: {
          provider: { recallai_streaming: {} },
        },
        ...(params.transcriptWebhookUrl
          ? {
              realtime_endpoints: [
                {
                  type: "webhook",
                  url: params.transcriptWebhookUrl,
                  events: ["transcript.data"],
                },
              ],
            }
          : {}),
      },
      ...(params.joinAt ? { join_at: params.joinAt } : {}),
    };
    return this.request<RecallBot>("POST", "/bot", payload);
  }

  async getBot(botId: string): Promise<RecallBot> {
    return this.request<RecallBot>("GET", `/bot/${botId}`);
  }

  async removeBotFromCall(botId: string): Promise<void> {
    await this.request("POST", `/bot/${botId}/leave_call`);
  }

  /**
   * Fetches the bot's finished, async transcript once the call has ended — the same
   * data the real-time `transcript.data` webhook is supposed to stream incrementally,
   * but as one full download. This is the reliable path when running the
   * `recallai_streaming` provider in `prioritize_accuracy` mode: that mode uses async,
   * non-real-time models, so the live webhook can arrive very late or not at all (see
   * docs/runbooks/webhook-debugging.md), while this async transcript is always complete
   * once Recall finishes processing (`media_shortcuts.transcript.status.code === "done"`).
   * Returns `undefined` if the transcript isn't ready yet or the bot has none (e.g. no one
   * spoke) — never throws for "not ready", only for actual request failures.
   */
  async getFinalTranscript(botId: string): Promise<FinalTranscriptUtterance[] | undefined> {
    const bot = (await this.getBot(botId)) as {
      recordings?: Array<{ media_shortcuts?: { transcript?: { status?: { code?: string }; data?: { download_url?: string } } } }>;
    };
    const transcript = bot.recordings?.[0]?.media_shortcuts?.transcript;
    if (transcript?.status?.code !== "done") return undefined;
    const downloadUrl = transcript.data?.download_url;
    if (!downloadUrl) return undefined;

    const res = await fetch(downloadUrl);
    if (!res.ok) throw new RecallApiError(res.status, await res.text());
    const entries = (await res.json()) as RecallTranscriptParticipantEntry[];

    return entries.flatMap((entry) => {
      const speaker = entry.participant.name ?? `Participant ${entry.participant.id}`;
      return groupWordsIntoUtterances(entry.words).map((u) => ({ speaker, ...u }));
    });
  }
}

/**
 * Recall's async transcript is one entry per participant with a flat word list, not
 * pre-split into utterances — group consecutive words into one utterance whenever the
 * gap between them exceeds `gapThresholdSeconds` (mirrors how live delivery would have
 * chunked it; 1.2s is the heuristic already used for manual recovery, see
 * docs/runbooks/webhook-debugging.md).
 */
function groupWordsIntoUtterances(
  words: RecallTranscriptWord[],
  gapThresholdSeconds = 1.2,
): Array<{ text: string; startedMs: number | null; endedMs: number | null }> {
  const groups: RecallTranscriptWord[][] = [];
  let current: RecallTranscriptWord[] = [];

  for (const word of words) {
    const prevEnd = current[current.length - 1]?.end_timestamp?.relative;
    const curStart = word.start_timestamp?.relative;
    if (current.length > 0 && prevEnd != null && curStart != null && curStart - prevEnd > gapThresholdSeconds) {
      groups.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) groups.push(current);

  return groups.map((group) => ({
    text: group.map((w) => w.text).join(" "),
    startedMs: toMs(group[0].start_timestamp),
    endedMs: toMs(group[group.length - 1].end_timestamp),
  }));
}

function toMs(ts?: { relative: number } | null): number | null {
  return ts ? Math.round(ts.relative * 1000) : null;
}

/**
 * Provider-agnostic capture abstraction (per Orchestration.md §0/§18): the goal is that
 * bot-based capture (Recall today) can eventually be swapped for a Granola-style
 * local/desktop capture with no visible bot, without rewriting the scheduling logic that
 * calls it. Deliberately minimal — only the two operations actually called today
 * (start a capture, stop one on cleanup). Per §18's own risk note, resist adding
 * `startRecording`/`stopRecording`/`getStatus`/`handleProviderWebhook` speculatively —
 * add them only once a second provider (or a real use of them) actually needs them.
 */
export interface CaptureSessionHandle {
  /** Provider-specific reference for this capture attempt (Recall's bot id today). */
  providerSessionRef: string;
}

export interface CaptureProviderCreateParams {
  meetingUrl: string;
  joinAt?: string;
  /** Realtime transcript webhook endpoint. Omit for record-only. */
  webhookUrl?: string;
}

export interface CaptureProvider {
  /** Starts a capture session for the given meeting. Throws on failure. */
  createSession(params: CaptureProviderCreateParams): Promise<CaptureSessionHandle>;
  /** Stops/cancels an in-progress capture session — used for cleanup after a partial failure. */
  stopSession(providerSessionRef: string): Promise<void>;
}

export class RecallBotProvider implements CaptureProvider {
  constructor(private readonly client: RecallClient) {}

  async createSession(params: CaptureProviderCreateParams): Promise<CaptureSessionHandle> {
    const bot = await this.client.createBot({
      meetingUrl: params.meetingUrl,
      joinAt: params.joinAt,
      transcriptWebhookUrl: params.webhookUrl,
    });
    return { providerSessionRef: bot.id };
  }

  async stopSession(providerSessionRef: string): Promise<void> {
    await this.client.removeBotFromCall(providerSessionRef);
  }
}

/** Exact header names Recall sends on every webhook/websocket request (case-insensitive over HTTP). */
export const RECALL_WEBHOOK_HEADERS = {
  id: "webhook-id",
  timestamp: "webhook-timestamp",
  signature: "webhook-signature",
} as const;

export interface RecallWebhookHeaders {
  id: string;
  timestamp: string;
  /** May contain multiple space-separated "v1,<sig>" entries during secret rotation. */
  signature: string;
}

/**
 * Verifies a Recall.ai webhook/websocket request. Confirmed 2026-07-03 against
 * docs.recall.ai/docs/authenticating-requests-from-recallai — HMAC-SHA256 over
 * `{id}.{timestamp}.{payload}`, keyed by the base64 portion of the workspace secret
 * (format `whsec_<base64>`). `payload` is the raw request body string — pass `""`
 * for GET/websocket upgrade requests, which sign an empty payload.
 *
 * Wired into apps/api/src/webhooks/webhooks.controller.ts. This only proves the request
 * wasn't tampered with — it does NOT prove freshness, since the signature is a pure
 * function of values that never change once captured. Always pair with
 * `isRecallWebhookTimestampFresh` to reject replays of an old, correctly-signed request.
 */
export function verifyRecallWebhookSignature(
  headers: RecallWebhookHeaders,
  payload: string,
  secret: string,
): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${headers.id}.${headers.timestamp}.${payload}`;
  const expected = createHmac("sha256", key).update(signedContent).digest("base64");

  return headers.signature
    .split(" ")
    .map((entry) => entry.split(",")[1])
    .filter((sig): sig is string => Boolean(sig))
    .some((sig) => {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    });
}

/**
 * A correctly-signed webhook request is a bearer credential with no built-in expiry —
 * anyone who captures one in full (headers + raw body) could replay it indefinitely.
 * Rejects requests whose `Webhook-Timestamp` (Unix seconds, per Svix-style headers) is
 * further than `toleranceSeconds` from now, in either direction (also guards against a
 * clock-skewed or malicious future timestamp).
 */
export function isRecallWebhookTimestampFresh(
  timestamp: string,
  toleranceSeconds = 5 * 60,
  nowMs: number = Date.now(),
): boolean {
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const ageSeconds = Math.abs(nowMs / 1000 - timestampSeconds);
  return ageSeconds <= toleranceSeconds;
}
