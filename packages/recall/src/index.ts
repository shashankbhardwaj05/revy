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

/** Raw bot object as returned by Recall — stored verbatim, never consumed downstream. */
export type RecallBot = Record<string, unknown> & { id: string };

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
 * Not yet wired to a controller (that's M4) — this is ready to import once the
 * webhook receiver exists.
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
