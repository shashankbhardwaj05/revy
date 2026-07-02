-- AlterEnum
ALTER TYPE "MeetingStatus" ADD VALUE 'transcribing';

-- CreateTable
CREATE TABLE "transcript_utterances" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "speaker" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "started_ms" INTEGER,
    "ended_ms" INTEGER,
    "is_final" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_utterances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transcript_utterances_meeting_id_seq_idx" ON "transcript_utterances"("meeting_id", "seq");

-- AddForeignKey
ALTER TABLE "transcript_utterances" ADD CONSTRAINT "transcript_utterances_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
