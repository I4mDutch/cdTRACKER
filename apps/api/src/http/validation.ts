import { z } from 'zod';
import { MANUAL_LIMITS, MANUAL_QUEUES, type ManualMatchInput, type MatchFilter, type ShareField } from '@va/shared';
import { HttpError } from './errors.js';

const blank = (v: unknown): unknown => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optStr = z.preprocess(blank, z.string().max(200).optional());
const optDate = z.preprocess(
  blank,
  z
    .string()
    .max(64)
    .refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO date')
    .optional(),
);

export const filterSchema = z.object({
  agentId: optStr,
  mapId: optStr,
  queueId: optStr,
  patch: optStr,
  from: optDate,
  to: optDate,
  lastN: z.preprocess(blank, z.coerce.number().int().min(1).max(10_000).optional()),
  source: z.preprocess(blank, z.enum(['riot', 'manual']).optional()),
});

export const paginationSchema = z.object({
  page: z.preprocess(blank, z.coerce.number().int().min(1).max(1_000_000).default(1)),
  pageSize: z.preprocess(blank, z.coerce.number().int().min(1).max(100).default(20)),
});

export const SHARE_FIELDS = ['winRate', 'kd', 'topAgents', 'topMaps', 'matchCount'] as const satisfies readonly ShareField[];

export const createShareSchema = z.object({
  fields: z.array(z.enum(SHARE_FIELDS)).min(1).max(SHARE_FIELDS.length),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export const feedbackSchema = z.object({
  findingId: z.string().min(1).max(300),
  action: z.enum(['dismiss', 'not_useful', 'useful']),
});

export const connectSchema = z.object({ consent: z.literal(true) });

export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
    throw new HttpError(400, 'validation', `Invalid request. ${where}${first?.message ?? 'Check your input.'}`);
  }
  return r.data;
}

/** queueId defaults to "competitive"; "all" means no queue filter. */
export function parseFilter(query: unknown): MatchFilter {
  const f = parse(filterSchema, query);
  const out: MatchFilter = {};
  if (f.agentId) out.agentId = f.agentId;
  if (f.mapId) out.mapId = f.mapId;
  if (f.patch) out.patch = f.patch;
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  if (f.lastN !== undefined) out.lastN = f.lastN;
  if (f.source) out.source = f.source;
  const q = f.queueId ?? 'competitive';
  if (q !== 'all') out.queueId = q;
  return out;
}

// ---------- manual entry ----------
const L = MANUAL_LIMITS;
const nullish = (v: unknown): unknown => (v === null || v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v);

const whole = (max: number) => {
  const msg = `must be a whole number between 0 and ${max}`;
  return z.number({ invalid_type_error: msg, required_error: 'is required' }).int(msg).min(0, msg).max(max, msg);
};
const optWhole = (max: number) => z.preprocess(nullish, whole(max).nullable());
const optAvg = (max: number, label: string) => {
  const msg = `must be a number between 0 and ${max}`;
  return z.preprocess(nullish, z.number({ invalid_type_error: msg }).finite(msg).min(0, msg).max(max, msg).nullable()).describe(label);
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/i;
const DATE_FORMAT_MSG = 'must be a date like 2025-03-14 or a full ISO 8601 date-time';

/** "YYYY-MM-DD" → 12:00 UTC that day; date-time without a zone is taken as UTC. Null when not a real date. */
export function parseManualDate(raw: string): Date | null {
  const s = raw.trim();
  let d: Date;
  if (DAY_RE.test(s)) {
    d = new Date(`${s}T12:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  } else if (DATETIME_RE.test(s)) {
    d = new Date(/(Z|[+-]\d{2}:\d{2})$/i.test(s) ? s : `${s}Z`);
    if (Number.isNaN(d.getTime())) return null;
  } else {
    return null;
  }
  return d;
}

const dateField = z
  .string({ invalid_type_error: DATE_FORMAT_MSG, required_error: 'is required' })
  .transform((s, ctx) => {
    const d = parseManualDate(s);
    if (!d) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: DATE_FORMAT_MSG });
      return z.NEVER;
    }
    if (d.getTime() > Date.now() + 24 * 3_600_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'cannot be in the future' });
      return z.NEVER;
    }
    if (d.getTime() < Date.parse(`${L.minDate}T00:00:00.000Z`)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `cannot be before ${L.minDate}` });
      return z.NEVER;
    }
    return d.toISOString();
  });

const idField = (what: string) =>
  z.string({ invalid_type_error: `must be a ${what}`, required_error: 'is required' }).trim().min(1, 'is required').max(300, `must be a known ${what}`);

/** One schema for POST, PUT and every CSV row. Output: ManualMatchInput with `date` normalised to a full ISO string. */
export const manualInputSchema = z
  .object({
    date: dateField,
    mapId: idField('map'),
    agentId: idField('agent'),
    queueId: z.preprocess((v) => nullish(v) ?? undefined, z.enum(MANUAL_QUEUES, { errorMap: () => ({ message: `must be one of ${MANUAL_QUEUES.join(', ')}` }) }).default('competitive')),
    patch: z.preprocess(nullish, z.string().trim().regex(/^\d{1,2}\.\d{2}$/, 'must look like 9.08').nullable()),
    roundsWon: whole(L.maxRoundsPerSide),
    roundsLost: whole(L.maxRoundsPerSide),
    kills: whole(L.maxKda),
    deaths: whole(L.maxKda),
    assists: whole(L.maxKda),
    acs: optAvg(L.maxAcs, 'acs'),
    adr: optAvg(L.maxAdr, 'adr'),
    firstKills: optWhole(L.maxRoundsPerSide * 2),
    firstDeaths: optWhole(L.maxRoundsPerSide * 2),
    note: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim() || null : (v ?? null)),
      z.string({ invalid_type_error: 'must be text' }).max(L.noteMaxLength, `must be at most ${L.noteMaxLength} characters`).nullable(),
    ),
  })
  .superRefine((v, ctx) => {
    const rounds = v.roundsWon + v.roundsLost;
    if (rounds < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['roundsWon'], message: 'roundsWon and roundsLost must add up to at least 1 round' });
    if ((v.firstKills ?? 0) + (v.firstDeaths ?? 0) > rounds) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['firstKills'], message: 'firstKills plus firstDeaths cannot be more than the rounds played' });
    }
  });

export type ParsedManualInput = z.infer<typeof manualInputSchema> & ManualMatchInput;

export interface Catalog {
  agents: { id: string; name: string }[];
  maps: { id: string; name: string }[];
}

/** Validates a manual entry. Returns user-facing `field: problem` strings, or the parsed value. */
export function validateManualInput(input: unknown, catalog: Catalog): { ok: true; value: ParsedManualInput } | { ok: false; errors: string[] } {
  const r = manualInputSchema.safeParse(input ?? {});
  if (!r.success) {
    const errors = r.error.issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : `body: ${i.message}`));
    // Also report unknown ids when the other fields are fine to keep error lists complete.
    return { ok: false, errors: [...new Set(errors)] };
  }
  const errors: string[] = [];
  if (!catalog.maps.some((m) => m.id === r.data.mapId)) errors.push('mapId: unknown map');
  if (!catalog.agents.some((a) => a.id === r.data.agentId)) errors.push('agentId: unknown agent');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: r.data as ParsedManualInput };
}

export function throwManualValidation(errors: string[]): never {
  throw new HttpError(400, 'validation', `Invalid request. ${errors.join('; ')}`);
}

export const importSchema = z.object({ csv: z.string({ invalid_type_error: 'must be text', required_error: 'is required' }), dryRun: z.boolean() });
export const confirmSchema = z.object({ confirm: z.literal(true, { errorMap: () => ({ message: 'must be true to delete all manual entries' }) }) });
