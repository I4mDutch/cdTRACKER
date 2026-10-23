import { MANUAL_ID_PREFIX, manualOutcome } from '@va/core';
import type { ExclusionReason, PlayerMatchRecord } from './types.js';
import { manualMatches, playerMatchRecords, playerRounds } from './schema.js';

export type PlayerRoundRow = {
  roundNumber: number;
  won: boolean;
  result: string;
  kills: number;
  died: boolean;
  damage: number;
  firstKill: boolean;
  firstDeath: boolean;
  planted: boolean;
  defused: boolean;
};

export type StoredPlayerRecord = PlayerMatchRecord & { excluded: ExclusionReason | null };

type RecordRow = typeof playerMatchRecords.$inferSelect;
type RoundRow = typeof playerRounds.$inferSelect;
export type ManualMatchRow = typeof manualMatches.$inferSelect;

export function recordRowToDomain(r: RecordRow): StoredPlayerRecord {
  return {
    matchId: r.matchId,
    source: 'riot',
    puuid: r.puuid,
    startedAt: r.startedAt.toISOString(),
    mapId: r.mapId,
    queueId: r.queueId,
    patch: r.patch,
    agentId: r.agentId,
    teamId: r.teamId,
    outcome: r.outcome as PlayerMatchRecord['outcome'],
    roundsPlayed: r.roundsPlayed,
    roundsWon: r.roundsWon,
    roundsLost: r.roundsLost,
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    combatScore: r.combatScore,
    damageDealt: r.damageDealt,
    headshots: r.headshots,
    bodyshots: r.bodyshots,
    legshots: r.legshots,
    firstKills: r.firstKills,
    firstDeaths: r.firstDeaths,
    plants: r.plants,
    defuses: r.defuses,
    performanceScore: null,
    excluded: (r.excluded as ExclusionReason | null) ?? null,
  };
}

export function recordDomainToRow(rec: PlayerMatchRecord, excluded: ExclusionReason | null): typeof playerMatchRecords.$inferInsert {
  return {
    matchId: rec.matchId,
    puuid: rec.puuid,
    startedAt: new Date(rec.startedAt),
    mapId: rec.mapId,
    queueId: rec.queueId,
    patch: rec.patch,
    agentId: rec.agentId,
    teamId: rec.teamId,
    outcome: rec.outcome,
    roundsPlayed: rec.roundsPlayed,
    roundsWon: rec.roundsWon,
    roundsLost: rec.roundsLost,
    kills: rec.kills,
    deaths: rec.deaths,
    assists: rec.assists,
    combatScore: rec.combatScore,
    damageDealt: rec.damageDealt,
    headshots: rec.headshots,
    bodyshots: rec.bodyshots,
    legshots: rec.legshots,
    firstKills: rec.firstKills,
    firstDeaths: rec.firstDeaths,
    plants: rec.plants,
    defuses: rec.defuses,
    performanceScore: null,
    excluded,
  };
}

export function roundRowToDomain(r: RoundRow): PlayerRoundRow {
  return {
    roundNumber: r.roundNumber,
    won: r.won,
    result: r.result,
    kills: r.kills,
    died: r.died,
    damage: r.damage,
    firstKill: r.firstKill,
    firstDeath: r.firstDeath,
    planted: r.planted,
    defused: r.defused,
  };
}

export function manualRowToRecord(row: ManualMatchRow): StoredPlayerRecord {
  return {
    matchId: `${MANUAL_ID_PREFIX}${row.id}`,
    source: 'manual',
    puuid: `user:${row.userId}`,
    startedAt: row.startedAt.toISOString(),
    mapId: row.mapId,
    queueId: row.queueId,
    patch: row.patch,
    agentId: row.agentId,
    teamId: 'manual',
    outcome: manualOutcome(row.roundsWon, row.roundsLost),
    roundsPlayed: row.roundsWon + row.roundsLost,
    roundsWon: row.roundsWon,
    roundsLost: row.roundsLost,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    combatScore: row.combatScore,
    damageDealt: row.damageDealt,
    headshots: null,
    bodyshots: null,
    legshots: null,
    firstKills: row.firstKills,
    firstDeaths: row.firstDeaths,
    plants: null,
    defuses: null,
    performanceScore: null,
    excluded: (row.excluded as ExclusionReason | null) ?? null,
  };
}
