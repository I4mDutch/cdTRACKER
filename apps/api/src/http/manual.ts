import { MANUAL_ID_PREFIX, manualExclusion, manualOutcome, type NameLookup } from '@va/core';
import type { ManualMatchDto, ManualMatchInput, ManualQueue, MatchDetailDto } from '@va/shared';
import { schema, type Db, type ManualMatchFields, type ManualMatchRow, type StoredPlayerRecord } from '../db/index.js';
import { toMatchSummary } from './dto.js';
import type { Catalog } from './validation.js';

/** All known agents/maps from stored game content, sorted by name. Map ids are asset paths (falling back to the id). */
export async function loadCatalog(db: Db): Promise<Catalog> {
  const rows = await db.select().from(schema.contentItems);
  const byName = (a: { name: string; id: string }, b: { name: string; id: string }): number =>
    a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    agents: rows.filter((r) => r.kind === 'agent').map((r) => ({ id: r.id, name: r.name })).sort(byName),
    maps: rows.filter((r) => r.kind === 'map').map((r) => ({ id: r.assetPath ?? r.id, name: r.name })).sort(byName),
  };
}

/** Validated input (date already a normalised ISO string) → DB fields. */
export function toManualFields(v: ManualMatchInput): ManualMatchFields {
  const rounds = v.roundsWon + v.roundsLost;
  return {
    startedAt: new Date(v.date),
    mapId: v.mapId,
    agentId: v.agentId,
    queueId: v.queueId,
    patch: v.patch ?? null,
    roundsWon: v.roundsWon,
    roundsLost: v.roundsLost,
    kills: v.kills,
    deaths: v.deaths,
    assists: v.assists,
    combatScore: v.acs == null ? null : Math.round(v.acs * rounds),
    damageDealt: v.adr == null ? null : Math.round(v.adr * rounds),
    firstKills: v.firstKills ?? null,
    firstDeaths: v.firstDeaths ?? null,
    note: v.note ?? null,
    excluded: manualExclusion(v.queueId, rounds),
  };
}

const avg = (total: number | null, rounds: number): number | null => (total === null || rounds <= 0 ? null : Math.round((total / rounds) * 10) / 10);

export function toManualDto(row: ManualMatchRow): ManualMatchDto {
  const rounds = row.roundsWon + row.roundsLost;
  return {
    id: `${MANUAL_ID_PREFIX}${row.id}`,
    startedAt: row.startedAt.toISOString(),
    mapId: row.mapId,
    agentId: row.agentId,
    queueId: row.queueId as ManualQueue,
    patch: row.patch,
    roundsWon: row.roundsWon,
    roundsLost: row.roundsLost,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    acs: avg(row.combatScore, rounds),
    adr: avg(row.damageDealt, rounds),
    firstKills: row.firstKills,
    firstDeaths: row.firstDeaths,
    note: row.note,
    outcome: manualOutcome(row.roundsWon, row.roundsLost),
    excluded: row.excluded,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toManualMatchDetail(row: ManualMatchRow, record: StoredPlayerRecord, names: NameLookup): MatchDetailDto {
  const optional = (field: string, value: number | null): MatchDetailDto['fieldSources'][number] =>
    value !== null ? { field, source: 'manual' } : { field, source: 'unavailable', note: 'Not entered' };
  return {
    summary: toMatchSummary(record, names),
    durationMs: null,
    teams: [
      { teamId: 'you', isPlayerTeam: true, roundsWon: record.roundsWon, won: record.outcome === 'win' },
      { teamId: 'opponents', isPlayerTeam: false, roundsWon: record.roundsLost, won: record.outcome === 'loss' },
    ],
    rounds: [],
    fieldSources: [
      { field: 'kills', source: 'manual' },
      { field: 'deaths', source: 'manual' },
      { field: 'assists', source: 'manual' },
      { field: 'rounds', source: 'manual' },
      { field: 'map', source: 'manual' },
      { field: 'agent', source: 'manual' },
      { field: 'date', source: 'manual' },
      optional('acs', record.combatScore),
      optional('adr', record.damageDealt),
      optional('firstKills', record.firstKills),
      optional('firstDeaths', record.firstDeaths),
      { field: 'winRate', source: 'calculated', note: 'Computed from match outcomes' },
      { field: 'performanceScore', source: 'unavailable', note: 'Not provided by the Riot match API' },
    ],
    manual: { note: row.note, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() },
  };
}
