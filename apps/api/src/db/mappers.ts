import type { ExclusionReason, PlayerMatchRecord } from './types.js';
import { playerMatchRecords, playerRounds } from './schema.js';

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

export function recordRowToDomain(r: RecordRow): StoredPlayerRecord {
  return {
    matchId: r.matchId,
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
