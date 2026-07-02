import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CreateMeetingRequest } from "@notetaker/contracts";
import { parseOrThrow } from "../common/zod";
import { MeetingsService } from "./meetings.service";

@Controller("meetings")
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Post()
  create(@Body() body: unknown) {
    const input = parseOrThrow(CreateMeetingRequest, body);
    return this.meetings.createMeeting(input);
  }

  @Get()
  list() {
    return this.meetings.listMeetings();
  }

  @Get(":id")
  getOne(@Param("id") id: string) {
    return this.meetings.getMeeting(id);
  }
}
