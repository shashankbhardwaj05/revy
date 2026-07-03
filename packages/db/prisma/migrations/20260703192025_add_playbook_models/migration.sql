-- CreateTable
CREATE TABLE "playbooks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playbooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playbook_segments" (
    "id" TEXT NOT NULL,
    "playbook_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL,

    CONSTRAINT "playbook_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_detection_rules" (
    "id" TEXT NOT NULL,
    "playbook_segment_id" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "rule_config" JSONB NOT NULL,

    CONSTRAINT "segment_detection_rules_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playbook_segments" ADD CONSTRAINT "playbook_segments_playbook_id_fkey" FOREIGN KEY ("playbook_id") REFERENCES "playbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_detection_rules" ADD CONSTRAINT "segment_detection_rules_playbook_segment_id_fkey" FOREIGN KEY ("playbook_segment_id") REFERENCES "playbook_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
