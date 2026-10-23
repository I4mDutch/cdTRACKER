import { describe, expect, it } from 'vitest';
import type { PlayerMatchRecord } from '@va/shared';
import { computeStatLine, computeTrend, filterRecords } from '../src/aggregate/index.js';
import { generateFindings, type NameLookup } from '../src/analysis/index.js';
import { MANUAL_ID_PREFIX, manualExclusion, manualOutcome } from '../src/manual/index.js';

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

/** A manual entry that only knows ADR (no first-duel data, no shot data). */
const adrOnly = (o: Partial<PlayerMatchRecord> = {}) =>
  rec({
    source: 'manual',
    matchId: `${MANUAL_ID_PREFIX}${counter + 1}`,
    headshots: null,
    bodyshots: null,
    legshots: null,
    firstKills: null,
    firstDeaths: null,
    plants: null,
    defuses: null,
    ...o,
  });

describe('source filter', () => {
  const riot = rec();
  const manual = adrOnly();
  it('undefined returns both', () => {
    expect(filterRecords([riot, manual], {})).toHaveLength(2);
  });
  it('matches exactly', () => {
    expect(filterRecords([riot, manual], { source: 'manual' })).toEqual([manual]);
    expect(filterRecords([riot, manual], { source: 'riot' })).toEqual([riot]);
  });
});

describe('per-metric record sets', () => {
  // A: 20 rounds, damage 3000, firstKills/Deaths null, shots null.
  // B: 30 rounds, damage null, firstKills 6, firstDeaths 3, shots 10/20/10.
  const A = rec({ roundsPlayed: 20, damageDealt: 3000, firstKills: null, firstDeaths: null, headshots: null, bodyshots: null, legshots: null });
  const B = rec({ roundsPlayed: 30, damageDealt: null, firstKills: 6, firstDeaths: 3, headshots: 10, bodyshots: 20, legshots: 10 });
  const s = computeStatLine([A, B]);

  it('adr uses only records with damage', () => {
    expect(s.adr).toBe(3000 / 20); // 150, B's 30 rounds excluded
    expect(s.coverage.roundData).toBe(1);
    expect(s.coverage.roundDataRounds).toBe(20);
  });
  it('first-duel metrics use only records with both fields', () => {
    expect(s.firstKillsPerRound).toBe(6 / 30); // A's 20 rounds excluded
    expect(s.firstDeathsPerRound).toBe(3 / 30);
    expect(s.firstDuelWinRate).toBe(6 / 9);
    expect(s.coverage.firstDuel).toBe(1);
    expect(s.coverage.firstDuelRounds).toBe(30);
  });
  it('headshot pct uses only records with all three shot counts', () => {
    expect(s.headshotPct).toBe(10 / 40);
  });
  it('a record with partial shot data is skipped', () => {
    const p = rec({ headshots: 5, bodyshots: null, legshots: 5 });
    expect(computeStatLine([p]).headshotPct).toBeNull();
  });
  it('trend sample counts only contributing records', () => {
    const t = computeTrend([A, B], 'adr', 2);
    expect(t[1]!.sample).toBe(1);
    expect(t[1]!.value).toBe(150);
  });
});

describe('first_duel gating with manual records', () => {
  const names: NameLookup = { agents: { sova: 'Sova', jett: 'Jett' }, maps: {} };
  const sova = (o: Partial<PlayerMatchRecord>) => ({ agentId: 'sova', assists: 5, ...o });
  const lowDuel = { firstKills: 1, firstDeaths: 4 };

  it('manual records without first-duel data do not count toward rounds or duels', () => {
    // 10 riot sova matches: 200 rounds, 10 fk + 40 fd = 50 duels (>= 30), rate 0.2 vs 0.6 baseline.
    const riot = Array.from({ length: 10 }, (_, i) => rec(sova({ ...lowDuel, outcome: i < 5 ? 'win' : 'loss' })));
    const base = Array.from({ length: 30 }, (_, i) => rec({ firstKills: 3, firstDeaths: 2, outcome: i < 15 ? 'win' : 'loss' }));
    const withRiotOnly = generateFindings([...riot, ...base], names).find((f) => f.type === 'first_duel');
    expect(withRiotOnly).toBeDefined();
    expect(withRiotOnly!.sampleRounds).toBe(200);

    const manual = Array.from({ length: 5 }, () => adrOnly(sova({ roundsPlayed: 20 })));
    const mixed = generateFindings([...riot, ...manual, ...base], names).find((f) => f.type === 'first_duel');
    expect(mixed).toBeDefined();
    expect(mixed!.sampleRounds).toBe(200); // manual 100 rounds excluded
    expect(mixed!.method).toMatch(/ Includes 5 manual entries\.$/);
    expect(mixed!.sampleMatches).toBe(15);
  });

  it('no first_duel finding when only manual records lack duel data', () => {
    const manual = Array.from({ length: 10 }, (_, i) => adrOnly(sova({ outcome: i < 5 ? 'win' : 'loss' })));
    const base = Array.from({ length: 30 }, (_, i) => rec({ firstKills: 3, firstDeaths: 2, outcome: i < 15 ? 'win' : 'loss' }));
    expect(generateFindings([...manual, ...base], names).find((f) => f.type === 'first_duel')).toBeUndefined();
  });

  it('method has no suffix when all records are riot', () => {
    const riot = Array.from({ length: 10 }, (_, i) => rec(sova({ ...lowDuel, outcome: i < 5 ? 'win' : 'loss' })));
    const base = Array.from({ length: 30 }, (_, i) => rec({ firstKills: 3, firstDeaths: 2, outcome: i < 15 ? 'win' : 'loss' }));
    const f = generateFindings([...riot, ...base], names).find((x) => x.type === 'first_duel');
    expect(f!.method).not.toMatch(/manual/);
  });
});

describe('manualOutcome', () => {
  it('derives win / loss / draw from score', () => {
    expect(manualOutcome(13, 7)).toBe('win');
    expect(manualOutcome(7, 13)).toBe('loss');
    expect(manualOutcome(12, 12)).toBe('draw');
  });
});

describe('manualExclusion', () => {
  it('remake boundary at 4 rounds', () => {
    expect(manualExclusion('competitive', 4)).toBe('remake');
    expect(manualExclusion('competitive', 5)).toBeNull();
  });
  it('unsupported queue', () => {
    expect(manualExclusion('deathmatch', 20)).toBe('unsupported_queue');
  });
  it('remake takes precedence over unsupported queue', () => {
    expect(manualExclusion('deathmatch', 3)).toBe('remake');
  });
});
