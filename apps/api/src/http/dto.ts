import type {
  MatchDetailDto,
  MatchSummaryDto,
  PlayerMatchRecord,
  RoundSummaryDto,
  BreakdownRow,
  StatLine,
  GroupStat,
} from '@va/shared';
import type { NameLookup } from '@va/core';
import type { MatchRow, PlayerRoundRow, StoredPlayerRecord } from '../db/index.js';

const perRound = (num: number | null, rounds: number): number | null => (num === null || rounds <= 0 ? null : num / rounds);

export function toMatchSummary(r: StoredPlayerRecord, names: NameLookup): MatchSummaryDto {
  return {
    matchId: r.matchId,
    startedAt: r.startedAt,
    mapId: r.mapId,
    mapName: names.maps[r.mapId] ?? r.mapId,
    queueId: r.queueId,
    patch: r.patch,
    agentId: r.agentId,
    agentName: names.agents[r.agentId] ?? r.agentId,
    outcome: r.outcome,
    roundsWon: r.roundsWon,
    roundsLost: r.roundsLost,
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    acs: perRound(r.combatScore, r.roundsPlayed),
    adr: perRound(r.damageDealt, r.roundsPlayed),
    excluded: r.excluded,
  };
}

export function toMatchDetail(
  match: MatchRow,
  record: StoredPlayerRecord,
  rounds: PlayerRoundRow[],
  names: NameLookup,
): MatchDetailDto {
  const hasRounds = rounds.length > 0;
  const roundDtos: RoundSummaryDto[] = rounds.map((x) => ({
    roundNumber: x.roundNumber,
    won: x.won,
    result: x.result,
    kills: x.kills,
    died: x.died,
    damage: x.damage,
    firstKill: x.firstKill,
    firstDeath: x.firstDeath,
    planted: x.planted,
    defused: x.defused,
  }));
  const noRounds = 'No round data for this match';
  const sources: MatchDetailDto['fieldSources'] = [
    { field: 'kills', source: 'riot' },
    { field: 'deaths', source: 'riot' },
    { field: 'assists', source: 'riot' },
    { field: 'rounds', source: 'riot' },
    record.combatScore !== null
      ? { field: 'acs', source: 'calculated', note: 'Riot combat score divided by rounds played' }
      : { field: 'acs', source: 'unavailable', note: 'Combat score missing from the match data' },
    hasRounds && record.damageDealt !== null
      ? { field: 'adr', source: 'calculated', note: 'Damage dealt (summed from rounds) divided by rounds played' }
      : { field: 'adr', source: 'unavailable', note: noRounds },
    hasRounds
      ? { field: 'firstKills', source: 'calculated', note: 'Derived from kill timing within each round' }
      : { field: 'firstKills', source: 'unavailable', note: noRounds },
    hasRounds
      ? { field: 'firstDeaths', source: 'calculated', note: 'Derived from kill timing within each round' }
      : { field: 'firstDeaths', source: 'unavailable', note: noRounds },
    { field: 'winRate', source: 'calculated', note: 'Computed from match outcomes' },
    { field: 'performanceScore', source: 'unavailable', note: 'Not provided by the Riot match API' },
  ];
  return {
    summary: toMatchSummary(record, names),
    durationMs: match.durationMs,
    teams: match.teams.map((t) => ({
      teamId: t.teamId,
      isPlayerTeam: t.teamId === record.teamId,
      roundsWon: t.roundsWon,
      won: t.won,
    })),
    rounds: roundDtos,
    fieldSources: sources,
  };
}

const diff = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);

export function toBreakdownRows(groups: GroupStat[], baseline: StatLine, nameOf: (id: string) => string): BreakdownRow[] {
  return groups
    .map((g) => ({
      id: g.key,
      name: nameOf(g.key),
      stat: g.stat,
      lowSample: g.lowSample,
      winRateDelta: diff(g.stat.winRate, baseline.winRate),
      kdDelta: diff(g.stat.kd, baseline.kd),
    }))
    .sort((a, b) => b.stat.matches - a.stat.matches || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const csvRow = (r: StoredPlayerRecord, names: NameLookup, cols: readonly (keyof PlayerMatchRecord)[]): unknown[] => [
  ...cols.map((c) => r[c]),
  names.maps[r.mapId] ?? r.mapId,
  names.agents[r.agentId] ?? r.agentId,
  r.excluded,
];
