import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { NormalizedMatch } from '@va/shared';
import {
  createPgliteDb, createUser, getJob, getRiotAccount, listPlayerRecords, schema, upsertRiotAccount, createOrGetActiveJob, deleteUserMatchData,
  type Db,
} from '../src/db/index.js';
import { DEFAULT_FIXTURE_DIR, FixtureRiotClient, RiotApiError, type RiotClient } from '../src/riot/index.js';
import { RAW_SCHEMA_VERSION, SyncQueue, runSyncJob, toPlayerRounds, type IngestionDeps } from '../src/ingestion/index.js';

const PUUID_1 = 'demo-puuid-0001';
const PUUID_2 = 'demo-puuid-0002';
const REMAKE = '59197769-5cd7-411b-8463-d1d6d4d33795';
const INCOMPLETE = '15f717bf-813b-462f-8e2d-0f948e22f613';
const DRAW = 'd2a9313c-b719-411c-81ab-bd998e6a207a';
const NO_ROUNDS = ['da14aa40-9b2b-45c3-80dc-b40bb8f3fbdb', '0ae6b475-c045-4adf-8b71-ece88f5eaeb7'];
const UNRATED = 'fc3120eb-6b71-45aa-80ea-2ac9b2209748';
const DUPLICATE = 'ddfff7ba-871d-4daa-8fee-7b1f47808d81';

let db: Db;
const fixture = new FixtureRiotClient({ dir: DEFAULT_FIXTURE_DIR });
let counter = 0;

beforeAll(async () => {
  db = await createPgliteDb();
}, 60_000);

async function user(puuid: string) {
  const u = await createUser(db, { displayName: `u${++counter}` });
  await upsertRiotAccount(db, { userId: u.id, puuid, gameName: 'Demo', tagLine: '0001', shard: 'na', consentedAt: new Date() });
  return u;
}

/** Fresh user plus a distinct puuid so records never collide between tests (matchlist is read via `wrap`). */
function wrap(over: Partial<RiotClient>, base: RiotClient = fixture): RiotClient {
  return {
    getMyAccount: (t) => base.getMyAccount(t),
    getMatchlist: (p, s) => base.getMatchlist(p, s),
    getMatch: (m, s) => base.getMatch(m, s),
    getContent: (s) => base.getContent(s),
    ...over,
  };
}

const deps = (riot: RiotClient, extra: Partial<IngestionDeps> = {}): IngestionDeps => ({ db, riot, ...extra });

async function runFor(userId: string, riot: RiotClient) {
  const job = await createOrGetActiveJob(db, userId);
  const summary = await runSyncJob(deps(riot), job.id, userId);
  return { job, summary };
}

describe('toPlayerRounds', () => {
  it('derives per-round rows for the player', () => {
    const match = {
      participants: [
        { puuid: 'me', teamId: 'Blue' }, { puuid: 'foe', teamId: 'Red' },
      ],
      rounds: [
        {
          roundNumber: 1, winningTeam: 'Blue', result: 'Elimination', planter: null, defuser: null,
          kills: [
            { roundTimeMs: 1000, killer: 'me', victim: 'foe', assistants: [] },
            { roundTimeMs: 2000, killer: 'foe', victim: 'me', assistants: [] },
          ],
          damage: [{ puuid: 'me', damage: 150, headshots: 1, bodyshots: 1, legshots: 0 }],
        },
        {
          roundNumber: 2, winningTeam: 'Red', result: 'Detonate', planter: 'me', defuser: null,
          kills: [{ roundTimeMs: 500, killer: 'foe', victim: 'me', assistants: [] }],
          damage: [],
        },
        {
          roundNumber: 3, winningTeam: 'Blue', result: 'Defuse', planter: null, defuser: 'me',
          kills: [],
          damage: [],
        },
      ],
    } as unknown as NormalizedMatch;
    expect(toPlayerRounds(match, 'me')).toEqual([
      { roundNumber: 1, won: true, result: 'Elimination', kills: 1, died: true, damage: 150, firstKill: true, firstDeath: false, planted: false, defused: false },
      { roundNumber: 2, won: false, result: 'Detonate', kills: 0, died: true, damage: 0, firstKill: false, firstDeath: true, planted: true, defused: false },
      { roundNumber: 3, won: true, result: 'Defuse', kills: 0, died: false, damage: 0, firstKill: false, firstDeath: false, planted: false, defused: true },
    ]);
  });

  it('returns [] when there are no rounds', () => {
    expect(toPlayerRounds({ participants: [], rounds: [] } as unknown as NormalizedMatch, 'me')).toEqual([]);
  });
});

describe('runSyncJob with fixtures', () => {
  let userId: string;
  let first: Awaited<ReturnType<typeof runFor>>;

  beforeAll(async () => {
    userId = (await user(PUUID_1)).id;
    first = await runFor(userId, fixture);
  }, 120_000);

  it('stores every unique match, with README edge cases', async () => {
    expect(first.summary).toMatchObject({ fetched: 69, skippedExisting: 0, stored: 69, failedNormalize: 0, notFound: 0 });
    const all = await listPlayerRecords(db, PUUID_1, { includeExcluded: true });
    expect(all).toHaveLength(69);
    const byId = new Map(all.map((r) => [r.matchId, r]));
    expect(byId.get(REMAKE)?.excluded).toBe('remake');
    expect(byId.get(INCOMPLETE)?.excluded).toBe('incomplete');
    expect(byId.get(UNRATED)?.excluded).toBe('unsupported_queue');
    expect(byId.get(DRAW)?.excluded).toBeNull();
    expect(byId.get(DRAW)?.outcome).toBe('draw');
    const excludedCount = all.filter((r) => r.excluded !== null).length;
    expect(excludedCount).toBe(3);
    expect(first.summary.excluded).toBe(excludedCount);
    expect(await listPlayerRecords(db, PUUID_1)).toHaveLength(69 - excludedCount);
  });

  it('handles the duplicate matchlist entry once', async () => {
    const rows = await db.select().from(schema.playerMatchRecords).where(eq(schema.playerMatchRecords.matchId, DUPLICATE));
    expect(rows).toHaveLength(1);
  });

  it('leaves round-derived fields null and no player_rounds for matches without round data', async () => {
    const all = await listPlayerRecords(db, PUUID_1, { includeExcluded: true });
    for (const id of NO_ROUNDS) {
      const r = all.find((x) => x.matchId === id)!;
      expect(r.damageDealt).toBeNull();
      expect(r.firstKills).toBeNull();
      expect(r.plants).toBeNull();
      const rounds = await db.select().from(schema.playerRounds).where(and(eq(schema.playerRounds.matchId, id), eq(schema.playerRounds.puuid, PUUID_1)));
      expect(rounds).toHaveLength(0);
    }
    const normal = all.find((x) => x.matchId === DUPLICATE)!;
    expect(normal.damageDealt).not.toBeNull();
    const rounds = await db.select().from(schema.playerRounds).where(and(eq(schema.playerRounds.matchId, DUPLICATE), eq(schema.playerRounds.puuid, PUUID_1)));
    expect(rounds.length).toBeGreaterThan(0);
  });

  it('records job and link state, and raw payloads', async () => {
    const job = await getJob(db, first.job.id, userId);
    expect(job).toMatchObject({ state: 'succeeded', total: 69, cursor: 69 });
    expect(job?.finishedAt).not.toBeNull();
    const acct = await getRiotAccount(db, userId);
    expect(acct).toMatchObject({ linkState: 'up_to_date', lastError: null });
    expect(acct?.lastSyncedAt).not.toBeNull();
    const raws = await db.select().from(schema.rawPayloads).where(eq(schema.rawPayloads.kind, 'match'));
    expect(raws.length).toBeGreaterThanOrEqual(69);
    expect(raws[0]!.schemaVersion).toBe(RAW_SCHEMA_VERSION);
    const content = await db.select().from(schema.contentItems);
    expect(content.some((c) => c.kind === 'agent')).toBe(true);
    expect(content.some((c) => c.kind === 'map')).toBe(true);
  });

  it('second sync is a no-op', async () => {
    let matchCalls = 0;
    const counting = wrap({ getMatch: (m, s) => { matchCalls++; return fixture.getMatch(m, s); } });
    const second = await runFor(userId, counting);
    expect(second.summary).toMatchObject({ fetched: 0, skippedExisting: 69, stored: 0 });
    expect(matchCalls).toBe(0);
    expect(await listPlayerRecords(db, PUUID_1, { includeExcluded: true })).toHaveLength(69);
  });
});

describe('runSyncJob error handling', () => {
  // Each case links PUUID_2 to a fresh user and wipes that user's data afterwards.
  async function withUser(fn: (userId: string, total: number) => Promise<void>): Promise<void> {
    const u = await user(PUUID_2);
    const total = (await fixture.getMatchlist(PUUID_2, 'na')).history.length;
    try {
      await fn(u.id, total);
    } finally {
      await deleteUserMatchData(db, u.id);
    }
  }

  it('fails the job when the account is not linked', async () => {
    const u = await createUser(db, { displayName: 'nolink' });
    const job = await createOrGetActiveJob(db, u.id);
    await runSyncJob(deps(fixture), job.id, u.id);
    expect(await getJob(db, job.id, u.id)).toMatchObject({ state: 'failed', errorCategory: 'not_linked' });
  });

  it('counts a not_found match and stores the rest', () =>
    withUser(async (userId, total) => {
      const victim = (await fixture.getMatchlist(PUUID_2, 'na')).history[0]!.matchId;
      const riot = wrap({
        getMatch: (m, s) => (m === victim ? Promise.reject(new RiotApiError('gone', 'not_found', 404)) : fixture.getMatch(m, s)),
      });
      const { job, summary } = await runFor(userId, riot);
      expect(summary.notFound).toBe(1);
      expect(summary.stored).toBe(total - 1);
      expect(await getJob(db, job.id, userId)).toMatchObject({ state: 'succeeded' });
      expect(await getRiotAccount(db, userId)).toMatchObject({ linkState: 'up_to_date' });
    }), 60_000);

  it('stops on rate_limited, keeps progress, and a clean re-run completes', () =>
    withUser(async (userId, total) => {
      let calls = 0;
      const riot = wrap({
        getMatch: (m, s) => {
          calls++;
          return calls > 5 ? Promise.reject(new RiotApiError('slow down', 'rate_limited', 429, 1000)) : fixture.getMatch(m, s);
        },
      });
      const job1 = await createOrGetActiveJob(db, userId);
      const s1 = await runSyncJob(deps(riot, { concurrency: 1 }), job1.id, userId);
      expect(s1.stored).toBe(5);
      expect(await getJob(db, job1.id, userId)).toMatchObject({ state: 'failed', errorCategory: 'rate_limited' });
      expect(await getRiotAccount(db, userId)).toMatchObject({
        linkState: 'sync_failed',
        lastError: "Riot's API is busy or unavailable. Try again later.",
      });
      expect(await listPlayerRecords(db, PUUID_2, { includeExcluded: true })).toHaveLength(5);

      const { job, summary } = await runFor(userId, fixture);
      expect(summary).toMatchObject({ skippedExisting: 5, stored: total - 5 });
      expect(await getJob(db, job.id, userId)).toMatchObject({ state: 'succeeded' });
      expect(await getRiotAccount(db, userId)).toMatchObject({ linkState: 'up_to_date', lastError: null });
      expect(await listPlayerRecords(db, PUUID_2, { includeExcluded: true })).toHaveLength(total);
    }), 60_000);

  it('auth failure tells the user to re-link', () =>
    withUser(async (userId) => {
      const riot = wrap({ getMatch: () => Promise.reject(new RiotApiError('nope', 'auth', 401)) });
      const { job } = await runFor(userId, riot);
      expect(await getJob(db, job.id, userId)).toMatchObject({ state: 'failed', errorCategory: 'auth' });
      expect(await getRiotAccount(db, userId)).toMatchObject({
        linkState: 'sync_failed',
        lastError: 'Riot denied access. Re-link your account.',
      });
    }), 60_000);

  it('unexpected errors fail the job as internal without throwing', () =>
    withUser(async (userId) => {
      const riot = wrap({ getContent: () => Promise.reject(new Error('boom')) });
      const { job } = await runFor(userId, riot);
      expect(await getJob(db, job.id, userId)).toMatchObject({ state: 'failed', errorCategory: 'internal' });
      expect(await getRiotAccount(db, userId)).toMatchObject({ linkState: 'sync_failed' });
    }), 60_000);
});

describe('SyncQueue', () => {
  it('enqueue twice returns the same job and runs it once', () =>
    (async () => {
      const u = await user('queue-puuid-0001');
      let matchlistCalls = 0;
      const riot = wrap({
        getMatchlist: async (_p, s) => {
          matchlistCalls++;
          return { puuid: 'queue-puuid-0001', history: [] };
        },
      });
      const queue = new SyncQueue(deps(riot));
      const a = await queue.enqueue(u.id);
      const b = await queue.enqueue(u.id);
      expect(b.id).toBe(a.id);
      await queue.idle();
      expect(matchlistCalls).toBe(1);
      expect(await getJob(db, a.id, u.id)).toMatchObject({ state: 'succeeded', total: 0 });
      // after completion a new enqueue creates a new job
      const c = await queue.enqueue(u.id);
      expect(c.id).not.toBe(a.id);
      await queue.idle();
    })(), 60_000);

  it('scheduler enqueues linked accounts that are not syncing', async () => {
    const u = await user('queue-puuid-0002');
    const riot = wrap({ getMatchlist: async () => ({ puuid: 'queue-puuid-0002', history: [] }) });
    const queue = new SyncQueue(deps(riot));
    const stop = queue.startScheduler(20);
    try {
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      stop();
    }
    await queue.idle();
    const jobs = await db.select().from(schema.ingestionJobs).where(eq(schema.ingestionJobs.userId, u.id));
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs.every((j) => j.state === 'succeeded' || j.state === 'failed')).toBe(true);
  }, 60_000);
});
