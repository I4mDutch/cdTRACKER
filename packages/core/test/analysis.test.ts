import { describe, expect, it } from 'vitest';
import type { PlayerMatchRecord } from '@va/shared';
import { DEFAULT_ANALYSIS_CONFIG, DEFAULT_SCORE_CONFIG } from '../src/config.js';
import { computeAnalyzerScore, generateFindings, type NameLookup } from '../src/analysis/index.js';

let counter = 0;
function rec(o: Partial<PlayerMatchRecord> = {}): PlayerMatchRecord {
  counter++;
  return {
    matchId: `m${String(counter).padStart(4, '0')}`,
    source: 'riot',
    puuid: 'p1',
    startedAt: new Date(Date.UTC(2025, 0, 1, 0, counter)).toISOString(),
    mapId: 'ascent',
    queueId: 'competitive',
    patch: '8.11',
    agentId: 'jett',
    teamId: 'Blue',
    outcome: 'win',
    roundsPlayed: 20,
    roundsWon: 13,
    roundsLost: 7,
    kills: 10,
    deaths: 10,
    assists: 5,
    combatScore: 4000,
    damageDealt: 3000,
    headshots: 10,
    bodyshots: 30,
    legshots: 10,
    firstKills: 2,
    firstDeaths: 2,
    plants: 0,
    defuses: 0,
    performanceScore: null,
    ...o,
  };
}

/** n matches with `wins` wins (wins first), on a given agent/map. */
function group(n: number, wins: number, o: Partial<PlayerMatchRecord> = {}): PlayerMatchRecord[] {
  return Array.from({ length: n }, (_, i) => rec({ outcome: i < wins ? 'win' : 'loss', ...o }));
}

/** Deterministic seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Interleave groups so time order doesn't matter for findings but is varied. */
function shuffle<T>(xs: T[], seed: number): T[] {
  const r = rng(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const names: NameLookup = { agents: { jett: 'Jett', sova: 'Sova', reyna: 'Reyna' }, maps: { ascent: 'Ascent', split: 'Split' } };
const FORBIDDEN = /positioning|crosshair|MMR|rank\b/i;

describe('generateFindings', () => {
  it('returns [] with too few matches', () => {
    expect(generateFindings(group(7, 0), names)).toEqual([]);
  });

  it('flags a planted weak map with correct value, baseline, sample and hedged prefix', () => {
    const weak = group(16, 5, { mapId: 'split' });
    const rest = group(50, 27, { mapId: 'ascent' });
    const findings = generateFindings(shuffle([...weak, ...rest], 1), names);
    const f = findings.find((x) => x.type === 'map_win_rate' && x.subject.id === 'split');
    expect(f).toBeDefined();
    expect(f!.value).toBeCloseTo(5 / 16, 10);
    expect(f!.baseline).toBeCloseTo(27 / 50, 10);
    expect(f!.sampleMatches).toBe(16);
    expect(f!.sampleRounds).toBe(320);
    expect(f!.evidence).toBe('moderate');
    expect(f!.summary).toBe(
      'Worth reviewing: your win rate on Split is 31.3% across 16 matches, vs 54.0% in your other matches.',
    );
    expect(f!.id).toBe('map_win_rate:map:split');
    expect(f!.analysisVersion).toBe(DEFAULT_ANALYSIS_CONFIG.version);
    expect(f!.baselineLabel).toBe('your other matches in this filter window');
    expect(f!.matchIds.length).toBe(16);
    expect(f!.method).toContain('Wilson');
  });

  it('does not flag a 3-match agent with 0 wins (sample gate)', () => {
    const records = [...group(3, 0, { agentId: 'sova' }), ...group(30, 20, { agentId: 'jett' })];
    const findings = generateFindings(records, names);
    expect(findings.find((f) => f.subject.id === 'sova')).toBeUndefined();
  });

  it('skips subjects whose other-matches baseline is too small', () => {
    // all matches but 5 are on one agent; that agent's baseline has only 5 matches
    const records = [...group(30, 5, { agentId: 'jett' }), ...group(5, 5, { agentId: 'sova' })];
    const findings = generateFindings(records, names);
    expect(findings.find((f) => f.subject.id === 'jett')).toBeUndefined();
  });

  it('assigns strong / moderate / low evidence appropriately', () => {
    // strong: 2/20 vs 60% baseline
    const strong = generateFindings([...group(20, 2, { agentId: 'sova' }), ...group(30, 18, { agentId: 'jett' })], names).find(
      (f) => f.type === 'agent_win_rate' && f.subject.id === 'sova',
    );
    expect(strong?.evidence).toBe('strong');
    expect(strong?.summary.startsWith('Consistent pattern:')).toBe(true);

    // low: 3/8 vs 60% baseline, interval overlaps, n < 2*min
    const low = generateFindings([...group(8, 3, { agentId: 'sova' }), ...group(30, 18, { agentId: 'jett' })], names).find(
      (f) => f.type === 'agent_win_rate' && f.subject.id === 'sova',
    );
    expect(low?.evidence).toBe('low');
    expect(low?.summary.startsWith('Possible focus:')).toBe(true);

    // moderate: 16 matches, interval overlaps baseline
    const mod = generateFindings([...group(16, 7, { agentId: 'sova' }), ...group(30, 18, { agentId: 'jett' })], names).find(
      (f) => f.type === 'agent_win_rate' && f.subject.id === 'sova',
    );
    expect(mod?.evidence).toBe('moderate');
  });

  it('flags deaths_per_round on a planted agent', () => {
    const records = [
      ...group(10, 5, { agentId: 'reyna', deaths: 15 }),
      ...group(30, 15, { agentId: 'jett', deaths: 10 }),
    ];
    const f = generateFindings(shuffle(records, 2), names).find((x) => x.type === 'deaths_per_round');
    expect(f).toBeDefined();
    expect(f!.subject).toEqual({ kind: 'agent', id: 'reyna' });
    expect(f!.metric).toBe('deathsPerRound');
    expect(f!.direction).toBe('above');
    expect(f!.value).toBeCloseTo(0.75, 10);
    expect(f!.baseline).toBeCloseTo(0.5, 10);
    expect(f!.sampleRounds).toBe(200);
    expect(f!.evidence).toBe('moderate');
    expect(f!.summary).toContain('0.75');
    expect(f!.summary).toContain('0.50');
  });

  it('flags assists_per_round and first_duel on planted agents', () => {
    const records = [
      ...group(10, 5, { agentId: 'sova', assists: 2, firstKills: 1, firstDeaths: 4 }),
      ...group(30, 15, { agentId: 'jett', assists: 5, firstKills: 3, firstDeaths: 2 }),
    ];
    const findings = generateFindings(records, names);
    const a = findings.find((x) => x.type === 'assists_per_round');
    const d = findings.find((x) => x.type === 'first_duel');
    expect(a?.direction).toBe('below');
    expect(d?.direction).toBe('below');
    expect(d!.value).toBeCloseTo(0.2, 10);
    expect(d!.baseline).toBeCloseTo(0.6, 10);
    expect(d!.sampleRounds).toBe(200);
  });

  it('does not produce first_duel without enough opening duels', () => {
    const records = [
      ...group(10, 5, { agentId: 'sova', firstKills: 0, firstDeaths: 2 }),
      ...group(30, 15, { agentId: 'jett', firstKills: 3, firstDeaths: 2 }),
    ];
    expect(generateFindings(records, names).find((x) => x.type === 'first_duel')).toBeUndefined();
  });

  it('sorts by evidence, caps at maxFindings, and is deterministic', () => {
    const records = shuffle(
      [
        ...group(20, 2, { agentId: 'sova', deaths: 16, assists: 1 }),
        ...group(16, 5, { agentId: 'reyna', mapId: 'split' }),
        ...group(30, 18, { agentId: 'jett' }),
      ],
      3,
    );
    const a = generateFindings(records, names);
    const b = generateFindings(shuffle(records, 99), names);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(2);
    const rank = { strong: 2, moderate: 1, low: 0 } as const;
    for (let i = 1; i < a.length; i++) expect(rank[a[i - 1]!.evidence]).toBeGreaterThanOrEqual(rank[a[i]!.evidence]);
    const capped = generateFindings(records, names, { ...DEFAULT_ANALYSIS_CONFIG, maxFindings: 2 });
    expect(capped).toEqual(a.slice(0, 2));
  });

  it('never uses forbidden wording', () => {
    const records = [
      ...group(20, 2, { agentId: 'sova', deaths: 16, assists: 1, firstKills: 1, firstDeaths: 4, mapId: 'split' }),
      ...group(30, 18, { agentId: 'jett' }),
    ];
    const findings = generateFindings(records, names);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.summary).not.toMatch(FORBIDDEN);
      expect(f.recommendation).not.toMatch(FORBIDDEN);
      expect(f.method).not.toMatch(FORBIDDEN);
    }
  });

  it('falls back to ids when names are missing', () => {
    const records = [...group(20, 2, { agentId: 'sova' }), ...group(30, 18, { agentId: 'jett' })];
    const f = generateFindings(records, { agents: {}, maps: {} }).find((x) => x.subject.id === 'sova');
    expect(f!.summary).toContain('sova');
  });
});

describe('computeAnalyzerScore', () => {
  function history(n: number, seed: number, o: Partial<PlayerMatchRecord> = {}): PlayerMatchRecord[] {
    const r = rng(seed);
    return Array.from({ length: n }, () => {
      const kills = 5 + Math.floor(r() * 20);
      return rec({
        outcome: r() < 0.5 ? 'win' : 'loss',
        kills,
        deaths: 5 + Math.floor(r() * 15),
        assists: Math.floor(r() * 10),
        combatScore: 2000 + Math.floor(r() * 4000),
        plants: Math.floor(r() * 3),
        defuses: Math.floor(r() * 2),
        ...o,
      });
    });
  }

  it('is unavailable with too few window matches', () => {
    const s = computeAnalyzerScore(history(5, 1));
    expect(s.available).toBe(false);
    expect(s.score).toBeNull();
    expect(s.reason).toBe('Need at least 10 matches (have 5).');
    expect(s.components).toHaveLength(4);
    for (const c of s.components) {
      expect(c.available).toBe(false);
      expect(c.normalized).toBeNull();
    }
    expect(s.formulaVersion).toBe(DEFAULT_SCORE_CONFIG.formulaVersion);
  });

  it('is unavailable with too little history', () => {
    const s = computeAnalyzerScore(history(15, 1));
    expect(s.available).toBe(false);
    expect(s.reason).toMatch(/at least 20 matches/);
    expect(s.components).toHaveLength(4);
    expect(s.historyMatches).toBe(15);
  });

  it('computes a score in 0..100 with all four components', () => {
    const s = computeAnalyzerScore(history(40, 7));
    expect(s.available).toBe(true);
    expect(s.reason).toBeNull();
    expect(s.score!).toBeGreaterThanOrEqual(0);
    expect(s.score!).toBeLessThanOrEqual(100);
    expect(s.coverage).toBeCloseTo(1, 10);
    expect(s.sampleMatches).toBe(20);
    expect(s.historyMatches).toBe(40);
    expect(s.relativeTo).toBe('own-history');
    expect(s.formulaVersion).toBe('analyzer-score-v1');
    const eff = s.components.reduce((t, c) => t + c.effectiveWeight, 0);
    expect(eff).toBeCloseTo(1, 10);
    for (const c of s.components) {
      expect(c.available).toBe(true);
      expect(c.normalized!).toBeGreaterThanOrEqual(0);
      expect(c.normalized!).toBeLessThanOrEqual(100);
    }
    expect(s.components.find((c) => c.key === 'impact')!.note).toContain('Performance Score is not available');
    // deterministic
    expect(computeAnalyzerScore(history(40, 7)).score).toBe(s.score);
  });

  it('re-normalizes weights when impact and objective are unavailable', () => {
    const s = computeAnalyzerScore(history(40, 7, { combatScore: null, plants: null, defuses: null, damageDealt: null }));
    expect(s.available).toBe(true);
    expect(s.coverage).toBeCloseTo(0.55, 10);
    const eff = s.components.reduce((t, c) => t + c.effectiveWeight, 0);
    expect(eff).toBeCloseTo(1, 10);
    const impact = s.components.find((c) => c.key === 'impact')!;
    const objective = s.components.find((c) => c.key === 'objective')!;
    expect(impact.available).toBe(false);
    expect(impact.effectiveWeight).toBe(0);
    expect(impact.normalized).toBeNull();
    expect(objective.available).toBe(false);
    expect(objective.note).toBe('Round-level data missing for too many matches.');
    expect(s.components.find((c) => c.key === 'outcome')!.effectiveWeight).toBeCloseTo(0.3 / 0.55, 10);
  });

  it('gives 50 for combat/impact/objective when history is all identical', () => {
    const s = computeAnalyzerScore(group(30, 15));
    expect(s.available).toBe(true);
    for (const k of ['combat', 'impact', 'objective']) {
      expect(s.components.find((c) => c.key === k)!.normalized).toBe(50);
    }
  });

  it('rewards a strong recent window relative to own history', () => {
    const old = history(30, 3);
    const recent = history(20, 4, { kills: 30, deaths: 4, combatScore: 7000, outcome: 'win' });
    const s = computeAnalyzerScore([...old, ...recent]);
    expect(s.score!).toBeGreaterThan(65);
    expect(s.score!).toBeLessThanOrEqual(100);
  });
});
