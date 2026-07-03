-- Reordered by hand from Prisma's raw diff (see `prisma migrate diff` output) so that
-- existing data is copied into the new tables BEFORE the old columns are dropped.
-- Prisma's own generated ordering drops `meetings.status/join_at/started_at/ended_at/
-- recall_bot_id/updated_at` and `transcript_utterances.meeting_id` before the new tables
-- even exist, which would either error (NOT NULL column with no rows to source from) or
-- silently discard real data. This version is safe to run against a table with existing
-- rows; the whole file runs as one transaction, so a failure at any step rolls back
-- everything and leaves the database exactly as it was.

-- Step 1: widen the enum (safe — no later statement in this file uses the new values)
ALTER TYPE "MeetingStatus" ADD VALUE 'processing_final_analysis';
ALTER TYPE "MeetingStatus" ADD VALUE 'synced_to_hubspot';

-- Step 2: new enum for capture provider
CREATE TYPE "CaptureProvider" AS ENUM ('recall', 'local_desktop');

-- Step 3: new columns on meetings — additive, nullable, safe
ALTER TABLE "meetings" ADD COLUMN "org_id" TEXT,
ADD COLUMN "playbook_id" TEXT,
ADD COLUMN "hubspot_deal_id" TEXT;

-- Step 4: create the new tables the data will move into
CREATE TABLE "meeting_sessions" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'created',
    "join_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "capture_sessions" (
    "id" TEXT NOT NULL,
    "meeting_session_id" TEXT NOT NULL,
    "provider" "CaptureProvider" NOT NULL DEFAULT 'recall',
    "provider_session_ref" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capture_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recall_bots" (
    "id" TEXT NOT NULL,
    "capture_session_id" TEXT NOT NULL,
    "recall_bot_id" TEXT NOT NULL,
    "raw_last_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recall_bots_pkey" PRIMARY KEY ("id")
);

-- Step 5: copy every existing meeting's data into the new shape, before anything is
-- dropped. One session per existing meeting (today's flattened rows are exactly that:
-- one meeting, one capture attempt each).
INSERT INTO "meeting_sessions" ("id", "meeting_id", "status", "join_at", "started_at", "ended_at", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", "status", "join_at", "started_at", "ended_at", "created_at", "updated_at"
FROM "meetings";

-- Only meetings that actually had a bot get a capture session + recall bot record.
INSERT INTO "capture_sessions" ("id", "meeting_session_id", "provider", "status", "created_at")
SELECT gen_random_uuid(), ms."id", 'recall', 'unknown', ms."created_at"
FROM "meeting_sessions" ms
JOIN "meetings" m ON m."id" = ms."meeting_id"
WHERE m."recall_bot_id" IS NOT NULL;

INSERT INTO "recall_bots" ("id", "capture_session_id", "recall_bot_id", "created_at")
SELECT gen_random_uuid(), cs."id", m."recall_bot_id", cs."created_at"
FROM "capture_sessions" cs
JOIN "meeting_sessions" ms ON ms."id" = cs."meeting_session_id"
JOIN "meetings" m ON m."id" = ms."meeting_id";

-- Step 6: re-point transcript_utterances at the new session, in two safe sub-steps
-- (add nullable, backfill, then enforce NOT NULL) instead of adding a NOT NULL column
-- with no default against a table that already has rows.
ALTER TABLE "transcript_utterances" ADD COLUMN "meeting_session_id" TEXT;

UPDATE "transcript_utterances" tu
SET "meeting_session_id" = ms."id"
FROM "meeting_sessions" ms
WHERE ms."meeting_id" = tu."meeting_id";

ALTER TABLE "transcript_utterances" ALTER COLUMN "meeting_session_id" SET NOT NULL;

-- Step 7: now safe to drop the old foreign key, index, and column on transcript_utterances
-- — every row already has its new meeting_session_id populated above.
ALTER TABLE "transcript_utterances" DROP CONSTRAINT "transcript_utterances_meeting_id_fkey";
DROP INDEX "transcript_utterances_meeting_id_seq_idx";
ALTER TABLE "transcript_utterances" DROP COLUMN "meeting_id";

-- Step 8: now safe to drop the old flattened columns from meetings — every row's data
-- was copied into meeting_sessions/capture_sessions/recall_bots above.
ALTER TABLE "meetings" DROP COLUMN "ended_at",
DROP COLUMN "join_at",
DROP COLUMN "recall_bot_id",
DROP COLUMN "started_at",
DROP COLUMN "status",
DROP COLUMN "updated_at";

-- Step 9: new foreign keys
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_playbook_id_fkey" FOREIGN KEY ("playbook_id") REFERENCES "playbooks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "capture_sessions" ADD CONSTRAINT "capture_sessions_meeting_session_id_fkey" FOREIGN KEY ("meeting_session_id") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recall_bots" ADD CONSTRAINT "recall_bots_capture_session_id_fkey" FOREIGN KEY ("capture_session_id") REFERENCES "capture_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transcript_utterances" ADD CONSTRAINT "transcript_utterances_meeting_session_id_fkey" FOREIGN KEY ("meeting_session_id") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 10: new indexes
CREATE UNIQUE INDEX "recall_bots_capture_session_id_key" ON "recall_bots"("capture_session_id");
CREATE UNIQUE INDEX "recall_bots_recall_bot_id_key" ON "recall_bots"("recall_bot_id");
CREATE INDEX "transcript_utterances_meeting_session_id_seq_idx" ON "transcript_utterances"("meeting_session_id", "seq");
