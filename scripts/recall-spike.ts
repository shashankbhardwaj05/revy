/**
 * Phase 1 spike: prove the Recall.ai account works end-to-end BEFORE building on it.
 *
 * What it does:
 *   1. Creates a bot for the given meeting URL (record + transcribe)
 *   2. Polls bot status every 10s, printing transitions
 *   3. When the call ends, dumps the final raw bot object to scripts/fixtures/
 *      — that raw payload becomes our "practice tape" for building Phases 2–4.
 *
 * Usage:
 *   RECALL_API_KEY=xxx MEETING_URL=https://meet.google.com/abc-defg-hij pnpm recall:spike
 *
 * ⚠️ Before the FIRST run: verify the request contract in packages/recall/src/index.ts
 *    against https://docs.recall.ai (marked with VERIFY comments).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Import from source so the spike runs without a build step
import { RecallClient } from "../packages/recall/src/index";

const apiKey = process.env.RECALL_API_KEY;
const meetingUrl = process.env.MEETING_URL;
const region = process.env.RECALL_REGION ?? "us-west-2";

if (!apiKey || !meetingUrl) {
  console.error(
    "Usage: RECALL_API_KEY=xxx MEETING_URL=https://meet.google.com/... pnpm recall:spike",
  );
  process.exit(1);
}

const fixturesDir = join(__dirname, "fixtures");
mkdirSync(fixturesDir, { recursive: true });

function dump(name: string, data: unknown) {
  const file = join(fixturesDir, `${name}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`  💾 saved ${file}`);
}

async function main() {
  const recall = new RecallClient({ apiKey: apiKey!, region });

  console.log(`\n🤖 Creating bot for ${meetingUrl} (region: ${region})...`);
  const bot = await recall.createBot({ meetingUrl: meetingUrl! });
  console.log(`✅ Bot created: ${bot.id}`);
  dump("bot-created", bot);

  console.log("\n👀 Polling status every 10s — admit the bot when it knocks!");
  console.log("   (Ctrl+C to stop; the bot keeps running server-side)\n");

  let lastStatus = "";
  // Poll until the bot reaches a terminal state
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const current = await recall.getBot(bot.id);
    const statusChanges = (current.status_changes ?? []) as Array<{
      code?: string;
      created_at?: string;
    }>;
    const latest = statusChanges.at(-1)?.code ?? "unknown";
    if (latest !== lastStatus) {
      console.log(`  📡 ${new Date().toLocaleTimeString()} status: ${latest}`);
      lastStatus = latest;
    }
    if (["done", "fatal", "call_ended"].includes(latest)) {
      console.log("\n🏁 Bot finished. Dumping final payload...");
      dump("bot-final", current);
      console.log(
        "\nNext: inspect the fixture file — it shows exactly what data Recall gives us",
      );
      break;
    }
  }
}

main().catch((err) => {
  console.error("\n❌ Spike failed:", err.message ?? err);
  console.error(
    "If this is a 401/403 → check RECALL_API_KEY and RECALL_REGION.\n" +
      "If 400 → the request contract needs updating against docs.recall.ai " +
      "(see VERIFY comments in packages/recall/src/index.ts).",
  );
  process.exit(1);
});
