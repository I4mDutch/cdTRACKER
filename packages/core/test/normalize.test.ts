import { describe, expect, it } from 'vitest';
import { normalizeMatch, parsePatch, toPlayerRecord } from '../src/normalize/index.js';
import { A, B, C, buildMatch, kill, round, type Raw } from './fixtures/normalize/builder.js';

const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);
function ok(raw: unknown, cfg?: Parameters<typeof normalizeMatch>[1]) {
  const r = normalizeMatch(raw, cfg);
  if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r.issues));
  return r;
}

describe('parsePatch', () => {
  it('parses release strings', () => {
    expect(parsePatch('release-08.11-shipping-6-2545312')).toBe('8.11');
    expect(parsePatch('release-09.06-shipping-1')).toBe('9.06');
    expect(parsePatch('release-10.02-shipping-1')).toBe('10.02');
  });
  it('returns null otherwise', () => {
    expect(parsePatch(null)).toBeNull();
    expect(parsePatch(undefined)).toBeNull();
    expect(parsePatch('garbage')).toBeNull();
  });
});

describe('normalizeMatch', () => {
  it('round-trips a valid match', () => {
    const r = ok(buildMatch());
    expect(r.issues).toEqual([]);
    const m = r.match;
    expect(m.matchId).toBe('m1');
    expect(m.startedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(m.durationMs).toBe(1_800_000);
    expect(m.patch).toBe('8.11');
    expect(m.seasonId).toBe('season-1');
    expect(m.roundsPlayed).toBe(18);
    expect(m.rounds).toHaveLength(18);
    expect(m.rounds[0]!.roundNumber).toBe(1);
    expect(m.participants).toHaveLength(3);
    expect(m.participants[0]).toMatchObject({ puuid: A, agentId: 'agent-1', kills: 15, combatScore: 4000 });
    expect(m.excluded).toBeNull();
  });

  describe('fatal cases', () => {
    const cases: [string, (m: Raw) => unknown][] = [
      ['non-object', () => 'nope'],
      ['null', () => null],
      ['missing matchInfo', (m) => ({ ...m, matchInfo: undefined })],
      ['empty matchId', (m) => ({ ...m, matchInfo: { ...m.matchInfo, matchId: '' } })],
      ['missing mapId', (m) => ({ ...m, matchInfo: { ...m.matchInfo, mapId: undefined } })],
      ['bad gameStartMillis', (m) => ({ ...m, matchInfo: { ...m.matchInfo, gameStartMillis: NaN } })],
      ['bad queueId', (m) => ({ ...m, matchInfo: { ...m.matchInfo, queueId: 5 } })],
      ['bad isCompleted', (m) => ({ ...m, matchInfo: { ...m.matchInfo, isCompleted: 'yes' } })],
      ['players not array', (m) => ({ ...m, players: {} })],
      ['players empty', (m) => ({ ...m, players: [] })],
      ['player without puuid', (m) => ({ ...m, players: [{ teamId: 'Red', characterId: 'x' }] })],
      ['player without teamId', (m) => ({ ...m, players: [{ puuid: 'p', characterId: 'x' }] })],
      ['player without characterId', (m) => ({ ...m, players: [{ puuid: 'p', teamId: 'Red' }] })],
    ];
    for (const [name, mutate] of cases) {
      it(name, () => {
        const r = normalizeMatch(mutate(buildMatch()));
        expect(r.ok).toBe(false);
        expect(r.issues[0]!.severity).toBe('fatal');
      });
    }
  });

  it('missing stats gives warning and nulls', () => {
    const raw = buildMatch();
    raw.players[1].stats = null;
    raw.players[2].stats = { score: -1, roundsPlayed: 18, kills: 'x', deaths: 3, assists: 1 };
    const r = ok(raw);
    expect(codes(r).filter((c) => c === 'missing_player_stats')).toHaveLength(2);
    expect(r.match.participants[1]).toMatchObject({ kills: null, deaths: null, assists: null, combatScore: null, roundsPlayed: null });
    expect(r.match.participants[2]).toMatchObject({ kills: null, combatScore: null, deaths: 3, assists: 1, roundsPlayed: 18 });
  });

  it('null teams gives [] and warning', () => {
    const raw = buildMatch({ teams: null });
    const r = ok(raw);
    expect(r.match.teams).toEqual([]);
    expect(codes(r)).toContain('missing_teams');
    expect(r.match.roundsPlayed).toBe(18);
    expect(r.match.excluded).toBe('inconsistent_teams');
  });

  it('missing roundResults gives rounds [] and null round-derived record fields', () => {
    const raw = buildMatch();
    delete raw.roundResults;
    const r = ok(raw);
    expect(r.match.rounds).toEqual([]);
    expect(codes(r)).toContain('missing_round_data');
    const rec = toPlayerRecord(r.match, A)!;
    expect(rec).toMatchObject({
      damageDealt: null, headshots: null, bodyshots: null, legshots: null,
      firstKills: null, firstDeaths: null, plants: null, defuses: null,
      roundsWon: 13, roundsLost: 5, performanceScore: null,
    });
    expect(codes(r)).not.toContain('team_round_mismatch');
  });

  it('empty roundResults gives rounds [] and warning', () => {
    const r = ok(buildMatch({ roundResults: [] }));
    expect(r.match.rounds).toEqual([]);
    expect(codes(r)).toContain('missing_round_data');
  });

  it('dedupes duplicated kill events and sorts kills', () => {
    const raw = buildMatch();
    raw.roundResults[0] = round(0, 'Red', {
      playerStats: [
        { puuid: A, kills: [kill(A, C, 5000), kill(A, B, 9000)], damage: [], score: 0 },
        { puuid: C, kills: [kill(A, C, 5000), kill(C, B, 2000)], damage: [], score: 0 },
      ],
    });
    const r = ok(raw);
    const kills = r.match.rounds[0]!.kills;
    expect(kills.map((k) => k.roundTimeMs)).toEqual([2000, 5000, 9000]);
  });

  it('warns on team_round_mismatch', () => {
    const raw = buildMatch();
    raw.teams[0].roundsWon = 12;
    const r = ok(raw);
    expect(codes(r)).toContain('team_round_mismatch');
  });

  it('skips malformed rounds and kills with warnings', () => {
    const raw = buildMatch();
    raw.roundResults[0] = 'junk';
    raw.roundResults[1].playerStats = [{ puuid: A, kills: [{ killer: A }], damage: [{ damage: 'x' }] }, 7];
    const r = ok(raw);
    expect(r.match.rounds).toHaveLength(17);
    expect(codes(r)).toEqual(expect.arrayContaining(['malformed_round', 'malformed_kill', 'malformed_damage', 'malformed_round_player_stats']));
  });

  describe('exclusion', () => {
    it('incomplete', () => {
      const raw = buildMatch();
      raw.matchInfo.isCompleted = false;
      expect(ok(raw).match.excluded).toBe('incomplete');
    });
    it('remake', () => {
      expect(ok(buildMatch({}, 3, 0)).match.excluded).toBe('remake');
    });
    it('remake respects config', () => {
      expect(ok(buildMatch({}, 3, 0), { supportedQueues: ['competitive'], remakeMaxRounds: 2 }).match.excluded).toBeNull();
    });
    it('inconsistent teams: one team', () => {
      const raw = buildMatch();
      raw.teams = [raw.teams[0]];
      expect(ok(raw).match.excluded).toBe('inconsistent_teams');
    });
    it('inconsistent teams: both won', () => {
      const raw = buildMatch();
      raw.teams[1].won = true;
      expect(ok(raw).match.excluded).toBe('inconsistent_teams');
    });
    it('unsupported queue', () => {
      const raw = buildMatch();
      raw.matchInfo.queueId = 'unrated';
      expect(ok(raw).match.excluded).toBe('unsupported_queue');
    });
    it('incomplete wins over remake', () => {
      const raw = buildMatch({}, 2, 0);
      raw.matchInfo.isCompleted = false;
      expect(ok(raw).match.excluded).toBe('incomplete');
    });
    it('draw is not excluded', () => {
      const raw = buildMatch({}, 12, 12);
      raw.teams[0].won = false;
      raw.teams[1].won = false;
      const r = ok(raw);
      expect(r.match.excluded).toBeNull();
      expect(toPlayerRecord(r.match, A)!.outcome).toBe('draw');
    });
  });

  it('does not mutate input', () => {
    const raw = buildMatch();
    raw.roundResults[0] = round(0, 'Red', {
      playerStats: [{ puuid: A, kills: [kill(A, C, 9000), kill(A, B, 1000)], damage: [], score: 0 }],
    });
    const snapshot = structuredClone(raw);
    const r = ok(raw);
    toPlayerRecord(r.match, A);
    expect(raw).toEqual(snapshot);
  });
});

describe('toPlayerRecord', () => {
  it('returns null for non-participant', () => {
    expect(toPlayerRecord(ok(buildMatch()).match, 'nobody')).toBeNull();
  });

  it('returns null when K/D/A unavailable', () => {
    const raw = buildMatch();
    raw.players[0].stats = null;
    expect(toPlayerRecord(ok(raw).match, A)).toBeNull();
  });

  it('computes outcome and rounds', () => {
    const m = ok(buildMatch()).match;
    expect(toPlayerRecord(m, A)).toMatchObject({ outcome: 'win', roundsWon: 13, roundsLost: 5, roundsPlayed: 18, kills: 15, deaths: 10, assists: 3, combatScore: 4000, patch: '8.11' });
    expect(toPlayerRecord(m, C)).toMatchObject({ outcome: 'loss', roundsWon: 5, roundsLost: 13 });
  });

  it('falls back to rounds when teams missing', () => {
    const m = ok(buildMatch({ teams: null })).match;
    expect(toPlayerRecord(m, A)).toMatchObject({ outcome: 'draw', roundsWon: 13, roundsLost: 5 });
  });

  it('handles zero deaths', () => {
    const raw = buildMatch();
    raw.players[0].stats.deaths = 0;
    expect(toPlayerRecord(ok(raw).match, A)).toMatchObject({ deaths: 0 });
  });

  it('computes round-derived stats with unsorted kills', () => {
    const raw = buildMatch();
    raw.roundResults[0] = round(0, 'Red', {
      bombPlanter: A,
      bombDefuser: null,
      playerStats: [
        { puuid: A, kills: [kill(A, B, 9000), kill(A, C, 3000)], damage: [
          { receiver: C, damage: 150, headshots: 1, bodyshots: 1, legshots: 0 },
          { receiver: B, damage: 50, headshots: 0, bodyshots: 0, legshots: 2 },
        ], score: 0 },
        { puuid: C, kills: [kill(C, A, 1000)], damage: [{ receiver: A, damage: 100, headshots: 0, bodyshots: 3, legshots: 0 }], score: 0 },
      ],
    });
    raw.roundResults[1] = round(1, 'Red', {
      bombDefuser: C,
      playerStats: [
        { puuid: A, kills: [kill(A, C, 4000)], damage: [{ receiver: C, damage: 100, headshots: 1, bodyshots: 0, legshots: 0 }], score: 0 },
      ],
    });
    raw.roundResults[2] = round(2, 'Red', {
      playerStats: [{ puuid: C, kills: [kill(C, A, 500), kill(A, C, 100)], damage: [], score: 0 }],
    });
    const m = ok(raw).match;
    const rec = toPlayerRecord(m, A)!;
    // round1 first kill is C (t=1000) -> A first death; round2 first kill A; round3 first kill A (t=100)
    expect(rec.firstKills).toBe(2);
    expect(rec.firstDeaths).toBe(1);
    expect(rec.plants).toBe(1);
    expect(rec.defuses).toBe(0);
    expect(rec.damageDealt).toBe(300);
    expect(rec.headshots).toBe(2);
    expect(rec.bodyshots).toBe(1);
    expect(rec.legshots).toBe(2);
    const recC = toPlayerRecord(m, C)!;
    expect(recC.defuses).toBe(1);
    expect(recC.firstKills).toBe(1);
    expect(recC.firstDeaths).toBe(2);
    expect(recC.damageDealt).toBe(100);
    // B has no entries: sums are 0, not null
    expect(toPlayerRecord(m, B)).toMatchObject({ damageDealt: 0, firstKills: 0, firstDeaths: 0 });
  });
});
