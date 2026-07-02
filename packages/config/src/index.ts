import "dotenv/config";
import { z } from "zod";

/**
 * Environment schema. Fails fast at boot with a readable message when
 * something required is missing. Phase-gated vars are optional for now
 * and validated at the call site that needs them.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  APP_BASE_URL: z.string().url().default("http://localhost:4000"),

  // Recall.ai (required from Phase 1 spike onward)
  RECALL_API_KEY: z.string().optional(),
  RECALL_REGION: z.string().default("us-west-2"),
  RECALL_WEBHOOK_SECRET: z.string().optional(),

  // Phase 2+
  DATABASE_URL: z.string().default("postgres://localhost:5432/notetaker"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Phase 4
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_DRIVE_FOLDER_ID: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = loadEnv()[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${String(key)}`);
  }
  return value as NonNullable<Env[K]>;
}
