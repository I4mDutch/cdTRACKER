import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { NormalizedMatch, PlayerMatchRecord } from '@va/shared';
import {
  createPgliteDb, schema, type Db, type ManualMatchFields, type ManualMatchRow,
  createUser, upsertRiotAccount, upsertMatch, upsertPlayerRecord, deleteUserMatchData,
  manualDedupeKey, createManualMatch, updateManualMatch, getManualMatch, deleteManualMatch,
  deleteAllManualMatches, existingManualDedupeKeys, insertManualMatches, manualRowToRecord, listUserRecords,
} from '../src/db/index.js';

let db: Db;
beforeAll(async () => {
  db = await createPgliteDb();
}, 60_000);

const fields = (over: Partial<ManualMatchFields> = {}): ManualMatchFields => ({
  startedAt: new Date('2026-03-01T12:00:00Z'), mapId: 'ascent', agentId: 'jett', queueId: 'competitive', patch: '8.11',
  roundsWon: 13, roundsLost: 7, kills: 20, deaths: 10, assists: 4,
  combatScore: null, damageDealt: null, firstKills: null, firstDeaths: null, note: null, excluded: null, ...over,
});

async function user(name = 'u'): Promise<string> {
  return (await createUser(db, { displayName: name })).id;
}

describe('manual matches CRUD', () => {
  it('create -> get -> update -> delete', async () => {
    const u = await user();
    const created = await createManualMatch(db, u, fields({ note: 'hi' }));
    expect(created).not.toBe('duplicate');
    if (created === 'duplicate') return;
    expect(created.dedupeKey).toBe(manualDedupeKey(fields()));
    const got = await getManualMatch(db, u, created.id);
    expect(got?.note).toBe('hi');

    const updated = await updateManualMatch(db, u, created.id, fields({ kills: 25, note: null }));
    expect(updated).not.toBeNull();
    expect(updated).not.toBe('duplicate');
    if (updated && updated !== 'duplicate') {
      expect(updated.kills).toBe(25);
      expect(updated.note).toBeNull();
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
      expect(updated.dedupeKey).toBe(manualDedupeKey(fields({ kills: 25 })));
    }
    expect(await deleteManualMatch(db, u, created.id)).toBe(true);
    expect(await getManualMatch(db, u, created.id)).toBeNull();
    expect(await deleteManualMatch(db, u, created.id)).toBe(false);
  });

  it('is scoped to the owning user', async () => {
    const a = await user('a');
    const b = await user('b');
    const row = (await createManualMatch(db, a, fields({ kills: 1 }))) as { id: string };
    expect(await getManualMatch(db, b, row.id)).toBeNull();
    expect(await updateManualMatch(db, b, row.id, fields({ kills: 2 }))).toBeNull();
    expect(await deleteManualMatch(db, b, row.id)).toBe(false);
    expect((await getManualMatch(db, a, row.id))?.kills).toBe(1);
  });

  it('returns null/false for malformed ids instead of throwing', async () => {
    const u = await user();
    expect(await getManualMatch(db, u, 'nope')).toBeNull();
    expect(await updateManualMatch(db, u, 'nope', fields())).toBeNull();
    expect(await deleteManualMatch(db, u, 'nope')).toBe(false);
  });

  it('detects duplicates on create and on update, per user', async () => {
    const a = await user('a');
    const b = await user('b');
    expect(await createManualMatch(db, a, fields())).not.toBe('duplicate');
    expect(await createManualMatch(db, a, fields())).toBe('duplicate');
    expect(await createManualMatch(db, b, fields())).not.toBe('duplicate');

    const other = (await createManualMatch(db, a, fields({ kills: 99 }))) as { id: string };
    expect(await updateManualMatch(db, a, other.id, fields())).toBe('duplicate');
    // updating to its own key is fine
    const same = await updateManualMatch(db, a, other.id, fields({ kills: 99, note: 'x' }));
    expect(same).not.toBe('duplicate');
    expect(same).not.toBeNull();
  });

  it('existingManualDedupeKeys returns only stored keys', async () => {
    const u = await user();
    await createManualMatch(db, u, fields());
    const k1 = manualDedupeKey(fields());
    const k2 = manualDedupeKey(fields({ kills: 3 }));
    expect(await existingManualDedupeKeys(db, u, [k1, k2])).toEqual(new Set([k1]));
    expect(await existingManualDedupeKeys(db, u, [])).toEqual(new Set());
  });

  it('deleteAllManualMatches returns the count', async () => {
    const u = await user();
    await insertManualMatches(db, u, [fields({ kills: 1 }), fields({ kills: 2 })]);
    expect(await deleteAllManualMatches(db, u)).toBe(2);
    expect(await deleteAllManualMatches(db, u)).toBe(0);
  });
});

describe('insertManualMatches', () => {
  it('counts inserted vs duplicates (including within the batch)', async () => {
    const u = await user();
    await createManualMatch(db, u, fields({ kills: 1 }));
    const res = await insertManualMatches(db, u, [fields({ kills: 1 }), fields({ kills: 2 }), fields({ kills: 2 }), fields({ kills: 3 })]);
    expect(res).toEqual({ inserted: 2, duplicates: 2 });
    expect(await insertManualMatches(db, u, [])).toEqual({ inserted: 0, duplicates: 0 });
  });

  it('is atomic: a failing row rolls back the whole batch', async () => {
    const u = await user();
    await expect(insertManualMatches(db, u, [fields({ kills: 10 }), fields({ kills: 1.5 })])).rejects.toThrow();
    expect(await existingManualDedupeKeys(db, u, [manualDedupeKey(fields({ kills: 10 }))])).toEqual(new Set());
  });
});

describe('manualRowToRecord', () => {
  it('maps fields, including a draw', async () => {
    const u = await user();
    const row = (await createManualMatch(db, u, fields({ roundsWon: 12, roundsLost: 12, combatScore: 200, damageDealt: 3000, firstKills: 3, firstDeaths: 2, excluded: 'unsupported_queue' }))) as ManualMatchRow;
    const rec = manualRowToRecord(row);
    expect(rec).toMatchObject({
      source: 'manual', matchId: `manual-${row.id}`, puuid: `user:${u}`, outcome: 'draw', roundsPlayed: 24,
      startedAt: '2026-03-01T12:00:00.000Z', combatScore: 200, damageDealt: 3000, firstKills: 3, firstDeaths: 2,
      headshots: null, bodyshots: null, legshots: null, plants: null, defuses: null, performanceScore: null,
      excluded: 'unsupported_queue',
    });
    expect(manualRowToRecord({ ...row, roundsWon: 13, roundsLost: 5 }).outcome).toBe('win');
    expect(manualRowToRecord({ ...row, roundsWon: 5, roundsLost: 13 }).outcome).toBe('loss');
  });
});

const riotMatch = (id: string, startedAt: string): NormalizedMatch => ({
  matchId: id, startedAt, durationMs: 1, mapId: 'ascent', queueId: 'competitive', seasonId: null, patch: '8.11', isCompleted: true,
  roundsPlayed: 24, teams: [{ teamId: 'Blue', won: true, roundsPlayed: 24, roundsWon: 13 }], participants: [], rounds: [], excluded: null,
});
const riotRec = (matchId: string, puuid: string, startedAt: string): PlayerMatchRecord => ({
  matchId, source: 'riot', puuid, startedAt, mapId: 'ascent', queueId: 'competitive', patch: '8.11', agentId: 'jett', teamId: 'Blue',
  outcome: 'win', roundsPlayed: 24, roundsWon: 13, roundsLost: 11, kills: 20, deaths: 15, assists: 5, combatScore: null,
  damageDealt: null, headshots: null, bodyshots: null, legshots: null, firstKills: null, firstDeaths: null, plants: null,
  defuses: null, performanceScore: null,
});

describe('listUserRecords and lifecycle', () => {
  it('merges and orders riot + manual, handles null puuid, hides excluded by default', async () => {
    const u = await user();
    const puuid = `puuid-${u}`;
    await upsertRiotAccount(db, { userId: u, puuid, gameName: 'g', tagLine: 't', shard: 'eu', consentedAt: new Date() });
    await upsertMatch(db, riotMatch('R1', '2026-01-01T00:00:00Z'), null);
    await upsertMatch(db, riotMatch('R2', '2026-01-03T00:00:00Z'), null);
    await upsertPlayerRecord(db, riotRec('R1', puuid, '2026-01-01T00:00:00Z'), null);
    await upsertPlayerRecord(db, riotRec('R2', puuid, '2026-01-03T00:00:00Z'), null);
    await createManualMatch(db, u, fields({ startedAt: new Date('2026-01-02T00:00:00Z') }));
    await createManualMatch(db, u, fields({ startedAt: new Date('2026-01-04T00:00:00Z'), excluded: 'remake' }));

    const list = await listUserRecords(db, u, puuid);
    expect(list.map((r) => r.source)).toEqual(['riot', 'manual', 'riot']);
    expect(list.map((r) => r.startedAt)).toEqual([...list.map((r) => r.startedAt)].sort());

    const all = await listUserRecords(db, u, puuid, { includeExcluded: true });
    expect(all.map((r) => r.source)).toEqual(['riot', 'manual', 'riot', 'manual']);

    const manualOnly = await listUserRecords(db, u, null);
    expect(manualOnly.map((r) => r.source)).toEqual(['manual']);
    expect(await listUserRecords(db, await user('empty'), null)).toEqual([]);
  });

  it('deleteUserMatchData keeps manual rows; deleting the user cascades them', async () => {
    const u = await user();
    const puuid = `puuid-${u}`;
    await upsertRiotAccount(db, { userId: u, puuid, gameName: 'g', tagLine: 't', shard: 'eu', consentedAt: new Date() });
    await upsertMatch(db, riotMatch('R9', '2026-02-01T00:00:00Z'), null);
    await upsertPlayerRecord(db, riotRec('R9', puuid, '2026-02-01T00:00:00Z'), null);
    await createManualMatch(db, u, fields());

    await deleteUserMatchData(db, u);
    const after = await listUserRecords(db, u, puuid);
    expect(after.map((r) => r.source)).toEqual(['manual']);

    await db.delete(schema.users).where(eq(schema.users.id, u));
    expect(await db.select().from(schema.manualMatches).where(eq(schema.manualMatches.userId, u))).toEqual([]);
  });

  it('migrations apply on a fresh database', async () => {
    const fresh = await createPgliteDb();
    const u = (await createUser(fresh, { displayName: 'f' })).id;
    expect(await createManualMatch(fresh, u, fields())).not.toBe('duplicate');
  }, 60_000);
});
