import { z } from 'zod';
import type { MatchFilter, ShareField } from '@va/shared';
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
  const q = f.queueId ?? 'competitive';
  if (q !== 'all') out.queueId = q;
  return out;
}
