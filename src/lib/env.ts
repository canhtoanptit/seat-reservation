import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),

  SESSION_COOKIE_NAME: z.string().min(1).default("seat_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(90),

  HOLD_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  PAYING_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),

  MOCK_PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  MOCK_PAYMENT_BASE_URL: z.string().url(),
  // Gates the in-repo mock payment provider routes (see ADR 0006). Decoupled
  // from NODE_ENV so we can run the production-built image with the mock
  // mounted for demo, or run dev with the mock off if we ever swap in real
  // Stripe. Accepts "true"/"false" (case-insensitive).
  MOCK_PAYMENT_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .default("true")
    .transform((s) => s === "true"),

  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Boot loudly. Better to crash now than serve broken state.
  console.error(
    "Invalid environment variables:\n",
    z.prettifyError(parsed.error),
  );
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
export type Env = typeof env;
