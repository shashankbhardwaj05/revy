-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('created', 'scheduled', 'bot_joining', 'bot_joined', 'recording', 'meeting_ended', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "meeting_url" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'created',
    "recall_bot_id" TEXT,
    "join_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);
