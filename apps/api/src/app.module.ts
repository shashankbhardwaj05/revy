import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { MeetingsModule } from "./meetings/meetings.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

@Module({
  imports: [MeetingsModule, WebhooksModule],
  controllers: [HealthController],
})
export class AppModule {}
