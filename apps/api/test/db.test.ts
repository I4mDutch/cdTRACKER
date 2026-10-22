import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { NormalizedMatch, PlayerMatchRecord } from '@va/shared';
import {
  createPgliteDb, schema, type Db,
  createUser, getUser, createSession, getSessionUser, deleteSession,
  upsertRiotAccount, getRiotAccount, setLinkState, listLinkedAccounts,
  createOAuthState, consumeOAuthState,
  upsertContent, getNameLookup,
  saveRawPayload, purgeExpiredRawPayloads,
  upsertMatch, upsertPlayerRecord, replacePlayerRounds, hasPlayerRecord, listPlayerRecords, getPlayerMatch, deleteUserMatchData,
  createOrGetActiveJob, getJob, listQueuedJobs, updateJob,
  saveFeedback, listFeedback,
  createShareLink, listShareLinks, revokeShareLink, resolveShareToken,
  saveSnapshot,
} from '../src/db/index.js';

let db: Db;
beforeEach(async () => {
  db = await createPgliteDb();
}, 60_000);

function match(id: string, startedAt: string, over: Partial<NormalizedMatch> = {}): NormalizedMatch {
  return {
    matchId: id, startedAt, durationMs: 1_800_000, mapId: '/Game/Maps/Ascent/Ascent', queueId: 'competitive',
    seasonId: null, patch: '8.11', isCompleted: true, roundsPlayed: 24,
    teams: [{ teamId: 'Blue', won: true, roundsPlayed: 24, roundsWon: 13 }, { teamId: 'Red', won: false, roundsPlayed: 24, roundsWon: 11 }],
    participants: [], rounds: [], excluded: null, ...over,
  };
}

function rec(matchId: string, puuid: string, startedAt: string, over: Partial<PlayerMatchRecord> = {}): PlayerMatchRecord {
  return {
    matchId, puuid, startedAt, mapId: '/Game/Maps/Ascent/Ascent', queueId: 'competitive', patch: '8.11',
    agentId: 'agent-1', teamId: 'Blue', outcome: 'win', roundsPlayed: 24, roundsWon: 13, roundsLost: 11,
    kills: 20, deaths: 15, assists: 5, combatScore: 5000, damageDealt: null, headshots: null, bodyshots: null, legshots: null,
    firstKills: null, firstDeaths: null, plants: null, defuses: null, performanceScore: null, ...over,
  };
}

async function linkedUser(name: string, puuid: string) {
  const u = await createUser(db, { displayName: name });
  await upsertRiotAccount(db, { userId: u.id, puuid, gameName: name, tagLine: 'EUW', shard: 'eu', consentedAt: new Date() });
  return u;
}

describe('users, sessions', () => {
  it('creates and fetches users', async () => {
    const u = await createUser(db, { displayName: 'A', isDemo: true });
    expect(u.isDemo).toBe(true);
    expect((await getUser(db, u.id))?.displayName).toBe('A');
    expect(await getUser(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('stores only the token hash and honours expiry and deletion', async () => {
    const u = await createUser(db, { displayName: 'A' });
    const { token } = await createSession(db, u.id, 60_000);
    const rows = await db.select().from(schema.sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect((await getSessionUser(db, token))?.id).toBe(u.id);
    expect(await getSessionUser(db, 'bogus')).toBeNull();
    await deleteSession(db, token);
    expect(await getSessionUser(db, token)).toBeNull();

    const expired = await createSession(db, u.id, -1000);
    expect(await getSessionUser(db, expired.token)).toBeNull();
  });
});

describe('riot accounts and oauth state', () => {
  it('upserts account, sets link state, lists linked', async () => {
    const u = await linkedUser('A', 'p1');
    const u2 = await linkedUser('B', 'p2');
    const first = await getRiotAccount(db, u.id);
    expect(first?.linkState).toBe('linked');
    await upsertRiotAccount(db, { userId: u.id, puuid: 'p1', gameName: 'A2', tagLine: 'X', shard: 'eu', consentedAt: new Date() });
    expect((await getRiotAccount(db, u.id))?.gameName).toBe('A2');
    expect(await db.select().from(schema.riotAccounts)).toHaveLength(2);
    await setLinkState(db, u2.id, 'consent_removed', { lastError: 'x' });
    const linked = await listLinkedAccounts(db);
    expect(linked.map((a) => a.puuid)).toEqual(['p1']);
    await setLinkState(db, u.id, 'up_to_date', { lastSyncedAt: new Date(), lastError: null });
    expect((await getRiotAccount(db, u.id))?.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('oauth state is single use and expires', async () => {
    const u = await createUser(db, { displayName: 'A' });
    const st = await createOAuthState(db, u.id);
    expect(await consumeOAuthState(db, st)).toEqual({ userId: u.id });
    expect(await consumeOAuthState(db, st)).toBeNull();
    expect(await consumeOAuthState(db, 'nope')).toBeNull();
    const anon = await createOAuthState(db, null);
    expect(await consumeOAuthState(db, anon)).toEqual({ userId: null });
    expect(await consumeOAuthState(db, anon)).toBeNull();
    const st2 = await createOAuthState(db, u.id);
    await db.update(schema.oauthStates).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.oauthStates.state, st2));
    expect(await consumeOAuthState(db, st2)).toBeNull();
  });
});

describe('content and raw payloads', () => {
  it('builds a name lookup', async () => {
    await upsertContent(db, [
      { kind: 'agent', id: 'a1', name: 'Jett', assetPath: null },
      { kind: 'map', id: 'm1', name: 'Ascent', assetPath: '/Game/Maps/Ascent/Ascent' },
      { kind: 'map', id: 'm2', name: 'Bind', assetPath: null },
    ]);
    await upsertContent(db, [{ kind: 'agent', id: 'a1', name: 'Jett2', assetPath: null }]);
    const l = await getNameLookup(db);
    expect(l.agents).toEqual({ a1: 'Jett2' });
    expect(l.maps).toEqual({ '/Game/Maps/Ascent/Ascent': 'Ascent', m2: 'Bind' });
  });

  it('purges expired raw payloads only', async () => {
    const keep = await saveRawPayload(db, { kind: 'match', sourceKey: 'm1', payload: { a: 1 }, schemaVersion: '1', retentionDays: 30 });
    const old = await saveRawPayload(db, { kind: 'match', sourceKey: 'm2', payload: { a: 2 }, schemaVersion: '1', retentionDays: 1 });
    expect(await purgeExpiredRawPayloads(db)).toBe(0);
    expect(await purgeExpiredRawPayloads(db, new Date(Date.now() + 2 * 86_400_000))).toBe(1);
    const ids = (await db.select().from(schema.rawPayloads)).map((r) => r.id);
    expect(ids).toEqual([keep]);
    expect(ids).not.toContain(old);
  });
});

describe('matches and records', () => {
  it('upserts are idempotent and update values', async () => {
    await upsertMatch(db, match('m1', '2026-01-01T10:00:00Z'), null);
    await upsertMatch(db, match('m1', '2026-01-01T10:00:00Z', { patch: '8.12' }), null);
    const ms = await db.select().from(schema.matches);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.patch).toBe('8.12');
    expect(ms[0]!.hasRoundData).toBe(false);

    await upsertPlayerRecord(db, rec('m1', 'p1', '2026-01-01T10:00:00Z'), null);
    await upsertPlayerRecord(db, rec('m1', 'p1', '2026-01-01T10:00:00Z', { kills: 30, combatScore: null }), null);
    const rs = await db.select().from(schema.playerMatchRecords);
    expect(rs).toHaveLength(1);
    expect(rs[0]!.kills).toBe(30);
    expect(rs[0]!.combatScore).toBeNull();
    expect(await hasPlayerRecord(db, 'm1', 'p1')).toBe(true);
    expect(await hasPlayerRecord(db, 'm1', 'p2')).toBe(false);
  });

  it('lists records ascending and filters excluded', async () => {
    for (const [id, t] of [['m3', '2026-01-03T00:00:00Z'], ['m1', '2026-01-01T00:00:00Z'], ['m2', '2026-01-02T00:00:00Z']] as const) {
      await upsertMatch(db, match(id, t), null);
    }
    await upsertPlayerRecord(db, rec('m3', 'p1', '2026-01-03T00:00:00Z'), null);
    await upsertPlayerRecord(db, rec('m1', 'p1', '2026-01-01T00:00:00Z'), null);
    await upsertPlayerRecord(db, rec('m2', 'p1', '2026-01-02T00:00:00Z'), 'remake');
    const def = await listPlayerRecords(db, 'p1');
    expect(def.map((r) => r.matchId)).toEqual(['m1', 'm3']);
    const all = await listPlayerRecords(db, 'p1', { includeExcluded: true });
    expect(all.map((r) => r.matchId)).toEqual(['m1', 'm2', 'm3']);
    expect(all[1]!.excluded).toBe('remake');
    expect(all[0]!.startedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(all[0]!.performanceScore).toBeNull();
    expect(await listPlayerRecords(db, 'other')).toEqual([]);
  });

  it('getPlayerMatch is scoped to the puuid and returns rounds', async () => {
    await upsertMatch(db, match('m1', '2026-01-01T00:00:00Z'), null);
    await upsertPlayerRecord(db, rec('m1', 'p1', '2026-01-01T00:00:00Z'), null);
    const r = (n: number) => ({ roundNumber: n, won: n % 2 === 0, result: 'Elimination', kills: n, died: false, damage: 100, firstKill: false, firstDeath: false, planted: false, defused: false });
    await replacePlayerRounds(db, 'm1', 'p1', [r(2), r(1)]);
    await replacePlayerRounds(db, 'm1', 'p1', [r(3), r(1), r(2)]);
    const got = await getPlayerMatch(db, 'm1', 'p1');
    expect(got?.rounds.map((x) => x.roundNumber)).toEqual([1, 2, 3]);
    expect(got?.match.matchId).toBe('m1');
    expect(got?.record.puuid).toBe('p1');
    expect(await getPlayerMatch(db, 'm1', 'p2')).toBeNull();
    expect(await getPlayerMatch(db, 'nope', 'p1')).toBeNull();
  });

  it('deleteUserMatchData removes own data but keeps matches shared with another linked player', async () => {
    const u1 = await linkedUser('A', 'p1');
    const u2 = await linkedUser('B', 'p2');
    const raw1 = await saveRawPayload(db, { kind: 'match', sourceKey: 'only1', payload: {}, schemaVersion: '1', retentionDays: 30 });
    const rawS = await saveRawPayload(db, { kind: 'match', sourceKey: 'shared', payload: {}, schemaVersion: '1', retentionDays: 30 });
    await saveRawPayload(db, { kind: 'matchlist', sourceKey: 'p1', payload: {}, schemaVersion: '1', retentionDays: 30 });
    await saveRawPayload(db, { kind: 'matchlist', sourceKey: 'p2', payload: {}, schemaVersion: '1', retentionDays: 30 });
    await upsertMatch(db, match('only1', '2026-01-01T00:00:00Z'), raw1);
    await upsertMatch(db, match('shared', '2026-01-02T00:00:00Z'), rawS);
    await upsertPlayerRecord(db, rec('only1', 'p1', '2026-01-01T00:00:00Z'), null);
    await upsertPlayerRecord(db, rec('shared', 'p1', '2026-01-02T00:00:00Z'), null);
    await upsertPlayerRecord(db, rec('shared', 'p2', '2026-01-02T00:00:00Z'), null);
    await replacePlayerRounds(db, 'shared', 'p1', [{ roundNumber: 1, won: true, result: 'x', kills: 1, died: false, damage: 1, firstKill: false, firstDeath: false, planted: false, defused: false }]);
    await replacePlayerRounds(db, 'shared', 'p2', [{ roundNumber: 1, won: true, result: 'x', kills: 1, died: false, damage: 1, firstKill: false, firstDeath: false, planted: false, defused: false }]);
    await saveFeedback(db, u1.id, 'f1', 'dismiss');
    await saveFeedback(db, u2.id, 'f1', 'dismiss');
    await createShareLink(db, u1.id, ['winRate'], null);
    await createOrGetActiveJob(db, u1.id);
    await saveSnapshot(db, u1.id, 'score', 'v1', {}, {});

    await deleteUserMatchData(db, u1.id);

    expect(await listPlayerRecords(db, 'p1', { includeExcluded: true })).toEqual([]);
    expect(await listPlayerRecords(db, 'p2')).toHaveLength(1);
    expect((await db.select().from(schema.matches)).map((m) => m.matchId)).toEqual(['shared']);
    expect((await db.select().from(schema.playerRounds)).map((r) => r.puuid)).toEqual(['p2']);
    const raws = await db.select().from(schema.rawPayloads);
    expect(raws.map((r) => `${r.kind}:${r.sourceKey}`).sort()).toEqual(['match:shared', 'matchlist:p2']);
    expect(await getRiotAccount(db, u1.id)).toBeNull();
    expect(await getRiotAccount(db, u2.id)).not.toBeNull();
    expect(await listFeedback(db, u1.id)).toEqual([]);
    expect(await listFeedback(db, u2.id)).toHaveLength(1);
    expect(await listShareLinks(db, u1.id)).toEqual([]);
    expect(await db.select().from(schema.ingestionJobs)).toEqual([]);
    expect(await db.select().from(schema.analysisSnapshots)).toEqual([]);
    expect(await getUser(db, u1.id)).not.toBeNull();
  });
});

describe('jobs, feedback, share links, snapshots', () => {
  it('does not duplicate active jobs and scopes getJob to the user', async () => {
    const u = await createUser(db, { displayName: 'A' });
    const u2 = await createUser(db, { displayName: 'B' });
    const j1 = await createOrGetActiveJob(db, u.id);
    const j2 = await createOrGetActiveJob(db, u.id);
    expect(j2.id).toBe(j1.id);
    expect(j1.state).toBe('queued');
    expect(await listQueuedJobs(db)).toHaveLength(1);
    await updateJob(db, j1.id, { state: 'running', cursor: 3, total: 10, startedAt: new Date() });
    expect((await createOrGetActiveJob(db, u.id)).id).toBe(j1.id);
    expect(await listQueuedJobs(db)).toHaveLength(0);
    expect((await getJob(db, j1.id, u.id))?.cursor).toBe(3);
    expect(await getJob(db, j1.id, u2.id)).toBeNull();
    await updateJob(db, j1.id, { state: 'succeeded', finishedAt: new Date() });
    const j3 = await createOrGetActiveJob(db, u.id);
    expect(j3.id).not.toBe(j1.id);
  });

  it('feedback upserts', async () => {
    const u = await createUser(db, { displayName: 'A' });
    await saveFeedback(db, u.id, 'f1', 'useful');
    await saveFeedback(db, u.id, 'f1', 'dismiss');
    expect(await listFeedback(db, u.id)).toEqual([{ findingId: 'f1', action: 'dismiss' }]);
  });

  it('share links: hash only, revoke, expire, other-user revoke', async () => {
    const u = await createUser(db, { displayName: 'A' });
    const o = await createUser(db, { displayName: 'B' });
    const { row, token } = await createShareLink(db, u.id, ['winRate', 'kd'], null);
    const stored = await db.select().from(schema.shareLinks);
    expect(stored[0]!.tokenHash).not.toBe(token);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(await resolveShareToken(db, token)).toEqual({ userId: u.id, fields: ['winRate', 'kd'] });
    expect(await resolveShareToken(db, 'bogus')).toBeNull();
    expect(await revokeShareLink(db, o.id, row.id)).toBe(false);
    expect(await resolveShareToken(db, token)).not.toBeNull();
    expect(await revokeShareLink(db, u.id, row.id)).toBe(true);
    expect(await resolveShareToken(db, token)).toBeNull();

    const exp = await createShareLink(db, u.id, ['matchCount'], new Date(Date.now() + 1000));
    expect(await resolveShareToken(db, exp.token)).not.toBeNull();
    expect(await resolveShareToken(db, exp.token, new Date(Date.now() + 5000))).toBeNull();
    expect(await listShareLinks(db, u.id)).toHaveLength(2);
  });

  it('saves snapshots', async () => {
    const u = await createUser(db, { displayName: 'A' });
    await saveSnapshot(db, u.id, 'insights', 'v1', { lastN: 20 }, { findings: [] });
    const rows = await db.select().from(schema.analysisSnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.filter).toEqual({ lastN: 20 });
  });
});
