import type { GroupKey, GroupStat, MatchFilter, PlayerMatchRecord, RateInterval, StatLine, TrendMetric, TrendPoint } from '@va/shared';
import { DEFAULT_AGGREGATE_CONFIG, type AggregateConfig } from '../config.js';

/** Wilson score interval for a binomial proportion, clamped to [0, 1]. Null when n <= 0. */
export function wilsonInterval(successes: number, n: number, z = 1.96): RateInterval | null {
  if (!(n > 0)) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/** Bayesian-style smoothing toward a prior rate with `priorWeight` pseudo-observations. */
export function smoothedRate(successes: number, n: number, priorRate: number, priorWeight: number): number {
  if (n + priorWeight === 0) return priorRate;
  return (successes + priorRate * priorWeight) / (n + priorWeight);
}

function compareRecords(a: PlayerMatchRecord, b: PlayerMatchRecord): number {
  const ta = Date.parse(a.startedAt);
  const tb = Date.parse(b.startedAt);
  if (ta !== tb) return ta - tb;
  return a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0;
}

function sortedCopy(records: PlayerMatchRecord[]): PlayerMatchRecord[] {
  return [...records].sort(compareRecords);
}

/** Pure filter. Result is sorted by startedAt ascending (tie-break matchId). */
export function filterRecords(records: PlayerMatchRecord[], filter: MatchFilter): PlayerMatchRecord[] {
  const from = filter.from ? Date.parse(filter.from) : null;
  const to = filter.to ? Date.parse(filter.to) : null;
  let out = records.filter((r) => {
    if (filter.agentId && r.agentId !== filter.agentId) return false;
    if (filter.mapId && r.mapId !== filter.mapId) return false;
    if (filter.queueId && r.queueId !== filter.queueId) return false;
    if (filter.source && r.source !== filter.source) return false;
    if (filter.patch && r.patch !== filter.patch) return false;
    if (from !== null || to !== null) {
      const t = Date.parse(r.startedAt);
      if (from !== null && !Number.isNaN(from) && t < from) return false;
      if (to !== null && !Number.isNaN(to) && t >= to) return false;
    }
    return true;
  });
  out.sort(compareRecords);
  const lastN = filter.lastN;
  if (lastN !== undefined && Number.isInteger(lastN) && lastN > 0 && out.length > lastN) {
    out = out.slice(out.length - lastN);
  }
  return out;
}

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

function killRatio(numerator: number, deaths: number): { value: number | null; zeroDeaths: boolean } {
  if (deaths > 0) return { value: numerator / deaths, zeroDeaths: false };
  if (numerator > 0) return { value: numerator, zeroDeaths: true };
  return { value: null, zeroDeaths: false };
}

export function computeStatLine(records: PlayerMatchRecord[]): StatLine {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let rounds = 0;
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let csSum = 0;
  let csRounds = 0;
  let csCount = 0;
  let rdCount = 0;
  let rdRounds = 0;
  let damage = 0;
  let hs = 0;
  let bs = 0;
  let ls = 0;
  let fdCount = 0;
  let fdRounds = 0;
  let fk = 0;
  let fd = 0;

  for (const r of records) {
    if (r.outcome === 'win') wins++;
    else if (r.outcome === 'loss') losses++;
    else draws++;
    rounds += r.roundsPlayed;
    kills += r.kills;
    deaths += r.deaths;
    assists += r.assists;
    if (r.combatScore !== null) {
      csSum += r.combatScore;
      csRounds += r.roundsPlayed;
      csCount++;
    }
    // Independent per-metric record sets: a record missing one field never dilutes another metric.
    if (r.damageDealt !== null) {
      rdCount++;
      rdRounds += r.roundsPlayed;
      damage += r.damageDealt;
    }
    if (r.headshots !== null && r.bodyshots !== null && r.legshots !== null) {
      hs += r.headshots;
      bs += r.bodyshots;
      ls += r.legshots;
    }
    if (r.firstKills !== null && r.firstDeaths !== null) {
      fdCount++;
      fdRounds += r.roundsPlayed;
      fk += r.firstKills;
      fd += r.firstDeaths;
    }
  }

  const matches = records.length;
  const kd = killRatio(kills, deaths);
  const kda = killRatio(kills + assists, deaths);

  return {
    matches,
    wins,
    losses,
    draws,
    winRate: ratio(wins, matches),
    winRateInterval: wilsonInterval(wins, matches),
    rounds,
    kills,
    deaths,
    assists,
    kd: kd.value,
    kda: kda.value,
    zeroDeaths: kd.zeroDeaths,
    killsPerRound: ratio(kills, rounds),
    deathsPerRound: ratio(deaths, rounds),
    assistsPerRound: ratio(assists, rounds),
    acs: ratio(csSum, csRounds),
    adr: ratio(damage, rdRounds),
    headshotPct: ratio(hs, hs + bs + ls),
    firstKillsPerRound: ratio(fk, fdRounds),
    firstDeathsPerRound: ratio(fd, fdRounds),
    firstDuelWinRate: ratio(fk, fk + fd),
    coverage: { combatScore: csCount, roundData: rdCount, roundDataRounds: rdRounds, firstDuel: fdCount, firstDuelRounds: fdRounds },
  };
}

export function groupStats(records: PlayerMatchRecord[], key: GroupKey, config: AggregateConfig = DEFAULT_AGGREGATE_CONFIG): GroupStat[] {
  const groups = new Map<string, PlayerMatchRecord[]>();
  for (const r of records) {
    const k = r[key] ?? 'unknown';
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  const out: GroupStat[] = [];
  for (const [k, list] of groups) {
    const stat = computeStatLine(list);
    out.push({ key: k, stat, lowSample: stat.matches < config.lowSampleMatches });
  }
  out.sort((a, b) => b.stat.matches - a.stat.matches || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function computeTrend(records: PlayerMatchRecord[], metric: TrendMetric, window: number): TrendPoint[] {
  if (!(window >= 1)) throw new RangeError(`window must be >= 1, got ${window}`);
  const sorted = sortedCopy(records);
  const contributes = sorted.map((r) => computeStatLine([r])[metric] !== null);
  const points: TrendPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = Math.max(0, i - window + 1);
    let sample = 0;
    for (let j = start; j <= i; j++) if (contributes[j]) sample++;
    const rec = sorted[i]!;
    points.push({
      index: i,
      matchId: rec.matchId,
      startedAt: rec.startedAt,
      value: computeStatLine(sorted.slice(start, i + 1))[metric],
      sample,
    });
  }
  return points;
}
