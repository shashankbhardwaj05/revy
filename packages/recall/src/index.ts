/**
 * Typed Recall.ai client. This is the ONLY module in the codebase allowed to
 * talk to Recall — everything else consumes normalized types from @notetaker/contracts.
 *
 * ⚠️ CONTRACT VERIFICATION: endpoint paths, auth header format, and payload
 * shapes below follow the Recall.ai docs pattern but MUST be verified against
 * https://docs.recall.ai before the first real call (Phase 1 spike does this).
 * Anything marked VERIFY is an assumption until the spike confirms it.
 */

export interface RecallClientOptions {
  apiKey: string;
  /** Recall region, e.g. "us-west-2" — determines the API base URL. VERIFY against your account's region. */
  region: string;
}

export interface CreateBotParams {
  meetingUrl: string;
  botName?: string;
  /** ISO timestamp: schedule the bot to join at this time instead of immediately */
  joinAt?: string;
  /** Realtime transcript webhook endpoint (Phase 3). Omit for record-only. */
  transcriptWebhookUrl?: string;
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
    // VERIFY: regional base URL format per docs.recall.ai
    this.baseUrl = `https://${opts.region}.recall.ai/api/v1`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        // VERIFY: Recall uses "Authorization: Token <key>" per docs
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
   * VERIFY: recording_config / transcript provider shape against current docs
   * before first use — this is the highest-drift part of the contract.
   */
  async createBot(params: CreateBotParams): Promise<RecallBot> {
    const payload: Record<string, unknown> = {
      meeting_url: params.meetingUrl,
      bot_name: params.botName ?? "AI Notetaker",
      recording_config: {
        transcript: {
          provider: { meeting_captions: {} }, // VERIFY: cheapest/simplest provider for V0
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
