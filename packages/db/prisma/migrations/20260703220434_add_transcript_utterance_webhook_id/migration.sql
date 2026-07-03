-- Purely additive: nullable column + unique index. Existing rows all get NULL,
-- which Postgres unique indexes permit (multiple NULLs don't collide). Used to reject
-- duplicate transcript inserts when Recall redelivers a transcript.data webhook.
ALTER TABLE "transcript_utterances" ADD COLUMN     "recall_webhook_id" TEXT;

CREATE UNIQUE INDEX "transcript_utterances_recall_webhook_id_key" ON "transcript_utterances"("recall_webhook_id");
