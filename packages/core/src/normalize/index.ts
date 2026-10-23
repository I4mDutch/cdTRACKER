import type {
  DataIssue,
  ExclusionReason,
  MatchOutcome,
  NormalizeResult,
  NormalizedKill,
  NormalizedMatch,
  NormalizedParticipant,
  NormalizedRound,
  NormalizedTeam,
  PlayerMatchRecord,
  RiotMatchDto,
} from '@va/shared';
import { DEFAULT_NORMALIZE_CONFIG, type NormalizeConfig } from '../config.js';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCount = (v: unknown): v is number => isNum(v) && v >= 0;

/** "release-08.11-shipping-6-2545312" -> "8.11". Null when missing or unparseable. */
export function parsePatch(gameVersion: string | undefined | null): string | null {
  if (typeof gameVersion !== 'string') return null;
  const m = /^release-(\d+)\.(\d+)/.exec(gameVersion);
  if (!m) return null;
  return `${Number(m[1])}.${m[2]}`;
}

const fatal = (code: string, message: string): DataIssue => ({ severity: 'fatal', code, message });
const warn = (code: string, message: string): DataIssue => ({ severity: 'warning', code, message });

function failWith(code: string, message: string): NormalizeResult {
  return { ok: false, issues: [fatal(code, message)] };
}

function normalizeRounds(rawRounds: unknown[], issues: DataIssue[]): NormalizedRound[] {
  const rounds: NormalizedRound[] = [];
  for (const rr of rawRounds) {
    if (!isObj(rr) || !isNum(rr.roundNum) || !isStr(rr.winningTeam)) {
      issues.push(warn('malformed_round', 'Skipped a round result with missing roundNum or winningTeam.'));
      continue;
    }
    const kills: NormalizedKill[] = [];
    const seen = new Set<string>();
    const damage: NormalizedRound['damage'] = [];
    const playerStats = Array.isArray(rr.playerStats) ? rr.playerStats : [];
    for (const ps of playerStats) {
      if (!isObj(ps) || !isStr(ps.puuid)) {
        issues.push(warn('malformed_round_player_stats', `Skipped malformed playerStats in round ${rr.roundNum + 1}.`));
        continue;
      }
      if (Array.isArray(ps.kills)) {
        for (const k of ps.kills) {
          if (!isObj(k) || !isStr(k.killer) || !isStr(k.victim) || !isNum(k.timeSinceRoundStartMillis)) {
            issues.push(warn('malformed_kill', `Skipped malformed kill event in round ${rr.roundNum + 1}.`));
            continue;
          }
          const key = `${k.killer}|${k.victim}|${k.timeSinceRoundStartMillis}`;
          if (seen.has(key)) continue;
          seen.add(key);
          kills.push({
            roundTimeMs: k.timeSinceRoundStartMillis,
            killer: k.killer,
            victim: k.victim,
            assistants: Array.isArray(k.assistants) ? k.assistants.filter(isStr) : [],
          });
        }
      }
      const sum = { puuid: ps.puuid, damage: 0, headshots: 0, bodyshots: 0, legshots: 0 };
      if (Array.isArray(ps.damage)) {
        for (const d of ps.damage) {
          if (!isObj(d) || !isCount(d.damage)) {
            issues.push(warn('malformed_damage', `Skipped malformed damage entry in round ${rr.roundNum + 1}.`));
            continue;
          }
          sum.damage += d.damage;
          sum.headshots += isCount(d.headshots) ? d.headshots : 0;
          sum.bodyshots += isCount(d.bodyshots) ? d.bodyshots : 0;
          sum.legshots += isCount(d.legshots) ? d.legshots : 0;
        }
      }
      damage.push(sum);
    }
    kills.sort((a, b) => a.roundTimeMs - b.roundTimeMs);
    rounds.push({
      roundNumber: rr.roundNum + 1,
      winningTeam: rr.winningTeam,
      result: isStr(rr.roundResult) ? rr.roundResult : '',
      planter: isStr(rr.bombPlanter) ? rr.bombPlanter : null,
      defuser: isStr(rr.bombDefuser) ? rr.bombDefuser : null,
      kills,
      damage,
    });
  }
  rounds.sort((a, b) => a.roundNumber - b.roundNumber);
  return rounds;
}

export function normalizeMatch(raw: unknown, config: NormalizeConfig = DEFAULT_NORMALIZE_CONFIG): NormalizeResult {
  if (!isObj(raw)) return failWith('invalid_payload', 'Match payload is not an object.');
  const info = raw.matchInfo;
  if (!isObj(info)) return failWith('missing_match_info', 'matchInfo is missing or not an object.');
  if (!isStr(info.matchId) || info.matchId === '') return failWith('invalid_match_id', 'matchInfo.matchId must be a non-empty string.');
  if (!isStr(info.mapId)) return failWith('invalid_map_id', 'matchInfo.mapId must be a string.');
  if (!isNum(info.gameStartMillis)) return failWith('invalid_start_time', 'matchInfo.gameStartMillis must be a finite number.');
  if (!isStr(info.queueId)) return failWith('invalid_queue_id', 'matchInfo.queueId must be a string.');
  if (typeof info.isCompleted !== 'boolean') return failWith('invalid_is_completed', 'matchInfo.isCompleted must be a boolean.');
  if (!Array.isArray(raw.players) || raw.players.length === 0) {
    return failWith('missing_players', 'players must be a non-empty array.');
  }
  const startDate = new Date(info.gameStartMillis);
  if (Number.isNaN(startDate.getTime())) return failWith('invalid_start_time', 'matchInfo.gameStartMillis is not a valid date.');

  const issues: DataIssue[] = [];
  const participants: NormalizedParticipant[] = [];
  for (const p of raw.players) {
    if (!isObj(p) || !isStr(p.puuid) || !isStr(p.teamId) || !isStr(p.characterId)) {
      return failWith('invalid_player', 'A player is missing puuid, teamId or characterId.');
    }
    const stats = isObj(p.stats) ? p.stats : null;
    const pick = (v: unknown): number | null => (stats && isCount(v) ? v : null);
    const part: NormalizedParticipant = {
      puuid: p.puuid,
      teamId: p.teamId,
      agentId: p.characterId,
      combatScore: pick(stats?.score),
      roundsPlayed: pick(stats?.roundsPlayed),
      kills: pick(stats?.kills),
      deaths: pick(stats?.deaths),
      assists: pick(stats?.assists),
    };
    if (
      part.combatScore === null ||
      part.roundsPlayed === null ||
      part.kills === null ||
      part.deaths === null ||
      part.assists === null
    ) {
      issues.push(warn('missing_player_stats', `Player stats missing or invalid for a participant (${p.puuid}).`));
    }
    participants.push(part);
  }

  const teams: NormalizedTeam[] = [];
  if (Array.isArray(raw.teams)) {
    for (const t of raw.teams) {
      if (!isObj(t) || !isStr(t.teamId) || typeof t.won !== 'boolean' || !isCount(t.roundsPlayed) || !isCount(t.roundsWon)) {
        issues.push(warn('malformed_team', 'Skipped a malformed team entry.'));
        continue;
      }
      teams.push({ teamId: t.teamId, won: t.won, roundsPlayed: t.roundsPlayed, roundsWon: t.roundsWon });
    }
  }
  if (teams.length === 0) issues.push(warn('missing_teams', 'Team results are missing.'));

  let rounds: NormalizedRound[] = [];
  if (Array.isArray(raw.roundResults) && raw.roundResults.length > 0) {
    rounds = normalizeRounds(raw.roundResults, issues);
  } else {
    issues.push(warn('missing_round_data', 'roundResults is absent or empty; round-level metrics are unavailable.'));
  }

  if (rounds.length > 0 && teams.length > 0) {
    for (const t of teams) {
      const won = rounds.filter((r) => r.winningTeam === t.teamId).length;
      if (won !== t.roundsWon) {
        issues.push(warn('team_round_mismatch', `Team ${t.teamId} roundsWon ${t.roundsWon} does not match ${won} won rounds in roundResults.`));
      }
    }
  }

  const roundsPlayed = teams.length > 0 ? Math.max(...teams.map((t) => t.roundsPlayed)) : rounds.length;

  let excluded: ExclusionReason | null = null;
  if (!info.isCompleted) excluded = 'incomplete';
  else if (roundsPlayed <= config.remakeMaxRounds) excluded = 'remake';
  else if (teams.length !== 2 || teams.filter((t) => t.won).length > 1) excluded = 'inconsistent_teams';
  else if (!config.supportedQueues.includes(info.queueId)) excluded = 'unsupported_queue';

  const match: NormalizedMatch = {
    matchId: info.matchId,
    startedAt: startDate.toISOString(),
    durationMs: isNum(info.gameLengthMillis) ? info.gameLengthMillis : null,
    mapId: info.mapId,
    queueId: info.queueId,
    seasonId: isStr(info.seasonId) ? info.seasonId : null,
    patch: parsePatch(isStr(info.gameVersion) ? info.gameVersion : null),
    isCompleted: info.isCompleted,
    roundsPlayed,
    teams,
    participants,
    rounds,
    excluded,
  };
  return { ok: true, match, issues };
}

/** Returns null when puuid is not a participant or its K/D/A is unavailable. */
export function toPlayerRecord(match: NormalizedMatch, puuid: string): PlayerMatchRecord | null {
  const p = match.participants.find((x) => x.puuid === puuid);
  if (!p) return null;
  if (p.kills === null || p.deaths === null || p.assists === null) return null;

  const winner = match.teams.find((t) => t.won);
  const outcome: MatchOutcome = !winner ? 'draw' : winner.teamId === p.teamId ? 'win' : 'loss';
  const own = match.teams.find((t) => t.teamId === p.teamId);
  const opp = match.teams.find((t) => t.teamId !== p.teamId);
  const countWon = (teamId: string) => match.rounds.filter((r) => r.winningTeam === teamId).length;
  const roundsWon = own ? own.roundsWon : countWon(p.teamId);
  const roundsLost = opp
    ? opp.roundsWon
    : match.rounds.filter((r) => r.winningTeam !== p.teamId).length;

  const base = {
    matchId: match.matchId,
    source: 'riot',
    puuid,
    startedAt: match.startedAt,
    mapId: match.mapId,
    queueId: match.queueId,
    patch: match.patch,
    agentId: p.agentId,
    teamId: p.teamId,
    outcome,
    roundsPlayed: p.roundsPlayed ?? match.roundsPlayed,
    roundsWon,
    roundsLost,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    combatScore: p.combatScore,
    performanceScore: null,
  } as const;

  if (match.rounds.length === 0) {
    return {
      ...base,
      damageDealt: null,
      headshots: null,
      bodyshots: null,
      legshots: null,
      firstKills: null,
      firstDeaths: null,
      plants: null,
      defuses: null,
    };
  }

  let damageDealt = 0, headshots = 0, bodyshots = 0, legshots = 0;
  let firstKills = 0, firstDeaths = 0, plants = 0, defuses = 0;
  for (const r of match.rounds) {
    const d = r.damage.find((x) => x.puuid === puuid);
    if (d) {
      damageDealt += d.damage;
      headshots += d.headshots;
      bodyshots += d.bodyshots;
      legshots += d.legshots;
    }
    const first = r.kills[0];
    if (first) {
      if (first.killer === puuid) firstKills++;
      if (first.victim === puuid) firstDeaths++;
    }
    if (r.planter === puuid) plants++;
    if (r.defuser === puuid) defuses++;
  }
  return { ...base, damageDealt, headshots, bodyshots, legshots, firstKills, firstDeaths, plants, defuses };
}

export type { RiotMatchDto };
