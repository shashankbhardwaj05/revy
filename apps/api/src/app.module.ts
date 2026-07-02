import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { MeetingsModule } from "./meetings/meetings.module";

@Module({
  imports: [MeetingsModule],
  controllers: [HealthController],
})
export class AppModule {}
