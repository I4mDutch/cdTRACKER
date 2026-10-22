import type {
  EvidenceLevel,
  Finding,
  FindingType,
  PlayerMatchRecord,
  ScoreComponent,
  ScoreComponentKey,
  ScoreResult,
  StatLine,
} from '@va/shared';
import { DEFAULT_ANALYSIS_CONFIG, DEFAULT_SCORE_CONFIG, type AnalysisConfig, type ScoreConfig } from '../config.js';
import { computeStatLine, filterRecords, smoothedRate, wilsonInterval } from '../aggregate/index.js';

/** Display names for subjects, keyed by agentId / mapId. Missing names fall back to the id. */
export interface NameLookup {
  agents: Record<string, string>;
  maps: Record<string, string>;
}

const BASELINE_LABEL = 'your other matches in this filter window';
const EVIDENCE_RANK: Record<EvidenceLevel, number> = { strong: 2, moderate: 1, low: 0 };
const PREFIX: Record<EvidenceLevel, string> = {
  low: 'Possible focus:',
  moderate: 'Worth reviewing:',
  strong: 'Consistent pattern:',
};

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const pts = (x: number): string => (x * 100).toFixed(1);
const per = (x: number): string => x.toFixed(2);

interface Candidate {
  finding: Finding;
  normGap: number;
}

function recentMatchIds(subject: PlayerMatchRecord[]): string[] {
  return filterRecords(subject, {})
    .reverse()
    .slice(0, 20)
    .map((r) => r.matchId);
}

function firstDuelCounts(records: PlayerMatchRecord[]): { fk: number; fd: number; rounds: number } {
  let fk = 0;
  let fd = 0;
  let rounds = 0;
  for (const r of records) {
    if (r.damageDealt === null) continue;
    fk += r.firstKills ?? 0;
    fd += r.firstDeaths ?? 0;
    rounds += r.roundsPlayed;
  }
  return { fk, fd, rounds };
}

export function generateFindings(
  records: PlayerMatchRecord[],
  names: NameLookup,
  config: AnalysisConfig = DEFAULT_ANALYSIS_CONFIG,
): Finding[] {
  if (records.length < config.minMatches) return [];
  const out: Candidate[] = [];

  const kinds: Array<{ kind: 'agent' | 'map'; key: 'agentId' | 'mapId' }> = [
    { kind: 'agent', key: 'agentId' },
    { kind: 'map', key: 'mapId' },
  ];

  for (const { kind, key } of kinds) {
    const groups = new Map<string, PlayerMatchRecord[]>();
    for (const r of records) {
      const list = groups.get(r[key]);
      if (list) list.push(r);
      else groups.set(r[key], [r]);
    }
    for (const [id, subject] of groups) {
      const others = records.filter((r) => r[key] !== id);
      if (others.length < config.minMatches) continue;
      const subj = computeStatLine(subject);
      const base = computeStatLine(others);
      const display = (kind === 'agent' ? names.agents[id] : names.maps[id]) ?? id;
      const matchIds = recentMatchIds(subject);
      const common = { subject: { kind, id }, baselineLabel: BASELINE_LABEL, matchIds, analysisVersion: config.version };

      const make = (
        type: FindingType,
        metric: keyof StatLine,
        value: number,
        baseline: number,
        direction: 'below' | 'above',
        evidence: EvidenceLevel,
        sampleRounds: number,
        summaryBody: string,
        recommendation: string,
        method: string,
        normGap: number,
      ): void => {
        out.push({
          finding: {
            id: `${type}:${kind}:${id}`,
            type,
            metric,
            value,
            baseline,
            direction,
            sampleMatches: subj.matches,
            sampleRounds,
            evidence,
            summary: `${PREFIX[evidence]} ${summaryBody}`,
            recommendation,
            method,
            ...common,
          },
          normGap,
        });
      };

      // Win rate
      if (subj.matches >= config.minMatches && base.winRate !== null && subj.winRate !== null) {
        const n = subj.matches;
        const smoothed = smoothedRate(subj.wins, n, base.winRate, config.smoothingPriorMatches);
        const gap = base.winRate - smoothed;
        if (gap >= config.winRateGap) {
          const interval = wilsonInterval(subj.wins, n);
          const evidence: EvidenceLevel =
            interval !== null && interval.high < base.winRate ? 'strong' : n >= 2 * config.minMatches ? 'moderate' : 'low';
          const isAgent = kind === 'agent';
          const type: FindingType = isAgent ? 'agent_win_rate' : 'map_win_rate';
          make(
            type,
            'winRate',
            subj.winRate,
            base.winRate,
            'below',
            evidence,
            subj.rounds,
            `your win rate ${isAgent ? 'with' : 'on'} ${display} is ${pct(subj.winRate)} across ${n} matches, vs ${pct(base.winRate)} in your other matches.`,
            isAgent
              ? `Review a few recent ${display} losses and compare your role and utility usage with your wins; consider limiting ${display} in ranked until results stabilise.`
              : `Rewatch two or three recent ${display} losses and note which rounds slipped (attack vs defense, pistol rounds); a few unrated games on ${display} may help.`,
            `Compared smoothed win rate (prior ${config.smoothingPriorMatches} matches at your baseline) ${isAgent ? 'with this agent' : 'on this map'} with your other matches; flagged when ≥${pts(config.winRateGap)} pts lower with ≥${config.minMatches} matches. Evidence 'strong' when the 95% Wilson interval lies entirely below the baseline.`,
            gap / config.winRateGap,
          );
        }
      }

      if (kind !== 'agent') continue;

      const perRoundEvidence = (rounds: number, relGap: number, threshold: number): EvidenceLevel => {
        const a = rounds >= 2 * config.minRounds;
        const b = relGap >= 2 * threshold;
        return a && b ? 'strong' : a || b ? 'moderate' : 'low';
      };
      const perRoundMethod = (what: string, dir: string): string =>
        `Compared ${what} on this agent with your other matches; flagged when ≥${(config.perRoundRelativeGap * 100).toFixed(0)}% ${dir} with ≥${config.minRounds} rounds. Evidence rises with more rounds and a larger gap.`;

      // Deaths per round (higher is worse)
      if (subj.rounds >= config.minRounds && subj.deathsPerRound !== null && base.deathsPerRound) {
        const rel = (subj.deathsPerRound - base.deathsPerRound) / base.deathsPerRound;
        if (rel >= config.perRoundRelativeGap) {
          make(
            'deaths_per_round',
            'deathsPerRound',
            subj.deathsPerRound,
            base.deathsPerRound,
            'above',
            perRoundEvidence(subj.rounds, rel, config.perRoundRelativeGap),
            subj.rounds,
            `your deaths per round on ${display} is ${per(subj.deathsPerRound)} across ${subj.rounds} rounds, vs ${per(base.deathsPerRound)} in your other matches.`,
            `Your deaths per round on ${display} are higher than on your other agents. Review rounds where you died early to see whether a pattern repeats.`,
            perRoundMethod('deaths per round', 'higher'),
            rel / config.perRoundRelativeGap,
          );
        }
      }

      // Assists per round (lower is worse)
      if (subj.rounds >= config.minRounds && subj.assistsPerRound !== null && base.assistsPerRound) {
        const rel = (base.assistsPerRound - subj.assistsPerRound) / base.assistsPerRound;
        if (rel >= config.perRoundRelativeGap) {
          make(
            'assists_per_round',
            'assistsPerRound',
            subj.assistsPerRound,
            base.assistsPerRound,
            'below',
            perRoundEvidence(subj.rounds, rel, config.perRoundRelativeGap),
            subj.rounds,
            `your assists per round on ${display} is ${per(subj.assistsPerRound)} across ${subj.rounds} rounds, vs ${per(base.assistsPerRound)} in your other matches.`,
            `You record fewer assists per round on ${display} than usual. If this agent's role is supportive, review how often your utility leads to team kills.`,
            perRoundMethod('assists per round', 'lower'),
            rel / config.perRoundRelativeGap,
          );
        }
      }

      // First duel win rate
      const sFd = firstDuelCounts(subject);
      if (
        subj.coverage.roundDataRounds >= config.minRounds &&
        sFd.fk + sFd.fd >= 30 &&
        subj.firstDuelWinRate !== null &&
        base.firstDuelWinRate !== null
      ) {
        const gap = base.firstDuelWinRate - subj.firstDuelWinRate;
        if (gap >= config.winRateGap) {
          const a = subj.coverage.roundDataRounds >= 2 * config.minRounds;
          const b = gap >= 2 * config.winRateGap;
          const evidence: EvidenceLevel = a && b ? 'strong' : a || b ? 'moderate' : 'low';
          make(
            'first_duel',
            'firstDuelWinRate',
            subj.firstDuelWinRate,
            base.firstDuelWinRate,
            'below',
            evidence,
            subj.coverage.roundDataRounds,
            `your opening-duel win rate on ${display} is ${pct(subj.firstDuelWinRate)} across ${sFd.fk + sFd.fd} opening duels, vs ${pct(base.firstDuelWinRate)} in your other matches.`,
            `You lose more opening duels on ${display} than on your other agents. Review opening engagements in recent matches.`,
            `Compared opening-duel win rate on this agent with your other matches; flagged when ≥${pts(config.winRateGap)} pts lower with ≥${config.minRounds} rounds of round data and ≥30 opening duels. Evidence rises with more rounds and a larger gap.`,
            gap / config.winRateGap,
          );
        }
      }
    }
  }

  out.sort(
    (a, b) =>
      EVIDENCE_RANK[b.finding.evidence] - EVIDENCE_RANK[a.finding.evidence] ||
      b.normGap - a.normGap ||
      (a.finding.id < b.finding.id ? -1 : a.finding.id > b.finding.id ? 1 : 0),
  );
  return out.slice(0, config.maxFindings).map((c) => c.finding);
}

// ---------------------------------------------------------------------------
// Analyzer Score
// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function meanStd(xs: number[]): { mean: number; std: number } {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return { mean, std: Math.sqrt(variance) };
}

function zNormalize(windowValue: number, series: number[]): number {
  if (series.length === 0) return 50;
  const { mean, std } = meanStd(series);
  if (std < 1e-12) return 50;
  return clamp(50 + (25 * (windowValue - mean)) / std, 0, 100);
}

const sum = (xs: PlayerMatchRecord[], f: (r: PlayerMatchRecord) => number): number => xs.reduce((s, r) => s + f(r), 0);

export function computeAnalyzerScore(records: PlayerMatchRecord[], config: ScoreConfig = DEFAULT_SCORE_CONFIG): ScoreResult {
  const history = filterRecords(records, {});
  const window = history.slice(Math.max(0, history.length - config.windowMatches));
  const w = config.weights;

  const meta: Record<ScoreComponentKey, { label: string; sourceFields: string[] }> = {
    outcome: { label: 'Match outcome', sourceFields: ['teams[].won'] },
    combat: {
      label: 'Combat efficiency',
      sourceFields: ['players[].stats.kills', 'players[].stats.deaths', 'players[].stats.roundsPlayed'],
    },
    impact: { label: 'Per-round impact (combat score)', sourceFields: ['players[].stats.score'] },
    objective: {
      label: 'Objective & support',
      sourceFields: ['players[].stats.assists', 'roundResults[].bombPlanter', 'roundResults[].bombDefuser'],
    },
  };
  const keys: ScoreComponentKey[] = ['outcome', 'combat', 'impact', 'objective'];
  const baseNote = 'Relative to your own per-match history (z-score mapped to 0–100, 50 = your average).';

  let reason: string | null = null;
  if (window.length < config.minWindowMatches) {
    reason = `Need at least ${config.minWindowMatches} matches (have ${window.length}).`;
  } else if (history.length < config.minHistoryMatches) {
    reason = `Need at least ${config.minHistoryMatches} matches of history (have ${history.length}).`;
  }

  const unavailableComponent = (key: ScoreComponentKey, note: string): ScoreComponent => ({
    key,
    ...meta[key],
    weight: w[key],
    effectiveWeight: 0,
    available: false,
    rawValue: null,
    normalized: null,
    note,
  });

  const base = {
    formulaVersion: config.formulaVersion,
    sampleMatches: window.length,
    historyMatches: history.length,
    relativeTo: 'own-history' as const,
  };

  if (reason !== null) {
    return {
      ...base,
      available: false,
      reason,
      score: null,
      coverage: 0,
      components: keys.map((k) => unavailableComponent(k, reason as string)),
    };
  }

  const frac = (xs: PlayerMatchRecord[], pred: (r: PlayerMatchRecord) => boolean): number =>
    xs.length === 0 ? 0 : xs.filter(pred).length / xs.length;
  const perRound = (num: number, rounds: number): number => (rounds > 0 ? num / rounds : 0);

  const comps = new Map<ScoreComponentKey, ScoreComponent>();

  // outcome
  const winStat = computeStatLine(window);
  comps.set('outcome', {
    key: 'outcome',
    ...meta.outcome,
    weight: w.outcome,
    effectiveWeight: 0,
    available: true,
    rawValue: winStat.winRate,
    normalized: smoothedRate(winStat.wins, winStat.matches, 0.5, 5) * 100,
    note: 'Smoothed win rate toward 50% with 5 pseudo-matches.',
  });

  // combat
  const combatH = history.filter((r) => r.roundsPlayed > 0).map((r) => (r.kills - r.deaths) / r.roundsPlayed);
  const wRounds = sum(window, (r) => r.roundsPlayed);
  const combatRaw = perRound(sum(window, (r) => r.kills) - sum(window, (r) => r.deaths), wRounds);
  comps.set('combat', {
    key: 'combat',
    ...meta.combat,
    weight: w.combat,
    effectiveWeight: 0,
    available: true,
    rawValue: combatRaw,
    normalized: zNormalize(combatRaw, combatH),
    note: baseNote,
  });

  // impact
  const hasCs = (r: PlayerMatchRecord): boolean => r.combatScore !== null;
  if (frac(window, hasCs) >= 0.8 && frac(history, hasCs) >= 0.8) {
    const wCs = window.filter(hasCs);
    const raw = perRound(sum(wCs, (r) => r.combatScore as number), sum(wCs, (r) => r.roundsPlayed));
    const series = history.filter((r) => hasCs(r) && r.roundsPlayed > 0).map((r) => (r.combatScore as number) / r.roundsPlayed);
    comps.set('impact', {
      key: 'impact',
      ...meta.impact,
      weight: w.impact,
      effectiveWeight: 0,
      available: true,
      rawValue: raw,
      normalized: zNormalize(raw, series),
      note: `${baseNote} Riot Performance Score is not available from the API, so combat score is used.`,
    });
  } else {
    comps.set('impact', unavailableComponent('impact', 'Combat score missing for too many matches.'));
  }

  // objective
  const hasRd = (r: PlayerMatchRecord): boolean => r.plants !== null;
  if (frac(window, hasRd) >= 0.8 && frac(history, hasRd) >= 0.8) {
    const obj = (r: PlayerMatchRecord): number => r.assists + (r.plants ?? 0) + (r.defuses ?? 0);
    const wRd = window.filter(hasRd);
    const raw = perRound(sum(wRd, obj), sum(wRd, (r) => r.roundsPlayed));
    const series = history.filter((r) => hasRd(r) && r.roundsPlayed > 0).map((r) => obj(r) / r.roundsPlayed);
    comps.set('objective', {
      key: 'objective',
      ...meta.objective,
      weight: w.objective,
      effectiveWeight: 0,
      available: true,
      rawValue: raw,
      normalized: zNormalize(raw, series),
      note: baseNote,
    });
  } else {
    comps.set('objective', unavailableComponent('objective', 'Round-level data missing for too many matches.'));
  }

  const components = keys.map((k) => comps.get(k) as ScoreComponent);
  const totalW = components.filter((c) => c.available).reduce((s, c) => s + c.weight, 0);
  for (const c of components) c.effectiveWeight = c.available && totalW > 0 ? c.weight / totalW : 0;
  const score = components.reduce((s, c) => s + (c.normalized ?? 0) * c.effectiveWeight, 0);

  return {
    ...base,
    available: true,
    reason: null,
    score: Math.round(score * 10) / 10,
    coverage: totalW,
    components,
  };
}
