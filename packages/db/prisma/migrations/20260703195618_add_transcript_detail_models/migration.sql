-- CreateTable
CREATE TABLE "participants" (
    "id" TEXT NOT NULL,
    "meeting_session_id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "is_host" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_words" (
    "id" TEXT NOT NULL,
    "utterance_id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "started_ms" INTEGER,
    "ended_ms" INTEGER,
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "transcript_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_raw_events" (
    "id" TEXT NOT NULL,
    "capture_session_id" TEXT,
    "provider" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_raw_events_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_meeting_session_id_fkey" FOREIGN KEY ("meeting_session_id") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_words" ADD CONSTRAINT "transcript_words_utterance_id_fkey" FOREIGN KEY ("utterance_id") REFERENCES "transcript_utterances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_raw_events" ADD CONSTRAINT "transcript_raw_events_capture_session_id_fkey" FOREIGN KEY ("capture_session_id") REFERENCES "capture_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
