import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_ISSUER: z.string().optional(),
  JWT_AUDIENCE: z.string().optional(),
  VAPI_WEBHOOK_SECRET: z.string().min(1, 'VAPI_WEBHOOK_SECRET is required'),
  // ── Voice retry worker ──────────────────────────────────────────────────────
  VOICE_RETRY_ENABLED:      z.coerce.boolean().default(false),
  VOICE_RETRY_INTERVAL_MS:  z.coerce.number().int().min(1000).default(60_000),
  VOICE_RETRY_BATCH_SIZE:   z.coerce.number().int().min(1).max(100).default(10),
  VOICE_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
  // ── n8n forwarding ─────────────────────────────────────────────────────────
  N8N_BASE_URL: z.string().url('N8N_BASE_URL must be a valid URL'),
  N8N_WEBHOOK_SECRET: z.string().optional(),
  FORWARD_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(overrides?: NodeJS.ProcessEnv): Config {
  const result = schema.safeParse(overrides ?? process.env);
  if (!result.success) {
    const messages = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Configuration error:\n${messages}`);
  }
  return result.data;
}
