# Full Data Model (M3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the flattened single-table `meetings` schema to the full ~20-entity data
model defined in `docs/architecture/Orchestration.md` §6 (orgs, users, playbooks,
segments, sync jobs, etc.), widen `packages/contracts`' `MeetingStatus` per §5, and adapt
the existing V1 code paths (`meetings.service.ts`, `webhooks.service.ts`) to the new
shape without changing observable behavior — no new business logic (playbook CRUD,
segment detection, HubSpot sync) is in scope; that's M5/M7/M9.

**Architecture:** Prisma schema additions in `packages/db/prisma/schema.prisma`, one
migration per task via `prisma migrate dev --name <name>`. Tasks are ordered so every
early task is purely additive (new tables nothing references yet) and the one breaking
change — splitting `Meeting` into `Meeting` + `MeetingSession` — happens once, in Task 3,
after its dependencies (`Organization`, `Playbook`) already exist.

**Tech Stack:** Prisma 6.5, PostgreSQL (Supabase), NestJS/Fastify (`apps/api`), Next.js
(`apps/web`).

## Global Constraints

- **The local `DATABASE_URL`/`DIRECT_URL` in `packages/db/.env` point at the SAME Supabase
  project Railway's live `api` service uses.** Running `prisma migrate dev` here alters
  the live schema immediately — there is no staging environment (per Orchestration.md
  §13/§14). Treat every migration in this plan as a production change.
- **Before Task 3 specifically** (the breaking Meeting/MeetingSession split): take a
  Supabase backup first. Either use the Supabase dashboard's "Database → Backups →
  create manual backup" or run `pg_dump "$DIRECT_URL" -F c -f pre-m3-backup.dump` from
  `packages/db/`. Do not proceed with Task 3 until this exists.
- **After Task 3's migration is applied, deploy the adapted `apps/api` code immediately**
  (`git push` on `main` after merge, or manually `railway redeploy` if testing on a
  branch first) — the live Railway `api` process is running old code against the old
  schema shape; minimize the window where the DB shape and deployed code disagree.
- No new tests-framework work in this plan (per Orchestration.md, none exists yet — not
  blocking M3). Each task's "test" is a small throwaway Node verification script using
  `@prisma/client` directly, run with `node`, proving the new model round-trips through
  Postgres. Delete each script after its task's commit (`git add` won't pick it up if
  deleted first — remove before committing, or add to `.gitignore` scratch pattern if one
  exists).
- Existing convention in `packages/db/src/index.ts`: when a Prisma-generated type name
  would collide with a `@notetaker/contracts` type of the same name, alias the Prisma
  import with a `Row` suffix (e.g. `Meeting as MeetingRow`). Follow this for any new
  colliding names (only `MeetingSummary` collides — contracts already exports a
  `MeetingSummary` zod type for API responses).
- Migration naming: `prisma migrate dev --name <snake_case_name>` — Prisma prefixes the
  timestamp automatically, matching the existing `20260702113049_init_meetings` pattern.

---

### Task 1: Tenancy models (Organization, User, AuthAccount)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Test: `packages/db/scripts/verify-tenancy.cjs` (throwaway, deleted before commit)

**Interfaces:**
- Consumes: nothing from earlier tasks (first task).
- Produces: `Organization`, `User`, `AuthAccount` Prisma models, callable as
  `prisma.organization`, `prisma.user`, `prisma.authAccount`. Later tasks (2, 3, 5, 6)
  reference `Organization.id` and `User.id` as optional FKs.

- [ ] **Step 1: Add the models to `schema.prisma`**

Append to `packages/db/prisma/schema.prisma`:

```prisma
model Organization {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  users     User[]
  playbooks Playbook[]
  meetings  Meeting[]

  @@map("organizations")
}

model User {
  id        String   @id @default(uuid())
  orgId     String   @map("org_id")
  org       Organization @relation(fields: [orgId], references: [id])
  email     String   @unique
  name      String?
  role      String   @default("member")
  createdAt DateTime @default(now()) @map("created_at")

  authAccounts AuthAccount[]

  @@map("users")
}

model AuthAccount {
  id                String   @id @default(uuid())
  userId            String   @map("user_id")
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider          String
  providerAccountId String   @map("provider_account_id")
  createdAt         DateTime @default(now()) @map("created_at")

  @@unique([provider, providerAccountId])
  @@map("auth_accounts")
}
```

- [ ] **Step 2: Create and apply the migration**

Run: `cd packages/db && npx prisma migrate dev --name add_tenancy_models`
Expected: `Your database is now in sync with your schema.` and a new folder under
`packages/db/prisma/migrations/` with a name ending in `_add_tenancy_models`.

- [ ] **Step 3: Write the verification script**

Create `packages/db/scripts/verify-tenancy.cjs`:

```js
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const org = await prisma.organization.create({ data: { name: "Verify Org" } });
  const user = await prisma.user.create({
    data: { orgId: org.id, email: `verify-${Date.now()}@example.com`, role: "admin" },
  });
  await prisma.authAccount.create({
    data: { userId: user.id, provider: "google", providerAccountId: `sub-${Date.now()}` },
  });
  const fetched = await prisma.user.findUnique({
    where: { id: user.id },
    include: { authAccounts: true, org: true },
  });
  if (fetched?.authAccounts.length !== 1 || fetched.org.id !== org.id) {
    throw new Error("Tenancy round-trip failed");
  }
  console.log("OK: tenancy models round-trip");
  await prisma.authAccount.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Run it**

Run: `cd packages/db && npx prisma generate && node scripts/verify-tenancy.cjs`
Expected: `OK: tenancy models round-trip`

- [ ] **Step 5: Delete the script and commit**

```bash
rm packages/db/scripts/verify-tenancy.cjs
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Organization, User, AuthAccount models"
```

---

### Task 2: Playbook models (Playbook, PlaybookSegment, SegmentDetectionRule)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Test: `packages/db/scripts/verify-playbooks.cjs` (throwaway)

**Interfaces:**
- Consumes: `Organization` model from Task 1 (`orgId` FK).
- Produces: `Playbook`, `PlaybookSegment`, `SegmentDetectionRule` models. Task 3's
  `Meeting.playbookId` references `Playbook.id`. Task 5's `MeetingSegmentState` and
  `ManualOverride` reference `PlaybookSegment.id`.

- [ ] **Step 1: Add the models to `schema.prisma`, and add the required back-relation
  to the existing `Organization` model**

`Playbook.org` below is a relation to `Organization`, so `Organization` needs a matching
`playbooks Playbook[]` field or `prisma generate`/`migrate dev` will fail validation with
"missing an opposite relation field on the model Organization" — Task 1 deliberately left
this off `Organization` since `Playbook` didn't exist yet. Add this one line to the
existing `Organization` model block (do not touch anything else in it):

```prisma
model Organization {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  users     User[]
  playbooks Playbook[]

  @@map("organizations")
}
```

```prisma
model Playbook {
  id        String   @id @default(uuid())
  orgId     String   @map("org_id")
  org       Organization @relation(fields: [orgId], references: [id])
  name      String
  isDefault Boolean  @default(false) @map("is_default")
  createdAt DateTime @default(now()) @map("created_at")

  segments PlaybookSegment[]

  @@map("playbooks")
}

model PlaybookSegment {
  id          String   @id @default(uuid())
  playbookId  String   @map("playbook_id")
  playbook    Playbook @relation(fields: [playbookId], references: [id], onDelete: Cascade)
  name        String
  description String?
  isRequired  Boolean  @default(true) @map("is_required")
  order       Int

  rules  SegmentDetectionRule[]
  states MeetingSegmentState[]
  overrides ManualOverride[]

  @@map("playbook_segments")
}

model SegmentDetectionRule {
  id                String   @id @default(uuid())
  playbookSegmentId String   @map("playbook_segment_id")
  playbookSegment   PlaybookSegment @relation(fields: [playbookSegmentId], references: [id], onDelete: Cascade)
  ruleType          String   @map("rule_type")
  ruleConfig        Json     @map("rule_config")

  @@map("segment_detection_rules")
}
```

Note: `PlaybookSegment.states` and `.overrides` back-relations point at
`MeetingSegmentState`/`ManualOverride`, which don't exist until Task 5. Prisma requires
both sides of a relation to exist in the same `schema.prisma` file, but not necessarily
in the same migration — leave these two lines out for now and add them in Task 5 instead,
to keep this task's schema valid on its own:

```prisma
model PlaybookSegment {
  id          String   @id @default(uuid())
  playbookId  String   @map("playbook_id")
  playbook    Playbook @relation(fields: [playbookId], references: [id], onDelete: Cascade)
  name        String
  description String?
  isRequired  Boolean  @default(true) @map("is_required")
  order       Int

  rules SegmentDetectionRule[]

  @@map("playbook_segments")
}
```

- [ ] **Step 2: Create and apply the migration**

Run: `cd packages/db && npx prisma migrate dev --name add_playbook_models`
Expected: `Your database is now in sync with your schema.`

- [ ] **Step 3: Write the verification script**

Create `packages/db/scripts/verify-playbooks.cjs`:

```js
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const org = await prisma.organization.create({ data: { name: "Verify Org 2" } });
  const playbook = await prisma.playbook.create({
    data: { orgId: org.id, name: "Discovery Call", isDefault: true },
  });
  const segment = await prisma.playbookSegment.create({
    data: { playbookId: playbook.id, name: "Pricing", isRequired: true, order: 1 },
  });
  await prisma.segmentDetectionRule.create({
    data: { playbookSegmentId: segment.id, ruleType: "keyword", ruleConfig: { keywords: ["pricing", "$"] } },
  });
  const fetched = await prisma.playbook.findUnique({
    where: { id: playbook.id },
    include: { segments: { include: { rules: true } } },
  });
  if (fetched?.segments[0]?.rules.length !== 1) {
    throw new Error("Playbook round-trip failed");
  }
  console.log("OK: playbook models round-trip");
  await prisma.segmentDetectionRule.deleteMany({ where: { playbookSegmentId: segment.id } });
  await prisma.playbookSegment.delete({ where: { id: segment.id } });
  await prisma.playbook.delete({ where: { id: playbook.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Run it**

Run: `cd packages/db && npx prisma generate && node scripts/verify-playbooks.cjs`
Expected: `OK: playbook models round-trip`

- [ ] **Step 5: Delete the script and commit**

```bash
rm packages/db/scripts/verify-playbooks.cjs
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Playbook, PlaybookSegment, SegmentDetectionRule models"
```

---

### Task 3: Meeting/MeetingSession split (the breaking change) + code adaptation

**⚠️ Follow the Global Constraints backup step before starting this task.**

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/api/src/meetings/meetings.service.ts`
- Modify: `apps/api/src/webhooks/webhooks.service.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/web/src/app/meetings/page.tsx`
- Modify: `apps/web/src/app/meetings/[id]/page.tsx`
- Test: `packages/db/scripts/verify-meeting-split.cjs` (throwaway)

**Interfaces:**
- Consumes: `Organization` (Task 1), `Playbook` (Task 2).
- Produces: `Meeting` (logical meeting: title/url/org/playbook — no status), `MeetingSession`
  (one capture instance: `status: MeetingStatus`, `joinAt`, `startedAt`, `endedAt`),
  `CaptureSession` (provider-agnostic attempt), `RecallBot` (`recallBotId` moves here from
  `Meeting`). `TranscriptUtterance.meetingId` renamed to `meetingSessionId`. Later tasks
  (4, 5, 6) attach to `MeetingSession`/`CaptureSession`, not `Meeting`, for
  session-scoped data.
- `MeetingStatus` enum gains `processing_final_analysis` and `synced_to_hubspot` (added,
  not replacing `processing` — nothing yet writes those two new values; that's M4/M9's
  job, not this task's).

**Design decision — API contract stays flat for now:** `apps/web` and the public REST API
(`GET /meetings`, `POST /meetings`) continue to work with one `MeetingSummary` per
Meeting, sourced by joining `Meeting` with its most recent `MeetingSession`. V1 only ever
creates one session per meeting today (no rejoin/retry logic yet — that's a real feature,
not built until later), so "most recent session" and "the session" are equivalent for now.
This keeps `packages/contracts`' `MeetingSummary` shape unchanged and avoids touching
`apps/web` beyond the enum exhaustiveness checks TypeScript will force.

- [ ] **Step 1: Update `schema.prisma`** — replace the existing `Meeting` model and
  `MeetingStatus` enum, update `TranscriptUtterance`, and add the required back-relations
  to `Organization` and `Playbook`.

`Meeting` below gets `orgId`/`org` and `playbookId`/`playbook` relation fields, so both
`Organization` and `Playbook` need a matching `meetings Meeting[]` field (same reasoning
as Task 2's Organization/Playbook fix — Prisma requires both sides of a relation
declared). Add one line to each existing model:

```prisma
model Organization {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  users     User[]
  playbooks Playbook[]
  meetings  Meeting[]

  @@map("organizations")
}

model Playbook {
  id        String   @id @default(uuid())
  orgId     String   @map("org_id")
  org       Organization @relation(fields: [orgId], references: [id])
  name      String
  isDefault Boolean  @default(false) @map("is_default")
  createdAt DateTime @default(now()) @map("created_at")

  segments PlaybookSegment[]
  meetings Meeting[]

  @@map("playbooks")
}
```

```prisma
enum MeetingStatus {
  created
  scheduled
  bot_joining
  bot_joined
  recording
  transcribing
  meeting_ended
  processing
  processing_final_analysis
  synced_to_hubspot
  completed
  failed
}

enum CaptureProvider {
  recall
  local_desktop
}

model Meeting {
  id            String    @id @default(uuid())
  orgId         String?   @map("org_id")
  org           Organization? @relation(fields: [orgId], references: [id])
  title         String?
  meetingUrl    String    @map("meeting_url")
  playbookId    String?   @map("playbook_id")
  playbook      Playbook? @relation(fields: [playbookId], references: [id])
  hubspotDealId String?   @map("hubspot_deal_id")
  createdAt     DateTime  @default(now()) @map("created_at")

  sessions MeetingSession[]

  @@map("meetings")
}

model MeetingSession {
  id        String        @id @default(uuid())
  meetingId String        @map("meeting_id")
  meeting   Meeting       @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  status    MeetingStatus @default(created)
  joinAt    DateTime?     @map("join_at")
  startedAt DateTime?     @map("started_at")
  endedAt   DateTime?     @map("ended_at")
  createdAt DateTime      @default(now()) @map("created_at")
  updatedAt DateTime      @updatedAt @map("updated_at")

  captureSessions CaptureSession[]
  utterances      TranscriptUtterance[]

  @@map("meeting_sessions")
}

model CaptureSession {
  id                 String          @id @default(uuid())
  meetingSessionId   String          @map("meeting_session_id")
  meetingSession     MeetingSession  @relation(fields: [meetingSessionId], references: [id], onDelete: Cascade)
  provider           CaptureProvider @default(recall)
  providerSessionRef String?         @map("provider_session_ref")
  status             String
  createdAt          DateTime        @default(now()) @map("created_at")

  recallBot RecallBot?

  @@map("capture_sessions")
}

model RecallBot {
  id               String         @id @default(uuid())
  captureSessionId String         @unique @map("capture_session_id")
  captureSession   CaptureSession @relation(fields: [captureSessionId], references: [id], onDelete: Cascade)
  recallBotId      String         @unique @map("recall_bot_id")
  rawLastPayload   Json?          @map("raw_last_payload")
  createdAt        DateTime       @default(now()) @map("created_at")

  @@map("recall_bots")
}

model TranscriptUtterance {
  id               String   @id @default(uuid())
  meetingSessionId String   @map("meeting_session_id")
  meetingSession   MeetingSession @relation(fields: [meetingSessionId], references: [id], onDelete: Cascade)
  seq              Int      @default(autoincrement())
  speaker          String
  text             String
  startedMs        Int?     @map("started_ms")
  endedMs          Int?     @map("ended_ms")
  isFinal          Boolean  @default(true) @map("is_final")
  createdAt        DateTime @default(now()) @map("created_at")

  @@index([meetingSessionId, seq])
  @@map("transcript_utterances")
}
```

- [ ] **Step 2: Create the migration as SQL-only first (don't apply yet)** — this change
  drops columns (`meetings.status`, `meetings.recall_bot_id`, `meetings.join_at`, etc.)
  and needs a hand-written data migration in between, so generate the SQL without
  applying it:

Run: `cd packages/db && npx prisma migrate dev --name split_meeting_sessions --create-only`
Expected: a new migration folder is created containing `migration.sql`, and Prisma does
NOT apply it yet.

- [ ] **Step 3: Edit the generated `migration.sql` to preserve existing data** — open the
  new file at `packages/db/prisma/migrations/<timestamp>_split_meeting_sessions/migration.sql`.
  Prisma will have generated `CREATE TABLE`/`ALTER TABLE`/`DROP COLUMN` statements. Insert
  data-preservation statements so today's flattened rows survive the split. Add this block
  immediately after the new tables (`meeting_sessions`, `capture_sessions`, `recall_bots`)
  are created, but BEFORE the old columns are dropped from `meetings`:

```sql
-- Preserve existing flattened meeting data by creating one session + capture session
-- + recall bot per existing meeting row, before the old columns are dropped below.
INSERT INTO "meeting_sessions" ("id", "meeting_id", "status", "join_at", "started_at", "ended_at", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", "status", "join_at", "started_at", "ended_at", "created_at", "created_at"
FROM "meetings";

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

-- Repoint transcript_utterances at the new session before meeting_id is dropped from it.
UPDATE "transcript_utterances" tu
SET "meeting_session_id" = ms."id"
FROM "meeting_sessions" ms
WHERE ms."meeting_id" = tu."meeting_id";
```

If Prisma's generated SQL already dropped `meetings.recall_bot_id`/`status`/`join_at`/
`started_at`/`ended_at` or `transcript_utterances.meeting_id` earlier in the file than
where you pasted this block, move this block up so it runs before those `DROP COLUMN`
statements — the data must be copied out before the source columns disappear.

- [ ] **Step 4: Apply the edited migration**

Run: `cd packages/db && npx prisma migrate dev`
Expected: Prisma detects the pending `split_meeting_sessions` migration and applies it
(no new migration is created since the schema already matches). Confirm with:
`npx prisma migrate status` → `Database schema is up to date!`

- [ ] **Step 5: Spot-check the data migration**

Run: `psql "$DIRECT_URL" -c "select m.id, m.title, ms.status, rb.recall_bot_id from meetings m join meeting_sessions ms on ms.meeting_id = m.id left join capture_sessions cs on cs.meeting_session_id = ms.id left join recall_bots rb on rb.capture_session_id = cs.id order by m.created_at desc limit 5;"`
Expected: every pre-existing meeting row now has a matching `meeting_sessions` row with
the same status, and the ones that had a `recall_bot_id` now show it via the joined
`recall_bots` row.

- [ ] **Step 6: Update `packages/contracts/src/index.ts`** — widen the enum:

```ts
export const MeetingStatus = z.enum([
  "created",
  "scheduled",
  "bot_joining",
  "bot_joined",
  "recording",
  "transcribing",
  "meeting_ended",
  "processing",
  "processing_final_analysis",
  "synced_to_hubspot",
  "completed",
  "failed",
]);
export type MeetingStatus = z.infer<typeof MeetingStatus>;
```

Leave the rest of `packages/contracts/src/index.ts` unchanged — `CreateMeetingRequest`,
`MeetingSummary`, and `Utterance` shapes don't change in this task.

- [ ] **Step 7: Update `packages/db/src/index.ts`** to source `MeetingSummary` from the
  joined `Meeting` + `MeetingSession`, and alias the new colliding Prisma type:

```ts
import {
  PrismaClient,
  type Meeting as MeetingRow,
  type MeetingSession as MeetingSessionRow,
  type TranscriptUtterance as TranscriptUtteranceRow,
} from "@prisma/client";
import type { MeetingSummary, Utterance } from "@notetaker/contracts";

export { PrismaClient } from "@prisma/client";
export type {
  Meeting as MeetingRow,
  MeetingSession as MeetingSessionRow,
  TranscriptUtterance as TranscriptUtteranceRow,
} from "@prisma/client";

let cached: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!cached) cached = new PrismaClient();
  return cached;
}

export function toMeetingSummary(meeting: MeetingRow, session: MeetingSessionRow): MeetingSummary {
  return {
    id: meeting.id,
    title: meeting.title,
    meetingUrl: meeting.meetingUrl,
    status: session.status,
    createdAt: meeting.createdAt.toISOString(),
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
  };
}

export function toUtterance(row: TranscriptUtteranceRow): Utterance {
  return {
    seq: row.seq,
    speaker: row.speaker,
    text: row.text,
    startedMs: row.startedMs ?? 0,
    endedMs: row.endedMs,
    isFinal: row.isFinal,
  };
}
```

Note `toMeetingSummary` now takes two arguments — every caller in `meetings.service.ts`
must be updated to pass both (Step 8).

- [ ] **Step 8: Rewrite `apps/api/src/meetings/meetings.service.ts`**:

```ts
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { loadEnv } from "@notetaker/config";
import type { CreateMeetingRequest, MeetingSummary, Utterance } from "@notetaker/contracts";
import { getPrisma, toMeetingSummary, toUtterance } from "@notetaker/db";
import { RecallApiError, RecallClient } from "@notetaker/recall";

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);
  private readonly prisma = getPrisma();

  private recallClient(): RecallClient | undefined {
    const env = loadEnv();
    if (!env.RECALL_API_KEY) return undefined;
    return new RecallClient({ apiKey: env.RECALL_API_KEY, region: env.RECALL_REGION });
  }

  async createMeeting(input: CreateMeetingRequest): Promise<MeetingSummary> {
    const meeting = await this.prisma.meeting.create({
      data: { meetingUrl: input.meetingUrl, title: input.title },
    });
    const session = await this.prisma.meetingSession.create({
      data: {
        meetingId: meeting.id,
        joinAt: input.joinAt ? new Date(input.joinAt) : undefined,
      },
    });

    const recall = this.recallClient();
    if (!recall) {
      this.logger.warn(
        `RECALL_API_KEY not set — created meeting ${meeting.id} without starting a bot (dev mode)`,
      );
      return toMeetingSummary(meeting, session);
    }

    try {
      const env = loadEnv();
      const bot = await recall.createBot({
        meetingUrl: input.meetingUrl,
        joinAt: input.joinAt,
        transcriptWebhookUrl: `${env.APP_BASE_URL}/webhooks/recall`,
      });
      const captureSession = await this.prisma.captureSession.create({
        data: { meetingSessionId: session.id, provider: "recall", status: "created" },
      });
      await this.prisma.recallBot.create({
        data: { captureSessionId: captureSession.id, recallBotId: bot.id },
      });
      const updatedSession = await this.prisma.meetingSession.update({
        where: { id: session.id },
        data: { status: "bot_joining" },
      });
      return toMeetingSummary(meeting, updatedSession);
    } catch (err) {
      const reason = err instanceof RecallApiError ? err.message : String(err);
      this.logger.error(`Recall bot creation failed for meeting ${meeting.id}: ${reason}`);
      const failedSession = await this.prisma.meetingSession.update({
        where: { id: session.id },
        data: { status: "failed" },
      });
      return toMeetingSummary(meeting, failedSession);
    }
  }

  async listMeetings(): Promise<MeetingSummary[]> {
    const meetings = await this.prisma.meeting.findMany({
      orderBy: { createdAt: "desc" },
      include: { sessions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return meetings
      .filter((m) => m.sessions.length > 0)
      .map((m) => toMeetingSummary(m, m.sessions[0]));
  }

  async getMeeting(id: string): Promise<MeetingSummary> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id },
      include: { sessions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!meeting || meeting.sessions.length === 0) throw new NotFoundException(`Meeting ${id} not found`);
    return toMeetingSummary(meeting, meeting.sessions[0]);
  }

  async getTranscript(id: string): Promise<Utterance[]> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id },
      include: { sessions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!meeting || meeting.sessions.length === 0) throw new NotFoundException(`Meeting ${id} not found`);
    const rows = await this.prisma.transcriptUtterance.findMany({
      where: { meetingSessionId: meeting.sessions[0].id },
      orderBy: { seq: "asc" },
    });
    return rows.map(toUtterance);
  }
}
```

- [ ] **Step 9: Rewrite `apps/api/src/webhooks/webhooks.service.ts`** — the bot-id lookup
  now goes through `RecallBot` → `CaptureSession` → `MeetingSession`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import type { MeetingStatus } from "@notetaker/contracts";
import { getPrisma } from "@notetaker/db";

interface RecallWord {
  text: string;
  start_timestamp?: { relative: number } | null;
  end_timestamp?: { relative: number } | null;
}

interface RecallTranscriptDataEvent {
  event: "transcript.data";
  data: {
    bot: { id: string };
    data: {
      words: RecallWord[];
      participant: { id: number; name: string | null };
    };
  };
}

interface RecallBotStatusEvent {
  event: string;
  data: {
    bot: { id: string };
    data: { code: string; sub_code: string | null };
  };
}

/** Workspace-level bot status events → our meeting lifecycle. Anything not listed is ignored. */
const STATUS_EVENT_MAP: Record<string, MeetingStatus> = {
  "bot.joining_call": "bot_joining",
  "bot.in_waiting_room": "bot_joining",
  "bot.in_call_not_recording": "bot_joined",
  "bot.in_call_recording": "recording",
  "bot.call_ended": "meeting_ended",
  "bot.recording_done": "processing",
  "bot.done": "completed",
  "bot.fatal": "failed",
};

/** Meeting is done receiving live updates — a late/stray webhook shouldn't regress it. */
const TERMINAL_STATUSES: MeetingStatus[] = ["meeting_ended", "processing", "completed", "failed"];

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly prisma = getPrisma();

  async handleRecallEvent(payload: unknown): Promise<void> {
    if (isTranscriptDataEvent(payload)) return this.handleTranscriptData(payload);
    if (isBotStatusEvent(payload)) return this.handleBotStatus(payload);
    this.logger.warn(`Ignoring unrecognized Recall event: ${JSON.stringify(payload).slice(0, 200)}`);
  }

  private async findSessionByBotId(botId: string) {
    const recallBot = await this.prisma.recallBot.findUnique({
      where: { recallBotId: botId },
      include: { captureSession: { include: { meetingSession: true } } },
    });
    return recallBot?.captureSession.meetingSession;
  }

  private async handleTranscriptData(payload: RecallTranscriptDataEvent): Promise<void> {
    const { bot, data } = payload.data;
    const session = await this.findSessionByBotId(bot.id);
    if (!session) {
      this.logger.warn(`No meeting session found for Recall bot ${bot.id}`);
      return;
    }
    if (data.words.length === 0) return;

    const text = data.words.map((w) => w.text).join(" ");
    const startedMs = toMs(data.words[0].start_timestamp);
    const endedMs = toMs(data.words[data.words.length - 1].end_timestamp);
    const speaker = data.participant.name ?? `Participant ${data.participant.id}`;

    await this.prisma.transcriptUtterance.create({
      data: { meetingSessionId: session.id, speaker, text, startedMs, endedMs, isFinal: true },
    });

    if (!TERMINAL_STATUSES.includes(session.status as MeetingStatus)) {
      await this.prisma.meetingSession.update({ where: { id: session.id }, data: { status: "transcribing" } });
    }
  }

  private async handleBotStatus(payload: RecallBotStatusEvent): Promise<void> {
    const nextStatus = STATUS_EVENT_MAP[payload.event];
    if (!nextStatus) return;

    const session = await this.findSessionByBotId(payload.data.bot.id);
    if (!session) {
      this.logger.warn(`No meeting session found for Recall bot ${payload.data.bot.id}`);
      return;
    }
    if (TERMINAL_STATUSES.includes(session.status as MeetingStatus) && nextStatus !== "failed") return;

    await this.prisma.meetingSession.update({
      where: { id: session.id },
      data: {
        status: nextStatus,
        endedAt: nextStatus === "meeting_ended" ? new Date() : undefined,
      },
    });
  }
}

function toMs(ts?: { relative: number } | null): number | null {
  return ts ? Math.round(ts.relative * 1000) : null;
}

function isTranscriptDataEvent(payload: unknown): payload is RecallTranscriptDataEvent {
  const p = payload as RecallTranscriptDataEvent | undefined;
  return p?.event === "transcript.data" && typeof p.data?.bot?.id === "string" && Array.isArray(p.data?.data?.words);
}

function isBotStatusEvent(payload: unknown): payload is RecallBotStatusEvent {
  const p = payload as RecallBotStatusEvent | undefined;
  return (
    typeof p?.event === "string" &&
    p.event.startsWith("bot.") &&
    typeof p.data?.bot?.id === "string" &&
    typeof p.data?.data?.code === "string"
  );
}
```

- [ ] **Step 10: Update `apps/web` for the widened enum** — TypeScript will fail to build
  until `STATUS_COLORS` and `TERMINAL_STATUSES` handle the two new values. In
  `apps/web/src/app/meetings/page.tsx`, add to the `STATUS_COLORS` record:

```ts
const STATUS_COLORS: Record<MeetingSummary["status"], string> = {
  created: "#999",
  scheduled: "#999",
  bot_joining: "#b8860b",
  bot_joined: "#b8860b",
  recording: "#c00",
  transcribing: "#c00",
  meeting_ended: "#0066cc",
  processing: "#0066cc",
  processing_final_analysis: "#0066cc",
  synced_to_hubspot: "#0a8f3c",
  completed: "#0a8f3c",
  failed: "#c00",
};
```

This is the existing `apps/web/src/app/meetings/page.tsx` map with two new keys added
(`processing_final_analysis` matching `processing`'s blue, `synced_to_hubspot` matching
`completed`'s green) — every other key/value is unchanged from the current file.

In `apps/web/src/app/meetings/[id]/page.tsx`, add both new values to `TERMINAL_STATUSES`:

```ts
const TERMINAL_STATUSES: MeetingSummary["status"][] = [
  "meeting_ended",
  "processing",
  "processing_final_analysis",
  "synced_to_hubspot",
  "completed",
  "failed",
];
```

- [ ] **Step 11: Typecheck everything**

Run: `pnpm -w typecheck` (or `pnpm --filter @notetaker/api --filter @notetaker/web --filter @notetaker/db typecheck` if no root script)
Expected: no errors. If `apps/api` or `apps/web` don't have a `typecheck` script, run
`npx tsc --noEmit -p apps/api/tsconfig.json` and `npx tsc --noEmit -p apps/web/tsconfig.json` directly.

- [ ] **Step 12: Write and run the verification script**

Create `packages/db/scripts/verify-meeting-split.cjs`:

```js
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const meeting = await prisma.meeting.create({
    data: { meetingUrl: "https://meet.google.com/verify-test", title: "Verify split" },
  });
  const session = await prisma.meetingSession.create({
    data: { meetingId: meeting.id, status: "bot_joining" },
  });
  const capture = await prisma.captureSession.create({
    data: { meetingSessionId: session.id, provider: "recall", status: "created" },
  });
  await prisma.recallBot.create({
    data: { captureSessionId: capture.id, recallBotId: `verify-bot-${Date.now()}` },
  });
  await prisma.transcriptUtterance.create({
    data: { meetingSessionId: session.id, speaker: "Tester", text: "hello world" },
  });

  const fetched = await prisma.meeting.findUnique({
    where: { id: meeting.id },
    include: { sessions: { include: { captureSessions: { include: { recallBot: true } }, utterances: true } } },
  });
  const s = fetched.sessions[0];
  if (s.captureSessions[0].recallBot === null || s.utterances.length !== 1) {
    throw new Error("Meeting split round-trip failed");
  }
  console.log("OK: meeting/session/capture/recallBot/transcript round-trip");

  await prisma.transcriptUtterance.deleteMany({ where: { meetingSessionId: session.id } });
  await prisma.recallBot.deleteMany({ where: { captureSessionId: capture.id } });
  await prisma.captureSession.delete({ where: { id: capture.id } });
  await prisma.meetingSession.delete({ where: { id: session.id } });
  await prisma.meeting.delete({ where: { id: meeting.id } });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run: `cd packages/db && npx prisma generate && node scripts/verify-meeting-split.cjs`
Expected: `OK: meeting/session/capture/recallBot/transcript round-trip`

- [ ] **Step 13: Delete the script and commit**

```bash
rm packages/db/scripts/verify-meeting-split.cjs
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations \
  packages/db/src/index.ts packages/contracts/src/index.ts \
  apps/api/src/meetings/meetings.service.ts apps/api/src/webhooks/webhooks.service.ts \
  apps/web/src/app/meetings/page.tsx apps/web/src/app/meetings/[id]/page.tsx
git commit -m "feat(db): split Meeting into Meeting + MeetingSession, widen MeetingStatus"
```

- [ ] **Step 14: Deploy immediately** (per Global Constraints — minimize drift window)

Follow whatever this repo's normal path to Railway is (push to the branch backing the
`api`/`web` services, or `railway up`/`railway redeploy` on the linked services). Then
run the same live-call smoke test used to verify the earlier webhook fixes: create a
meeting via `POST /meetings`, join the Meet link, confirm status reaches `transcribing`
and `GET /meetings/:id/transcript` returns real text.

---

### Task 4: Transcript detail (Participant, TranscriptWord, TranscriptRawEvent)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Test: `packages/db/scripts/verify-transcript-detail.cjs` (throwaway)

**Interfaces:**
- Consumes: `MeetingSession`, `CaptureSession`, `TranscriptUtterance` (Task 3).
- Produces: `Participant`, `TranscriptWord`, `TranscriptRawEvent` models. Nothing later in
  this plan depends on these — they're additive and unused by app code until M4/M5.

- [ ] **Step 1: Add the models to `schema.prisma`**

```prisma
model Participant {
  id               String   @id @default(uuid())
  meetingSessionId String   @map("meeting_session_id")
  meetingSession   MeetingSession @relation(fields: [meetingSessionId], references: [id], onDelete: Cascade)
  name             String?
  email            String?
  isHost           Boolean  @default(false) @map("is_host")
  createdAt        DateTime @default(now()) @map("created_at")

  @@map("participants")
}

model TranscriptWord {
  id          String   @id @default(uuid())
  utteranceId String   @map("utterance_id")
  utterance   TranscriptUtterance @relation(fields: [utteranceId], references: [id], onDelete: Cascade)
  word        String
  startedMs   Int?     @map("started_ms")
  endedMs     Int?     @map("ended_ms")
  confidence  Float?

  @@map("transcript_words")
}

model TranscriptRawEvent {
  id               String   @id @default(uuid())
  captureSessionId String?  @map("capture_session_id")
  captureSession   CaptureSession? @relation(fields: [captureSessionId], references: [id], onDelete: Cascade)
  provider         String
  eventType        String   @map("event_type")
  payload          Json
  receivedAt       DateTime @default(now()) @map("received_at")

  @@map("transcript_raw_events")
}
```

Also add the back-relations these introduce on existing models — in `MeetingSession` add
`participants Participant[]`, in `TranscriptUtterance` add `words TranscriptWord[]`, in
`CaptureSession` add `rawEvents TranscriptRawEvent[]`.

- [ ] **Step 2: Create and apply the migration**

Run: `cd packages/db && npx prisma migrate dev --name add_transcript_detail_models`
Expected: `Your database is now in sync with your schema.`

- [ ] **Step 3: Write the verification script**

Create `packages/db/scripts/verify-transcript-detail.cjs`:

```js
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const meeting = await prisma.meeting.create({ data: { meetingUrl: "https://meet.google.com/verify-4" } });
  const session = await prisma.meetingSession.create({ data: { meetingId: meeting.id } });
  const capture = await prisma.captureSession.create({
    data: { meetingSessionId: session.id, provider: "recall", status: "created" },
  });
  const participant = await prisma.participant.create({
    data: { meetingSessionId: session.id, name: "Verify Participant", isHost: true },
  });
  const utterance = await prisma.transcriptUtterance.create({
    data: { meetingSessionId: session.id, speaker: "Verify Participant", text: "hello" },
  });
  await prisma.transcriptWord.create({
    data: { utteranceId: utterance.id, word: "hello", startedMs: 0, endedMs: 400, confidence: 0.98 },
  });
  await prisma.transcriptRawEvent.create({
    data: { captureSessionId: capture.id, provider: "recall", eventType: "transcript.data", payload: { raw: true } },
  });

  const words = await prisma.transcriptWord.findMany({ where: { utteranceId: utterance.id } });
  const rawEvents = await prisma.transcriptRawEvent.findMany({ where: { captureSessionId: capture.id } });
  if (words.length !== 1 || rawEvents.length !== 1 || participant.isHost !== true) {
    throw new Error("Transcript detail round-trip failed");
  }
  console.log("OK: participant/transcriptWord/transcriptRawEvent round-trip");

  await prisma.transcriptWord.deleteMany({ where: { utteranceId: utterance.id } });
  await prisma.transcriptRawEvent.deleteMany({ where: { captureSessionId: capture.id } });
  await prisma.transcriptUtterance.delete({ where: { id: utterance.id } });
  await prisma.participant.delete({ where: { id: participant.id } });
  await prisma.captureSession.delete({ where: { id: capture.id } });
  await prisma.meetingSession.delete({ where: { id: session.id } });
  await prisma.meeting.delete({ where: { id: meeting.id } });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Run it**

Run: `cd packages/db && npx prisma generate && node scripts/verify-transcript-detail.cjs`
Expected: `OK: participant/transcriptWord/transcriptRawEvent round-trip`

- [ ] **Step 5: Delete the script and commit**

```bash
rm packages/db/scripts/verify-transcript-detail.cjs
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Participant, TranscriptWord, TranscriptRawEvent models"
```

---

### Task 5: Segment detection state (MeetingSegmentState, SegmentEvidence, ManualOverride)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Test: `packages/db/scripts/verify-segment-state.cjs` (throwaway)

**Interfaces:**
- Consumes: `MeetingSession` (Task 3), `PlaybookSegment` (Task 2), `User` (Task 1).
- Produces: `MeetingSegmentState`, `SegmentEvidence`, `ManualOverride`, and a new
  `SegmentStatus` enum. Nothing later in this plan depends on these.

- [ ] **Step 1: Add the enum and models to `schema.prisma`**

```prisma
enum SegmentStatus {
  not_started
  detected_in_progress
  completed_ai
  completed_manual
  marked_not_applicable
  rejected_low_confidence
  missed
}

model MeetingSegmentState {
  id                String        @id @default(uuid())
  meetingSessionId  String        @map("meeting_session_id")
  meetingSession    MeetingSession @relation(fields: [meetingSessionId], references: [id], onDelete: Cascade)
  playbookSegmentId String        @map("playbook_segment_id")
  playbookSegment   PlaybookSegment @relation(fields: [playbookSegmentId], references: [id])
  status            SegmentStatus @default(not_started)
  confidence        Float?
  detectedAt        DateTime?     @map("detected_at")
  speaker           String?

  evidence  SegmentEvidence[]
  overrides ManualOverride[]

  @@map("meeting_segment_states")
}

model SegmentEvidence {
  id                    String   @id @default(uuid())
  meetingSegmentStateId String   @map("meeting_segment_state_id")
  meetingSegmentState   MeetingSegmentState @relation(fields: [meetingSegmentStateId], references: [id], onDelete: Cascade)
  utteranceId           String?  @map("utterance_id")
  snippet               String
  reasonText            String?  @map("reason_text")
  createdAt             DateTime @default(now()) @map("created_at")

  @@map("segment_evidence")
}

model ManualOverride {
  id                    String        @id @default(uuid())
  meetingSegmentStateId String        @map("meeting_segment_state_id")
  meetingSegmentState   MeetingSegmentState @relation(fields: [meetingSegmentStateId], references: [id], onDelete: Cascade)
  userId                String?       @map("user_id")
  user                  User?         @relation(fields: [userId], references: [id])
  previousStatus        SegmentStatus @map("previous_status")
  newStatus             SegmentStatus @map("new_status")
  note                  String?
  createdAt             DateTime      @default(now()) @map("created_at")

  @@map("manual_overrides")
}
```

Also add back-relations: on `MeetingSession` add `segmentStates MeetingSegmentState[]`, on
`PlaybookSegment` add `states MeetingSegmentState[]`, on `User` add
`manualOverrides ManualOverride[]`.

- [ ] **Step 2: Create and apply the migration**

Run: `cd packages/db && npx prisma migrate dev --name add_segment_state_models`
Expected: `Your database is now in sync with your schema.`

- [ ] **Step 3: Write the verification script**

Create `packages/db/scripts/verify-segment-state.cjs`:

```js
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const org = await prisma.organization.create({ data: { name: "Verify Org 5" } });
  const user = await prisma.user.create({ data: { orgId: org.id, email: `verify5-${Date.now()}@example.com` } });
  const playbook = await prisma.playbook.create({ data: { orgId: org.id, name: "Verify Playbook" } });
  const segment = await prisma.playbookSegment.create({
    data: { playbookId: playbook.id, name: "Pricing", order: 1 },
  });
  const meeting = await prisma.meeting.create({ data: { meetingUrl: "https://meet.google.com/verify-5" } });
  const session = await prisma.meetingSession.create({ data: { meetingId: meeting.id } });

  const state = await prisma.meetingSegmentState.create({
    data: { meetingSessionId: session.id, playbookSegmentId: segment.id, status: "detected_in_progress", confidence: 0.6 },
  });
  await prisma.segmentEvidence.create({
    data: { meetingSegmentStateId: state.id, snippet: "let's talk pricing", reasonText: "keyword match" },
  });
  await prisma.manualOverride.create({
    data: { meetingSegmentStateId: state.id, userId: user.id, previousStatus: "detected_in_progress", newStatus: "completed_manual" },
  });

  const fetched = await prisma.meetingSegmentState.findUnique({
    where: { id: state.id },
    include: { evidence: true, overrides: true },
  });
  if (fetched.evidence.length !== 1 || fetched.overrides.length !== 1) {
    throw new Error("Segment state round-trip failed");
  }
  console.log("OK: meetingSegmentState/segmentEvidence/manualOverride round-trip");

  await prisma.manualOverride.deleteMany({ where: { meetingSegmentStateId: state.id } });
  await prisma.segmentEvidence.deleteMany({ where: { meetingSegmentStateId: state.id } });
  await prisma.meetingSegmentState.delete({ where: { id: state.id } });
  await prisma.meetingSession.delete({ where: { id: session.id } });
  await prisma.meeting.delete({ where: { id: meeting.id } });
  await prisma.playbookSegment.delete({ where: { id: segment.id } });
  await prisma.playbook.delete({ where: { id: playbook.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Run it**

Run: `cd packages/db && npx prisma generate && node scripts/verify-segment-state.cjs`
Expected: `OK: meetingSegmentState/segmentEvidence/manualOverride round-trip`

- [ ] **Step 5: Delete the script and commit**

```bash
rm packages/db/scripts/verify-segment-state.cjs
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add MeetingSegmentState, SegmentEvidence, ManualOverride models"
```

---

### Task 6: Analysis & sync (MeetingSummary, MeetingAnalysis, HubspotSyncJob, ExternalCrmMapping, WebhookEvent, AuditLog)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Test: `packages/db/scripts/verify-analysis-sync.cjs` (throwaway)

**Interfaces:**
- Consumes: `MeetingSession` (Task 3), `Meeting` (Task 3), `Organization`/`User` (Task 1).
- Produces: `MeetingSummary` (Prisma model — collides by name with `@notetaker/contracts`'
  `MeetingSummary` zod type; nothing in this plan imports both in the same file, so no
  alias is needed yet, but note this for whoever writes M9's HubSpot sync code), plus
  `MeetingAnalysis`, `HubspotSyncJob`, `ExternalCrmMapping`, `WebhookEvent`, `AuditLog`.
  This is the last schema task in this plan — nothing later depends on these.

- [ ] **Step 1: Add the models to `schema.prisma`**

```prisma
model MeetingSummary {
  id               String   @id @default(uuid())
  meetingSessionId String   @map("meeting_session_id")
  meetingSession   MeetingSession @relation(fields: [meetingSessionId], references: [id], onDelete: Cascade)
  summaryText      String   @map("summary_text")
  actionItems      Json?    @map("action_items")
  createdAt        DateTime @default(now()) @map("created_at")

  @@map("meeting_summaries")
}

model MeetingAnalysis {
  id                        String   @id @default(uuid())
  meetingSessionId          String   @unique @map("meeting_session_id")
  meetingSession            MeetingSession @relation(fields: [meetingSessionId], references: [id], onDelete: Cascade)
  score                     Float?
  requiredSegmentsCompleted Int      @default(0) @map("required_segments_completed")
  missingSegments           Json?    @map("missing_segments")
  pilotPitched              Boolean  @default(false) @map("pilot_pitched")
  pricingDiscussed          Boolean  @default(false) @map("pricing_discussed")
  nextStepConfirmed         Boolean  @default(false) @map("next_step_confirmed")
  createdAt                 DateTime @default(now()) @map("created_at")

  @@map("meeting_analysis")
}

model HubspotSyncJob {
  id                String   @id @default(uuid())
  meetingSessionId  String   @map("meeting_session_id")
  meetingSession    MeetingSession @relation(fields: [meetingSessionId], references: [id], onDelete: Cascade)
  status            String
  attemptCount      Int      @default(0) @map("attempt_count")
  lastError         String?  @map("last_error")
  hubspotObjectType String?  @map("hubspot_object_type")
  hubspotObjectId   String?  @map("hubspot_object_id")
  createdAt         DateTime @default(now()) @map("created_at")

  @@map("hubspot_sync_jobs")
}

model ExternalCrmMapping {
  id                String   @id @default(uuid())
  meetingId         String   @map("meeting_id")
  meeting           Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  hubspotDealId     String?  @map("hubspot_deal_id")
  hubspotContactId  String?  @map("hubspot_contact_id")
  hubspotCompanyId  String?  @map("hubspot_company_id")
  matchedVia        String?  @map("matched_via")
  createdAt         DateTime @default(now()) @map("created_at")

  @@map("external_crm_mappings")
}

model WebhookEvent {
  id             String    @id @default(uuid())
  provider       String
  eventType      String    @map("event_type")
  signatureValid Boolean   @map("signature_valid")
  payload        Json
  processedAt    DateTime? @map("processed_at")
  createdAt      DateTime  @default(now()) @map("created_at")

  @@map("webhook_events")
}

model AuditLog {
  id          String   @id @default(uuid())
  orgId       String?  @map("org_id")
  actorUserId String?  @map("actor_user_id")
  actor       User?    @relation(fields: [actorUserId], references: [id])
  action      String
  targetType  String   @map("target_type")
  targetId    String   @map("target_id")
  metadata    Json?
  createdAt   DateTime @default(now()) @map("created_at")

  @@map("audit_logs")
}
```

Also add back-relations: on `MeetingSession` add `summaries MeetingSummary[]`,
`analysis MeetingAnalysis?`, `hubspotSyncJobs HubspotSyncJob[]`; on `Meeting` add
`externalCrmMappings ExternalCrmMapping[]`; on `User` add `auditLogs AuditLog[]`.

- [ ] **Step 2: Create and apply the migration**

Run: `cd packages/db && npx prisma migrate dev --name add_analysis_sync_models`
Expected: `Your database is now in sync with your schema.`

- [ ] **Step 3: Write the verification script**

Create `packages/db/scripts/verify-analysis-sync.cjs`:

```js
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const meeting = await prisma.meeting.create({ data: { meetingUrl: "https://meet.google.com/verify-6" } });
  const session = await prisma.meetingSession.create({ data: { meetingId: meeting.id, status: "completed" } });

  await prisma.meetingSummary.create({
    data: { meetingSessionId: session.id, summaryText: "Verify summary", actionItems: [{ text: "follow up" }] },
  });
  await prisma.meetingAnalysis.create({
    data: { meetingSessionId: session.id, score: 0.8, requiredSegmentsCompleted: 3, pricingDiscussed: true },
  });
  const syncJob = await prisma.hubspotSyncJob.create({
    data: { meetingSessionId: session.id, status: "pending" },
  });
  await prisma.externalCrmMapping.create({
    data: { meetingId: meeting.id, hubspotDealId: "deal-123", matchedVia: "email" },
  });
  await prisma.webhookEvent.create({
    data: { provider: "recall", eventType: "bot.done", signatureValid: true, payload: { ok: true } },
  });
  const org = await prisma.organization.create({ data: { name: "Verify Org 6" } });
  const user = await prisma.user.create({ data: { orgId: org.id, email: `verify6-${Date.now()}@example.com` } });
  await prisma.auditLog.create({
    data: { orgId: org.id, actorUserId: user.id, action: "sync.retry", targetType: "hubspot_sync_job", targetId: syncJob.id },
  });

  const analysis = await prisma.meetingAnalysis.findUnique({ where: { meetingSessionId: session.id } });
  const mapping = await prisma.externalCrmMapping.findMany({ where: { meetingId: meeting.id } });
  if (!analysis || analysis.pricingDiscussed !== true || mapping.length !== 1) {
    throw new Error("Analysis/sync round-trip failed");
  }
  console.log("OK: meetingSummary/meetingAnalysis/hubspotSyncJob/externalCrmMapping/webhookEvent/auditLog round-trip");

  await prisma.auditLog.deleteMany({ where: { orgId: org.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.webhookEvent.deleteMany({ where: { eventType: "bot.done" } });
  await prisma.externalCrmMapping.deleteMany({ where: { meetingId: meeting.id } });
  await prisma.hubspotSyncJob.delete({ where: { id: syncJob.id } });
  await prisma.meetingAnalysis.delete({ where: { meetingSessionId: session.id } });
  await prisma.meetingSummary.deleteMany({ where: { meetingSessionId: session.id } });
  await prisma.meetingSession.delete({ where: { id: session.id } });
  await prisma.meeting.delete({ where: { id: meeting.id } });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Run it**

Run: `cd packages/db && npx prisma generate && node scripts/verify-analysis-sync.cjs`
Expected: `OK: meetingSummary/meetingAnalysis/hubspotSyncJob/externalCrmMapping/webhookEvent/auditLog round-trip`

- [ ] **Step 5: Delete the script and commit**

```bash
rm packages/db/scripts/verify-analysis-sync.cjs
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add MeetingSummary, MeetingAnalysis, HubspotSyncJob, ExternalCrmMapping, WebhookEvent, AuditLog models"
```

---

### Task 7: Deploy, live smoke test, and update Orchestration.md

**Files:**
- Modify: `docs/architecture/Orchestration.md`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: nothing new — this is the closing verification + documentation task.

- [ ] **Step 1: Confirm the full migration history is applied cleanly**

Run: `cd packages/db && npx prisma migrate status`
Expected: `Database schema is up to date!`

- [ ] **Step 2: Deploy `apps/api` and `apps/web`** to Railway (whatever this repo's normal
  push/deploy path is — Task 3 Step 14 already did this for the breaking change; this step
  confirms the final state, including Tasks 4–6's purely-additive migrations, is live).

- [ ] **Step 3: Run a full live smoke test**, mirroring the test done for the webhook
  fixes: `curl -X POST https://notetakerapi-production.up.railway.app/meetings -d '{"meetingUrl":"<a real Meet link you join>"}'`, join the call, confirm status reaches
  `transcribing` via `GET /meetings/:id`, and confirm `GET /meetings/:id/transcript`
  returns real captured speech.

- [ ] **Step 4: Update `docs/architecture/Orchestration.md`**

In §17's Build Roadmap table, change:
```
| M3 — Full data model | Migrate to the schema in §6 (orgs, users, playbooks, segments, sync jobs, etc.) | ⬜ Not started |
```
to:
```
| M3 — Full data model | Migrate to the schema in §6 (orgs, users, playbooks, segments, sync jobs, etc.) | ✅ Done |
```

Also update the "We are past M2, at the start of M3" line below the table to say
"We are past M3, at the start of M4," and update §6's per-entity `Status` column
(currently all `⬜`) to `✅` for every entity now migrated.

- [ ] **Step 5: Commit the doc update**

```bash
git add docs/architecture/Orchestration.md
git commit -m "docs: mark M3 (full data model) complete"
git push
```
