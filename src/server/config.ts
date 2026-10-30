// Server configuration — validated once at startup. See .env.example for every variable.
import { z } from "zod";

// z.coerce.boolean() treats any non-empty string (including "false") as true
const envBoolean = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3010),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Externally reachable origin of this app — used for links inside emails (unsubscribe, invites)
  PUBLIC_URL: z
    .string()
    .trim()
    .transform((val) => val.replace(/\/+$/, ""))
    .pipe(z.string().url())
    .default(
      process.env.PUBLIC_URL
        ? process.env.PUBLIC_URL.trim().replace(/\/+$/, "")
        : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL.trim().replace(/\/+$/, "")}`
        : process.env.VERCEL
        ? "https://fr-mailer.vercel.app"
        : "https://fr-mailer.vercel.app"
    ),
  // Signs unsubscribe links. Generate with: openssl rand -hex 32
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),

  // SpaceMail SMTP — optional so the app runs without it; sending is then disabled with a clear reason
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: envBoolean.default("true"), // true for 465 (implicit TLS), false for 587 (STARTTLS)
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_FROM_EMAIL: z.string().email().optional(),
  SMTP_FROM_NAME: z.string().default("FocusRealm"),

  // Safety lock: approved campaigns cannot start sending unless this is true
  ALLOW_LIVE_SENDING: envBoolean.default("false"),
  // Mailbox-wide cap on messages sent in any rolling 24 hours
  DAILY_SEND_LIMIT: z.coerce.number().int().positive().default(300),

  // SpaceMail IMAP — bounce and reply detection (read-only)
  IMAP_HOST: optionalString,
  IMAP_PORT: z.coerce.number().int().positive().default(993),
  IMAP_USER: optionalString,
  IMAP_PASS: optionalString,
  IMAP_POLL_ENABLED: envBoolean.default("false"),
  IMAP_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(120),

  // Serverless (Vercel): authorizes /api/internal/tick, the endpoint that runs sending bursts.
  // Vercel Cron sends it as "Authorization: Bearer <CRON_SECRET>". Generate with: openssl rand -hex 32
  CRON_SECRET: optionalString,

  // Optional: Google Gemini drafts templates from a brief. Only the brief, an optional example email and
  // merge-field names are sent — never contact data. Get a key at https://aistudio.google.com/apikey
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().regex(/^[a-z0-9.-]+$/, "GEMINI_MODEL must be a model id like gemini-1.5-flash").default("gemini-1.5-flash"),
  /** Override only for a proxy or a local test double */
  GEMINI_BASE_URL: z.string().url().default("https://generativelanguage.googleapis.com"),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const messages = Object.entries(result.error.flatten().fieldErrors)
      .map(([field, errs]) => `  ${field}: ${errs?.join(", ")}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${messages}`);
  }
  return result.data;
}

export const env = loadEnv();

/** Running as Vercel functions: no long-lived worker; sending happens in bounded bursts */
export const isServerless = Boolean(process.env.VERCEL);

export const smtpConfigured =Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM_EMAIL);
export const imapConfigured = Boolean(env.IMAP_HOST && env.IMAP_USER && env.IMAP_PASS);
export const aiConfigured = Boolean(env.GEMINI_API_KEY);

/** Why live sending is unavailable, or null if it is available */
export function liveSendingBlocker(): string | null {
  if (!smtpConfigured) return "The sending mailbox isn't configured on the server.";
  if (!env.ALLOW_LIVE_SENDING) return "Live sending is switched off on this server (ALLOW_LIVE_SENDING).";
  return null;
}
