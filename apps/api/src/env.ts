import { z } from 'zod';

export interface Env {
  port: number;
  /** Postgres connection string. When undefined, PGlite is used (PGLITE_DIR, or in-memory). */
  databaseUrl: string | undefined;
  pgliteDir: string | undefined;
  demoMode: boolean;
  riotApiKey: string | undefined;
  rsoClientId: string | undefined;
  rsoClientSecret: string | undefined;
  rsoRedirectUri: string | undefined;
  /** Web origin (no trailing slash). Used for share URLs and post-RSO redirects. */
  publicBaseUrl: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  rawRetentionDays: number;
  /** 0 = scheduler off */
  syncIntervalMinutes: number;
  /** General per-IP request budget per minute. */
  rateLimitPerMinute: number;
  /** Budget for POST /sync and POST /riot/connect per minute. */
  rateLimitSensitivePerMinute: number;
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

const blankToUndef = (v: unknown): unknown => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optStr = z.preprocess(blankToUndef, z.string().optional());
const optInt = (def: number, min: number, max: number) =>
  z.preprocess(blankToUndef, z.coerce.number().int().min(min).max(max).default(def));
const optBool = z.preprocess((v) => {
  const b = blankToUndef(v);
  if (typeof b !== 'string') return b;
  const s = b.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(s)) return true;
  if (['false', '0', 'no'].includes(s)) return false;
  return b;
}, z.boolean().optional());

const schema = z.object({
  PORT: optInt(3000, 1, 65535),
  DATABASE_URL: optStr,
  PGLITE_DIR: optStr,
  DEMO_MODE: optBool,
  RIOT_API_KEY: optStr,
  RSO_CLIENT_ID: optStr,
  RSO_CLIENT_SECRET: optStr,
  RSO_REDIRECT_URI: optStr,
  PUBLIC_BASE_URL: z.preprocess(blankToUndef, z.string().url().default('http://localhost:5173')),
  SESSION_TTL_HOURS: optInt(168, 1, 24 * 365),
  COOKIE_SECURE: optBool,
  RAW_RETENTION_DAYS: optInt(30, 1, 3650),
  SYNC_INTERVAL_MINUTES: optInt(0, 0, 24 * 60),
  RATE_LIMIT_PER_MINUTE: optInt(120, 1, 100_000),
  RATE_LIMIT_SENSITIVE_PER_MINUTE: optInt(6, 1, 100_000),
});

/** Parse and validate configuration. Throws EnvError with a clear message; never echoes secret values. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`).join('; ');
    throw new EnvError(`Invalid configuration: ${problems}`);
  }
  const e = parsed.data;
  const demoMode = e.DEMO_MODE ?? e.RIOT_API_KEY === undefined;
  if (source.NODE_ENV === 'production' && e.DEMO_MODE === undefined) {
    throw new EnvError('NODE_ENV=production requires DEMO_MODE to be set explicitly (false for live Riot access).');
  }
  if (!demoMode) {
    const missing = (
      [
        ['RIOT_API_KEY', e.RIOT_API_KEY],
        ['RSO_CLIENT_ID', e.RSO_CLIENT_ID],
        ['RSO_CLIENT_SECRET', e.RSO_CLIENT_SECRET],
        ['RSO_REDIRECT_URI', e.RSO_REDIRECT_URI],
      ] as const
    )
      .filter(([, v]) => v === undefined)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new EnvError(
        `DEMO_MODE is off, so these variables are required: ${missing.join(', ')}. Set them, or set DEMO_MODE=true to run on fixtures.`,
      );
    }
  }
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR,
    demoMode,
    riotApiKey: e.RIOT_API_KEY,
    rsoClientId: e.RSO_CLIENT_ID,
    rsoClientSecret: e.RSO_CLIENT_SECRET,
    rsoRedirectUri: e.RSO_REDIRECT_URI,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    sessionTtlHours: e.SESSION_TTL_HOURS,
    cookieSecure: e.COOKIE_SECURE ?? !demoMode,
    rawRetentionDays: e.RAW_RETENTION_DAYS,
    syncIntervalMinutes: e.SYNC_INTERVAL_MINUTES,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    rateLimitSensitivePerMinute: e.RATE_LIMIT_SENSITIVE_PER_MINUTE,
  };
}
