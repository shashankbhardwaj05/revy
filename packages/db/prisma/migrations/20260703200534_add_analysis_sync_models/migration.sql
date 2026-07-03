-- CreateTable
CREATE TABLE "meeting_summaries" (
    "id" TEXT NOT NULL,
    "meeting_session_id" TEXT NOT NULL,
    "summary_text" TEXT NOT NULL,
    "action_items" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_analysis" (
    "id" TEXT NOT NULL,
    "meeting_session_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "required_segments_completed" INTEGER NOT NULL DEFAULT 0,
    "missing_segments" JSONB,
    "pilot_pitched" BOOLEAN NOT NULL DEFAULT false,
    "pricing_discussed" BOOLEAN NOT NULL DEFAULT false,
    "next_step_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubspot_sync_jobs" (
    "id" TEXT NOT NULL,
    "meeting_session_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "hubspot_object_type" TEXT,
    "hubspot_object_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hubspot_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_crm_mappings" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "hubspot_deal_id" TEXT,
    "hubspot_contact_id" TEXT,
    "hubspot_company_id" TEXT,
    "matched_via" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_crm_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_analysis_meeting_session_id_key" ON "meeting_analysis"("meeting_session_id");

-- AddForeignKey
ALTER TABLE "meeting_summaries" ADD CONSTRAINT "meeting_summaries_meeting_session_id_fkey" FOREIGN KEY ("meeting_session_id") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_analysis" ADD CONSTRAINT "meeting_analysis_meeting_session_id_fkey" FOREIGN KEY ("meeting_session_id") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubspot_sync_jobs" ADD CONSTRAINT "hubspot_sync_jobs_meeting_session_id_fkey" FOREIGN KEY ("meeting_session_id") REFERENCES "meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_crm_mappings" ADD CONSTRAINT "external_crm_mappings_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
