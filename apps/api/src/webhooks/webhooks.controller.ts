import {
  BadRequestException,
  Controller,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import { loadEnv } from "@notetaker/config";
import { RECALL_WEBHOOK_HEADERS, verifyRecallWebhookSignature } from "@notetaker/recall";
import type { FastifyRequest } from "fastify";
import { WebhooksService } from "./webhooks.service";

@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post("recall")
  async handleRecall(@Req() req: RawBodyRequest<FastifyRequest>): Promise<{ ok: true }> {
    const env = loadEnv();
    if (!env.RECALL_WEBHOOK_SECRET) {
      throw new UnauthorizedException("Webhook receiver is not configured");
    }

    const id = req.headers[RECALL_WEBHOOK_HEADERS.id];
    const timestamp = req.headers[RECALL_WEBHOOK_HEADERS.timestamp];
    const signature = req.headers[RECALL_WEBHOOK_HEADERS.signature];
    if (typeof id !== "string" || typeof timestamp !== "string" || typeof signature !== "string") {
      throw new BadRequestException("Missing webhook signature headers");
    }

    const raw = req.rawBody?.toString("utf8") ?? "";
    const valid = verifyRecallWebhookSignature({ id, timestamp, signature }, raw, env.RECALL_WEBHOOK_SECRET);
    if (!valid) {
      throw new UnauthorizedException("Invalid webhook signature");
    }

    await this.webhooks.handleRecallEvent(JSON.parse(raw));
    return { ok: true };
  }
}
