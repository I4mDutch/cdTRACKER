import { describe, expect, it } from 'vitest';
import type { PlayerMatchRecord } from '@va/shared';
import {
  computeStatLine,
  computeTrend,
  filterRecords,
  groupStats,
  smoothedRate,
  wilsonInterval,
} from '../src/aggregate/index.js';

let counter = 0;
function makeRecord(overrides: Partial<PlayerMatchRecord> = {}): PlayerMatchRecord {
  counter++;
  return {
    matchId: `m${String(counter).padStart(3, '0')}`,
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
    ...overrides,
  };
}

describe('wilsonInterval', () => {
  it('returns null for n <= 0', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(0, -1)).toBeNull();
  });
  it('matches known value for 5/10 at z=1.96', () => {
    const i = wilsonInterval(5, 10)!;
    expect(i.low).toBeCloseTo(0.2366, 3);
    expect(i.high).toBeCloseTo(0.7634, 3);
  });
  it('clamps to [0,1]', () => {
    const all = wilsonInterval(10, 10)!;
    expect(all.high).toBe(1);
    expect(all.low).toBeGreaterThan(0.6);
    const none = wilsonInterval(0, 10)!;
    expect(none.low).toBe(0);
  });
});

describe('smoothedRate', () => {
  it('pulls toward prior', () => {
    // (3 + 0.5*5) / (4 + 5) = 5.5/9
    expect(smoothedRate(3, 4, 0.5, 5)).toBeCloseTo(5.5 / 9, 10);
  });
  it('returns prior when no data and no weight', () => {
    expect(smoothedRate(0, 0, 0.42, 0)).toBe(0.42);
  });
  it('returns prior when n = 0', () => {
    expect(smoothedRate(0, 0, 0.42, 5)).toBeCloseTo(0.42, 10);
  });
});

describe('filterRecords', () => {
  const a = makeRecord({ agentId: 'jett', mapId: 'ascent', queueId: 'competitive', patch: '8.11', startedAt: '2025-01-03T00:00:00Z' });
  const b = makeRecord({ agentId: 'sage', mapId: 'bind', queueId: 'unrated', patch: '8.10', startedAt: '2025-01-01T00:00:00Z' });
  const c = makeRecord({ agentId: 'jett', mapId: 'bind', queueId: 'competitive', patch: '8.11', startedAt: '2025-01-02T00:00:00Z' });
  const input = [a, b, c];

  it('sorts ascending without mutating input', () => {
    const out = filterRecords(input, {});
    expect(out.map((r) => r.matchId)).toEqual([b.matchId, c.matchId, a.matchId]);
    expect(input.map((r) => r.matchId)).toEqual([a.matchId, b.matchId, c.matchId]);
  });
  it('filters by each field', () => {
    expect(filterRecords(input, { agentId: 'sage' })).toEqual([b]);
    expect(filterRecords(input, { mapId: 'bind' }).map((r) => r.matchId)).toEqual([b.matchId, c.matchId]);
    expect(filterRecords(input, { queueId: 'competitive' }).map((r) => r.matchId)).toEqual([c.matchId, a.matchId]);
    expect(filterRecords(input, { patch: '8.10' })).toEqual([b]);
  });
  it('ignores undefined and empty-string fields', () => {
    expect(filterRecords(input, { agentId: '', mapId: undefined })).toHaveLength(3);
  });
  it('from is inclusive, to is exclusive', () => {
    const out = filterRecords(input, { from: '2025-01-02T00:00:00Z', to: '2025-01-03T00:00:00Z' });
    expect(out).toEqual([c]);
  });
  it('lastN keeps most recent after other filters', () => {
    expect(filterRecords(input, { lastN: 2 }).map((r) => r.matchId)).toEqual([c.matchId, a.matchId]);
    // competitive = c, a; last 1 = a
    expect(filterRecords(input, { queueId: 'competitive', lastN: 1 })).toEqual([a]);
    expect(filterRecords(input, { lastN: 10 })).toHaveLength(3);
  });
  it('tie-breaks equal startedAt by matchId', () => {
    const x = makeRecord({ matchId: 'zzz', startedAt: '2025-02-01T00:00:00Z' });
    const y = makeRecord({ matchId: 'aaa', startedAt: '2025-02-01T00:00:00Z' });
    expect(filterRecords([x, y], {}).map((r) => r.matchId)).toEqual(['aaa', 'zzz']);
  });
});

describe('computeStatLine', () => {
  it('handles empty input', () => {
    const s = computeStatLine([]);
    expect(s.matches).toBe(0);
    expect(s.wins + s.losses + s.draws + s.rounds + s.kills + s.deaths + s.assists).toBe(0);
    for (const k of ['winRate', 'winRateInterval', 'kd', 'kda', 'killsPerRound', 'deathsPerRound', 'assistsPerRound', 'acs', 'adr', 'headshotPct', 'firstKillsPerRound', 'firstDeathsPerRound', 'firstDuelWinRate'] as const) {
      expect(s[k]).toBeNull();
    }
    expect(s.zeroDeaths).toBe(false);
    expect(s.coverage).toEqual({ combatScore: 0, roundData: 0, roundDataRounds: 0, firstDuel: 0, firstDuelRounds: 0 });
  });

  it('computes basic line with hand-checked values', () => {
    const recs = [
      makeRecord({ outcome: 'win', roundsPlayed: 20, kills: 20, deaths: 10, assists: 5, combatScore: 5000, damageDealt: 3200 }),
      makeRecord({ outcome: 'loss', roundsPlayed: 20, kills: 10, deaths: 20, assists: 10, combatScore: 3000, damageDealt: 2000 }),
    ];
    const s = computeStatLine(recs);
    expect(s.matches).toBe(2);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.winRate).toBe(0.5);
    expect(s.winRateInterval).not.toBeNull();
    expect(s.rounds).toBe(40);
    // kills 30 / deaths 30
    expect(s.kd).toBe(1);
    // (30 + 15) / 30
    expect(s.kda).toBe(1.5);
    expect(s.zeroDeaths).toBe(false);
    expect(s.killsPerRound).toBe(30 / 40);
    expect(s.deathsPerRound).toBe(30 / 40);
    expect(s.assistsPerRound).toBe(15 / 40);
    // acs = 8000 / 40
    expect(s.acs).toBe(200);
    // adr = 5200 / 40
    expect(s.adr).toBe(130);
    // hs 20 / (20+60+20)
    expect(s.headshotPct).toBeCloseTo(0.2, 10);
    // fk 4 / 40
    expect(s.firstKillsPerRound).toBe(0.1);
    expect(s.firstDeathsPerRound).toBe(0.1);
    expect(s.firstDuelWinRate).toBe(0.5);
    expect(s.coverage).toEqual({ combatScore: 2, roundData: 2, roundDataRounds: 40, firstDuel: 2, firstDuelRounds: 40 });
  });

  it('counts draws as non-wins', () => {
    const s = computeStatLine([makeRecord({ outcome: 'win' }), makeRecord({ outcome: 'draw' })]);
    expect(s.draws).toBe(1);
    expect(s.winRate).toBe(0.5);
  });

  it('zero deaths with kills: kd = kills, zeroDeaths true', () => {
    const s = computeStatLine([makeRecord({ kills: 12, deaths: 0, assists: 3 })]);
    expect(s.kd).toBe(12);
    expect(s.kda).toBe(15);
    expect(s.zeroDeaths).toBe(true);
  });

  it('zero deaths and zero kills: kd null, zeroDeaths false', () => {
    const s = computeStatLine([makeRecord({ kills: 0, deaths: 0, assists: 0 })]);
    expect(s.kd).toBeNull();
    expect(s.kda).toBeNull();
    expect(s.zeroDeaths).toBe(false);
  });

  it('zero deaths, zero kills, some assists: kd null, kda = assists', () => {
    const s = computeStatLine([makeRecord({ kills: 0, deaths: 0, assists: 4 })]);
    expect(s.kd).toBeNull();
    expect(s.kda).toBe(4);
  });

  it('all-null combatScore gives null acs and zero coverage', () => {
    const s = computeStatLine([makeRecord({ combatScore: null }), makeRecord({ combatScore: null })]);
    expect(s.acs).toBeNull();
    expect(s.coverage.combatScore).toBe(0);
  });

  it('acs only uses rounds from matches with combatScore', () => {
    const s = computeStatLine([
      makeRecord({ combatScore: 4000, roundsPlayed: 20 }),
      makeRecord({ combatScore: null, roundsPlayed: 30 }),
    ]);
    // 4000 / 20
    expect(s.acs).toBe(200);
    expect(s.coverage.combatScore).toBe(1);
    expect(s.rounds).toBe(50);
  });

  it('round-derived stats only cover matches with round data', () => {
    const s = computeStatLine([
      makeRecord({ roundsPlayed: 20, damageDealt: 3000, headshots: 10, bodyshots: 10, legshots: 0, firstKills: 3, firstDeaths: 1 }),
      makeRecord({ roundsPlayed: 30, damageDealt: null, headshots: null, bodyshots: null, legshots: null, firstKills: null, firstDeaths: null }),
    ]);
    // adr = 3000 / 20 (the 30-round match without data is excluded)
    expect(s.adr).toBe(150);
    expect(s.headshotPct).toBe(0.5);
    expect(s.firstKillsPerRound).toBe(3 / 20);
    expect(s.firstDeathsPerRound).toBe(1 / 20);
    expect(s.firstDuelWinRate).toBe(0.75);
    expect(s.coverage).toEqual({ combatScore: 2, roundData: 1, roundDataRounds: 20, firstDuel: 1, firstDuelRounds: 20 });
    // per-round kills still use all rounds: 20 / 50
    expect(s.killsPerRound).toBe(20 / 50);
  });

  it('headshotPct and firstDuelWinRate null when denominators are zero', () => {
    const s = computeStatLine([makeRecord({ headshots: 0, bodyshots: 0, legshots: 0, firstKills: 0, firstDeaths: 0 })]);
    expect(s.headshotPct).toBeNull();
    expect(s.firstDuelWinRate).toBeNull();
    expect(s.firstKillsPerRound).toBe(0);
  });
});

describe('groupStats', () => {
  const recs = [
    makeRecord({ agentId: 'sage', patch: '8.11' }),
    makeRecord({ agentId: 'jett', patch: '8.11' }),
    makeRecord({ agentId: 'jett', patch: null }),
    makeRecord({ agentId: 'jett', patch: '8.10' }),
    makeRecord({ agentId: 'omen', patch: null }),
  ];

  it('sorts by matches desc then key asc, with lowSample flag', () => {
    const g = groupStats(recs, 'agentId', { lowSampleMatches: 2 });
    expect(g.map((x) => [x.key, x.stat.matches, x.lowSample])).toEqual([
      ['jett', 3, false],
      ['omen', 1, true],
      ['sage', 1, true],
    ]);
  });

  it('groups null patch under unknown', () => {
    const g = groupStats(recs, 'patch');
    expect(g.map((x) => [x.key, x.stat.matches])).toEqual([
      ['8.11', 2],
      ['unknown', 2],
      ['8.10', 1],
    ].sort((p, q) => (q[1] as number) - (p[1] as number) || (p[0] as string).localeCompare(q[0] as string)));
    expect(g.find((x) => x.key === 'unknown')!.stat.matches).toBe(2);
  });

  it('uses default config threshold of 5 matches', () => {
    const g = groupStats(recs, 'queueId');
    expect(g).toHaveLength(1);
    expect(g[0]!.stat.matches).toBe(5);
    expect(g[0]!.lowSample).toBe(false);
    expect(groupStats(recs.slice(0, 4), 'queueId')[0]!.lowSample).toBe(true);
  });
});

describe('computeTrend', () => {
  it('throws RangeError for window < 1', () => {
    expect(() => computeTrend([], 'winRate', 0)).toThrow(RangeError);
  });

  it('returns empty for no records', () => {
    expect(computeTrend([], 'kd', 3)).toEqual([]);
  });

  it('uses smaller windows for early points and sorts ascending', () => {
    const r1 = makeRecord({ startedAt: '2025-01-01T00:00:00Z', outcome: 'win' });
    const r2 = makeRecord({ startedAt: '2025-01-02T00:00:00Z', outcome: 'loss' });
    const r3 = makeRecord({ startedAt: '2025-01-03T00:00:00Z', outcome: 'win' });
    const t = computeTrend([r3, r1, r2], 'winRate', 2);
    expect(t.map((p) => p.matchId)).toEqual([r1.matchId, r2.matchId, r3.matchId]);
    expect(t.map((p) => p.index)).toEqual([0, 1, 2]);
    // [W]=1, [W,L]=0.5, [L,W]=0.5
    expect(t.map((p) => p.value)).toEqual([1, 0.5, 0.5]);
    expect(t.map((p) => p.sample)).toEqual([1, 2, 2]);
  });

  it('computes kd over the window aggregate', () => {
    const recs = [
      makeRecord({ kills: 10, deaths: 10 }),
      makeRecord({ kills: 20, deaths: 10 }),
      makeRecord({ kills: 5, deaths: 10 }),
    ];
    const t = computeTrend(recs, 'kd', 2);
    // 10/10, 30/20, 25/20
    expect(t.map((p) => p.value)).toEqual([1, 1.5, 1.25]);
  });

  it('gives null value and sample 0 where the metric is unavailable', () => {
    const recs = [
      makeRecord({ combatScore: null }),
      makeRecord({ combatScore: 4000, roundsPlayed: 20 }),
      makeRecord({ combatScore: 2000, roundsPlayed: 20 }),
    ];
    const t = computeTrend(recs, 'acs', 2);
    expect(t[0]!.value).toBeNull();
    expect(t[0]!.sample).toBe(0);
    // window [null, 4000]: 4000 / 20
    expect(t[1]!.value).toBe(200);
    expect(t[1]!.sample).toBe(1);
    // window [4000, 2000]: 6000 / 40
    expect(t[2]!.value).toBe(150);
    expect(t[2]!.sample).toBe(2);
  });

  it('adr sample counts only matches with round data', () => {
    const recs = [
      makeRecord({ damageDealt: null }),
      makeRecord({ damageDealt: 3000, roundsPlayed: 20 }),
    ];
    const t = computeTrend(recs, 'adr', 5);
    expect(t.map((p) => p.sample)).toEqual([0, 1]);
    expect(t[1]!.value).toBe(150);
  });

  it('supports killsPerRound and deathsPerRound', () => {
    const recs = [makeRecord({ kills: 10, deaths: 20, roundsPlayed: 20 })];
    expect(computeTrend(recs, 'killsPerRound', 3)[0]!.value).toBe(0.5);
    expect(computeTrend(recs, 'deathsPerRound', 3)[0]!.value).toBe(1);
  });
});
