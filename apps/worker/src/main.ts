import { loadEnv } from "@notetaker/config";

/**
 * Background worker. Phase 3 wires BullMQ processors here
 * (transcript ingestion, finalization, summary). For now it just boots,
 * proving the process + config plumbing works.
 */
async function main() {
  const env = loadEnv();
  // eslint-disable-next-line no-console
  console.log(`[worker] booted (env=${env.NODE_ENV}) — processors arrive in Phase 3`);

  const shutdown = (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[worker] ${signal} received, shutting down`);
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Keep the process alive
  await new Promise(() => {});
}

void main();
