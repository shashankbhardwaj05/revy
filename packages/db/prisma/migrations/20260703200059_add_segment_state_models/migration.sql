-- CreateEnum
CREATE TYPE "SegmentStatus" AS ENUM ('not_started', 'detected_in_progress', 'completed_ai', 'completed_manual', 'marked_not_applicable', 'rejected_low_confidence', 'missed');

-- CreateTable
CREATE TABLE "meeting_segment_states" (
    "id" TEXT NOT NULL,
    "meeting_session_id" TEXT NOT NULL,
    "playbook_segment_id" TEXT NOT NULL,
    "status" "SegmentStatus" NOT NULL DEFAULT 'not_started',
    "confidence" DOUBLE PRECISION,
    "detected_at" TIMESTAMP(3),
    "speaker" TEXT,

    CONSTRAINT "meeting_segment_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_evidence" (
    "id" TEXT NOT NULL,
    "meeting_segment_state_id" TEXT NOT NULL,
    "utterance_id" TEXT,
    "snippet" TEXT NOT NULL,
    "reason_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segment_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_overrides" (
    "id" TEXT NOT NULL,
    "meeting_segment_state_id" TEXT NOT NULL,
    "user_id" TEXT,
    "previous_status" "SegmentStatus" NOT NULL,
    "new_status" "SegmentStatus" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_overrides_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "meeting_segment_states" ADD CONSTRAINT "meeting_segment_states_meeting_session_id_fkey" FOREIGN KEY ("meeting_session_id") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_segment_states" ADD CONSTRAINT "meeting_segment_states_playbook_segment_id_fkey" FOREIGN KEY ("playbook_segment_id") REFERENCES "playbook_segments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_evidence" ADD CONSTRAINT "segment_evidence_meeting_segment_state_id_fkey" FOREIGN KEY ("meeting_segment_state_id") REFERENCES "meeting_segment_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_overrides" ADD CONSTRAINT "manual_overrides_meeting_segment_state_id_fkey" FOREIGN KEY ("meeting_segment_state_id") REFERENCES "meeting_segment_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_overrides" ADD CONSTRAINT "manual_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
