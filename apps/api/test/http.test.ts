import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { MatchDetailDto, MatchSummaryDto, Paginated, SummaryResponse } from '@va/shared';
import { createApp } from '../src/app.js';
import { loadEnv, EnvError, type Env } from '../src/env.js';
import { createPgliteDb, createSession, createUser, getRiotAccount, type Db } from '../src/db/index.js';
import { SyncQueue } from '../src/ingestion/index.js';
import { DEFAULT_FIXTURE_DIR, FixtureRiotClient } from '../src/riot/index.js';
import { MockRsoProvider } from '../src/http/rso.js';
import { escapeCsvCell, toCsv } from '../src/http/csv.js';

const H = { 'X-Requested-With': 'va-web' };
const PUUID_1 = 'demo-puuid-0001';
const PUUID_2 = 'demo-puuid-0002';

const matchlistIds = (puuid: string): string[] =>
  (JSON.parse(readFileSync(path.join(DEFAULT_FIXTURE_DIR, 'matchlists', `${puuid}.json`), 'utf8')) as { history: { matchId: string }[] }).history.map(
    (h) => h.matchId,
  );

const baseEnv = (over: Partial<Env> = {}): Env => ({
  port: 0,
  databaseUrl: undefined,
  pgliteDir: undefined,
  demoMode: true,
  riotApiKey: undefined,
  rsoClientId: undefined,
  rsoClientSecret: undefined,
  rsoRedirectUri: undefined,
  publicBaseUrl: 'http://localhost:5173',
  sessionTtlHours: 24,
  cookieSecure: false,
  rawRetentionDays: 30,
  syncIntervalMinutes: 0,
  rateLimitPerMinute: 100_000,
  rateLimitSensitivePerMinute: 1000,
  ...over,
});

let db: Db;
let queue: SyncQueue;
let app: Express;
const riot = new FixtureRiotClient({ dir: DEFAULT_FIXTURE_DIR });

const mkApp = (env: Env): Express => createApp({ db, riot, rso: new MockRsoProvider(), queue, env });

/** Runs the mock RSO flow with a given fixture token; returns the callback response. */
async function rsoCallback(agent: ReturnType<typeof request.agent>, code: string) {
  const c = await agent.post('/api/riot/connect').set(H).send({ consent: true });
  expect(c.status).toBe(200);
  const state = new URL(c.body.redirectUrl, 'http://x').searchParams.get('state');
  expect(state).toBeTruthy();
  return agent.get(`/api/riot/callback?code=${code}&state=${state}`);
}

beforeAll(async () => {
  db = await createPgliteDb();
  queue = new SyncQueue({ db, riot });
  app = mkApp(baseEnv());
}, 60_000);

afterAll(async () => {
  await queue.idle();
});

describe('csv escaping (unit)', () => {
  it('prefixes formula-like strings and quotes per RFC 4180', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('+cmd')).toBe("'+cmd");
    expect(escapeCsvCell('-2+3')).toBe("'-2+3");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvCell(-5)).toBe('-5');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('=a,b')).toBe('"\'=a,b"');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(toCsv(['a', 'b'], [[1, '=x']])).toBe("a,b\r\n1,'=x\r\n");
  });
});

describe('env', () => {
  it('defaults to demo mode and fails fast without keys when not in demo mode', () => {
    const env = loadEnv({});
    expect(env.demoMode).toBe(true);
    expect(env.cookieSecure).toBe(false);
    expect(env.port).toBe(3000);
    expect(() => loadEnv({ DEMO_MODE: 'false' })).toThrow(EnvError);
    expect(() => loadEnv({ DEMO_MODE: 'false' })).toThrow(/RIOT_API_KEY/);
    const real = loadEnv({ RIOT_API_KEY: 'k', RSO_CLIENT_ID: 'a', RSO_CLIENT_SECRET: 'b', RSO_REDIRECT_URI: 'https://x.test/cb' });
    expect(real.demoMode).toBe(false);
    expect(real.cookieSecure).toBe(true);
  });
});

describe('signed out', () => {
  it('GET /me returns user null', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
    expect(res.body.link.state).toBe('unlinked');
    expect(res.body.demoMode).toBe(true);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('data routes return 401 unauthenticated', async () => {
    const res = await request(app).get('/api/summary');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('unknown api route is a JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('demo user (puuid 0001)', () => {
  let a: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    a = request.agent(app);
    const res = await a.post('/api/dev/login').set(H);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toMatch(/va_session=.*HttpOnly.*SameSite=Lax/i);
    await queue.idle();
  }, 60_000);

  it('CSRF: POST without header is 403', async () => {
    const res = await request(app).post('/api/dev/login');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
  });

  it('/me shows linked demo account', async () => {
    const res = await a.get('/api/me');
    expect(res.body.user.displayName).toBe('Demo Player');
    expect(res.body.link.state).toBe('up_to_date');
    expect(res.body.link.riotId).toBe('DemoPlayer#0001');
    expect(res.body.link.region).toBe('na');
    expect(res.body.link.lastSyncedAt).toBeTruthy();
  });

  it('GET /summary shape', async () => {
    const res = await a.get('/api/summary');
    expect(res.status).toBe(200);
    const body = res.body as SummaryResponse;
    expect(body.filter.queueId).toBe('competitive');
    expect(body.overall.matches).toBeGreaterThan(20);
    expect(body.trends.map((t) => t.metric)).toEqual(['winRate', 'kd']);
    expect(body.trends[0]!.window).toBe(10);
    expect(body.trends[0]!.points.length).toBe(body.overall.matches);
    expect(body.recent.length).toBe(10);
    expect(Date.parse(body.recent[0]!.startedAt)).toBeGreaterThanOrEqual(Date.parse(body.recent[1]!.startedAt));
    expect(body.range.from).toBeTruthy();
    expect(body.range.to).toBeTruthy();
    expect(body.overall.winRate).toBeGreaterThanOrEqual(0);
    expect(body.overall.winRate).toBeLessThanOrEqual(1);
  });

  it('queueId=all includes more matches than the competitive default', async () => {
    const def = await a.get('/api/summary');
    const all = await a.get('/api/summary?queueId=all');
    expect(all.status).toBe(200);
    expect(all.body.overall.matches).toBeGreaterThanOrEqual(def.body.overall.matches);
    expect(all.body.filter.queueId).toBeUndefined();
  });

  it('agents and maps breakdowns', async () => {
    for (const route of ['agents', 'maps']) {
      const res = await a.get(`/api/${route}`);
      expect(res.status).toBe(200);
      expect(res.body.lowSampleThreshold).toBe(5);
      expect(res.body.rows.length).toBeGreaterThan(1);
      const counts = res.body.rows.map((r: { stat: { matches: number } }) => r.stat.matches);
      expect([...counts].sort((x, y) => y - x)).toEqual(counts);
      const row = res.body.rows[0];
      expect(row.name).toBeTruthy();
      expect(row.name).not.toBe(row.id);
      expect(typeof row.lowSample).toBe('boolean');
      expect(row).toHaveProperty('winRateDelta');
      expect(row).toHaveProperty('kdDelta');
    }
  });

  it('insights contain the planted Split finding; feedback dismisses it', async () => {
    const res = await a.get('/api/insights');
    expect(res.status).toBe(200);
    expect(res.body.analysisVersion).toBeTruthy();
    expect(res.body.config.minMatches).toBeGreaterThan(0);
    const split = res.body.findings.find((f: { subject: { kind: string; id: string }; summary: string }) => f.subject.kind === 'map' && /split/i.test(f.subject.id + f.summary));
    expect(split).toBeTruthy();
    expect(res.body.dismissed).toEqual([]);

    const fb = await a.post('/api/insights/feedback').set(H).send({ findingId: split.id, action: 'dismiss' });
    expect(fb.status).toBe(204);
    const again = await a.get('/api/insights');
    expect(again.body.dismissed).toContain(split.id);
    expect(again.body.findings.some((f: { id: string }) => f.id === split.id)).toBe(true);

    const bad = await a.post('/api/insights/feedback').set(H).send({ findingId: split.id, action: 'nope' });
    expect(bad.status).toBe(400);
  });

  it('score shape', async () => {
    const res = await a.get('/api/score');
    expect(res.status).toBe(200);
    expect(res.body.relativeTo).toBe('own-history');
    expect(res.body.window).toEqual({ lastN: 20 });
    expect(res.body.components).toHaveLength(4);
    expect(res.body.formulaVersion).toBeTruthy();
  });

  it('filters/options', async () => {
    const res = await a.get('/api/filters/options');
    expect(res.status).toBe(200);
    expect(res.body.agents.length).toBeGreaterThan(1);
    expect(res.body.maps.length).toBeGreaterThan(1);
    expect(res.body.queues).toContain('competitive');
  });

  it('/matches paginates newest first with total', async () => {
    const p1 = await a.get('/api/matches?pageSize=10&page=1');
    expect(p1.status).toBe(200);
    const b1 = p1.body as Paginated<MatchSummaryDto>;
    expect(b1.items).toHaveLength(10);
    expect(b1.page).toBe(1);
    expect(b1.pageSize).toBe(10);
    const summary = await a.get('/api/summary');
    expect(b1.total).toBeGreaterThanOrEqual(summary.body.overall.matches);
    const p2 = (await a.get('/api/matches?pageSize=10&page=2')).body as Paginated<MatchSummaryDto>;
    expect(p2.items[0]!.matchId).not.toBe(b1.items[0]!.matchId);
    expect(Date.parse(b1.items[9]!.startedAt)).toBeGreaterThanOrEqual(Date.parse(p2.items[0]!.startedAt));
    const defaults = (await a.get('/api/matches')).body as Paginated<MatchSummaryDto>;
    expect(defaults.pageSize).toBe(20);
    expect(b1.items[0]!.mapName).toBeTruthy();
    expect(b1.items[0]!.agentName).toBeTruthy();
  });

  it('validation: pageSize=1000 and bad filters are 400', async () => {
    const r1 = await a.get('/api/matches?pageSize=1000');
    expect(r1.status).toBe(400);
    expect(r1.body.error.code).toBe('validation');
    expect((await a.get('/api/summary?lastN=abc')).status).toBe(400);
    expect((await a.get('/api/summary?from=notadate')).status).toBe(400);
    expect((await a.post('/api/share-links').set(H).send({ fields: ['puuid'] })).status).toBe(400);
    expect((await a.post('/api/share-links').set(H).send({ fields: ['kd'], expiresInDays: 400 })).status).toBe(400);
  });

  it('own match detail is 200 with no other players', async () => {
    const list = (await a.get('/api/matches?pageSize=100')).body as Paginated<MatchSummaryDto>;
    const full = list.items.find((m) => m.excluded === null)!;
    const res = await a.get(`/api/matches/${full.matchId}`);
    expect(res.status).toBe(200);
    const d = res.body as MatchDetailDto;
    expect(d.summary.matchId).toBe(full.matchId);
    expect(d.teams.filter((t) => t.isPlayerTeam)).toHaveLength(1);
    expect(d.fieldSources.find((f) => f.field === 'performanceScore')?.source).toBe('unavailable');
    expect(d.fieldSources.find((f) => f.field === 'kills')?.source).toBe('riot');
    expect(JSON.stringify(res.body)).not.toContain('puuid');
    expect((await a.get('/api/matches/does-not-exist')).status).toBe(404);
  });

  it('CSV export and column definitions', async () => {
    const res = await a.get('/api/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="valorant-analyzer-export.csv"');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toContain('matchId,puuid,startedAt');
    expect(lines[0]).toMatch(/performanceScore,map_name,agent_name,excluded$/);
    const summary = await a.get('/api/summary');
    expect(lines.length - 1).toBeGreaterThanOrEqual(summary.body.overall.matches);
    const defs = await a.get('/api/export.csv?definitions=1');
    expect(defs.status).toBe(200);
    expect(defs.text.split('\r\n')[0]).toBe('column,definition');
    expect(defs.text).toContain('performanceScore');
  });

  it('POST /sync and GET /sync/:jobId', async () => {
    const res = await a.post('/api/sync').set(H);
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTruthy();
    await queue.idle();
    const job = await a.get(`/api/sync/${res.body.jobId}`);
    expect(job.status).toBe(200);
    expect(job.body.state).toBe('succeeded');
    expect((await a.get('/api/sync/not-a-uuid')).status).toBe(404);
  });

  it('share links: create, public view with only chosen fields, revoke', async () => {
    const created = await a.post('/api/share-links').set(H).send({ fields: ['winRate', 'matchCount'], expiresInDays: 7 });
    expect(created.status).toBe(201);
    expect(created.body.url).toMatch(/^http:\/\/localhost:5173\/p\/.+/);
    expect(created.body.revoked).toBe(false);
    expect(created.body.expiresAt).toBeTruthy();
    const token = created.body.url.split('/p/')[1];

    const pub = await request(app).get(`/api/public/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.winRate).toBeTypeOf('number');
    expect(pub.body.matchCount).toBeGreaterThan(0);
    expect(pub.body.kd).toBeUndefined();
    expect(pub.body.topAgents).toBeUndefined();
    expect(pub.body.topMaps).toBeUndefined();
    expect(pub.body.disclaimer).toMatch(/^Stats from \d+ matches between \d{4}-\d{2}-\d{2} and \d{4}-\d{2}-\d{2}\. Not an official Riot rating\.$/);
    expect(pub.text).not.toContain('puuid');
    expect(pub.text).not.toContain('demo-puuid');
    expect(pub.text).not.toContain('DemoPlayer');

    const all = await request(app)
      .get(`/api/public/${(await a.post('/api/share-links').set(H).send({ fields: ['kd', 'topAgents', 'topMaps'] })).body.url.split('/p/')[1]}`);
    expect(all.body.topAgents.length).toBeLessThanOrEqual(3);
    expect(all.body.topMaps.length).toBeGreaterThan(0);
    expect(all.body.winRate).toBeUndefined();

    const list = await a.get('/api/share-links');
    expect(list.body.length).toBeGreaterThanOrEqual(2);
    expect(list.body[0].url).toBeUndefined();

    const del = await a.delete(`/api/share-links/${created.body.id}`).set(H);
    expect(del.status).toBe(204);
    expect((await request(app).get(`/api/public/${token}`)).status).toBe(404);
    expect((await a.delete(`/api/share-links/${created.body.id}`).set(H)).status).toBe(204); // idempotent
    expect((await a.delete('/api/share-links/00000000-0000-4000-8000-000000000000').set(H)).status).toBe(404);
    expect((await a.get('/api/share-links')).body.find((l: { id: string }) => l.id === created.body.id).revoked).toBe(true);
    expect((await request(app).get('/api/public/garbage')).status).toBe(404);
  });

  it('logout clears the session', async () => {
    const b = request.agent(app);
    await b.post('/api/dev/login').set(H);
    expect((await b.get('/api/me')).body.user).not.toBeNull();
    expect((await b.post('/api/logout').set(H)).status).toBe(204);
    expect((await b.get('/api/me')).body.user).toBeNull();
    await queue.idle();
  });
});

describe('RSO flow and isolation between users', () => {
  it('connect requires consent', async () => {
    const res = await request(app).post('/api/riot/connect').set(H).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
    expect((await request(app).post('/api/riot/connect').set(H).send({ consent: false })).status).toBe(400);
  });

  it('mock authorize page and bad state / cancel', async () => {
    const flow = request.agent(app);
    const c = await flow.post('/api/riot/connect').set(H).send({ consent: true });
    expect(c.body.redirectUrl).toMatch(/^\/api\/riot\/mock-authorize\?state=/);
    const page = await request(app).get(c.body.redirectUrl);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Mock Riot Sign On (demo)');
    expect(page.text).toContain('fixture-token-0001');
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");

    const bad = await request(app).get('/api/riot/callback?code=fixture-token-0001&state=bogus');
    expect(bad.status).toBe(302);
    expect(bad.headers.location).toContain('/settings?error=state');

    const state = new URL(c.body.redirectUrl, 'http://x').searchParams.get('state');
    // a callback URL replayed in a different browser (no binding cookie) is rejected
    const foreign = await request(app).get(`/api/riot/callback?code=fixture-token-0001&state=${state}`);
    expect(foreign.headers.location).toContain('error=state');
    const cancelled = await flow.get(`/api/riot/callback?error=access_denied&state=${state}`);
    expect(cancelled.headers.location).toContain('error=cancelled');
    // state is single-use
    const replay = await flow.get(`/api/riot/callback?code=fixture-token-0001&state=${state}`);
    expect(replay.headers.location).toContain('error=state');
  });

  let aAgent: ReturnType<typeof request.agent>;
  let b: ReturnType<typeof request.agent>;
  let matchesOnlyIn1: string;

  it('signed-out happy path creates a user + session and links puuid 0002', async () => {
    aAgent = request.agent(app);
    await aAgent.post('/api/dev/login').set(H);
    b = request.agent(app);
    const cb = await rsoCallback(b, 'fixture-token-0002');
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('http://localhost:5173/settings?linked=1');
    expect(String(cb.headers['set-cookie'])).toMatch(/va_session=/);
    const me = await b.get('/api/me');
    expect(me.body.user.displayName).toBe('OtherDemo');
    expect(me.body.link.riotId).toBe('OtherDemo#0002');
    await queue.idle();
    expect((await b.get('/api/me')).body.link.state).toBe('up_to_date');
    const only1 = matchlistIds(PUUID_1).filter((id) => !matchlistIds(PUUID_2).includes(id));
    expect(only1.length).toBeGreaterThan(0);
    matchesOnlyIn1 = only1[0]!;
  }, 60_000);

  it('second user cannot see user 1 data (detail 404, summary, export)', async () => {
    const mine = matchlistIds(PUUID_2);
    // matchesOnlyIn1 may be an excluded/non-competitive match for user 1: any id outside 0002's list must still 404
    const detail = await b.get(`/api/matches/${matchesOnlyIn1}`);
    expect(detail.status).toBe(404);
    const list1 = (await aAgent.get('/api/matches?pageSize=100&queueId=all')).body as Paginated<MatchSummaryDto>;
    const outside = list1.items.filter((m) => !mine.includes(m.matchId));
    expect(outside.length).toBeGreaterThan(0);
    for (const m of outside) expect((await b.get(`/api/matches/${m.matchId}`)).status).toBe(404);

    const sum2 = (await b.get('/api/summary?queueId=all')).body as SummaryResponse;
    const sum1 = (await aAgent.get('/api/summary?queueId=all')).body as SummaryResponse;
    expect(sum2.overall.matches).toBeLessThan(sum1.overall.matches);
    expect(sum2.overall.matches).toBeLessThanOrEqual(mine.length);

    const csv = (await b.get('/api/export.csv?queueId=all')).text;
    for (const m of outside) expect(csv).not.toContain(m.matchId);
    expect(csv).not.toContain(PUUID_1);
    expect(csv).toContain(PUUID_2);
    const matches2 = (await b.get('/api/matches?pageSize=100&queueId=all')).body as Paginated<MatchSummaryDto>;
    expect(matches2.items.every((m) => mine.includes(m.matchId))).toBe(true);
  });

  it("another user's sync job is 404", async () => {
    const job = await aAgent.post('/api/sync').set(H);
    expect(job.status).toBe(202);
    await queue.idle();
    expect((await aAgent.get(`/api/sync/${job.body.jobId}`)).status).toBe(200);
    expect((await b.get(`/api/sync/${job.body.jobId}`)).status).toBe(404);
  });

  it('DELETE /account-link removes data and unlinks', async () => {
    const del = await b.delete('/api/account-link').set(H);
    expect(del.status).toBe(204);
    const me = await b.get('/api/me');
    expect(me.body.link.state).toBe('unlinked');
    const sum = await b.get('/api/summary');
    expect(sum.status).toBe(200);
    expect(sum.body.overall.matches).toBe(0);
    expect((await b.get('/api/matches')).body.total).toBe(0);
    expect((await b.get(`/api/matches/${matchlistIds(PUUID_2)[0]}`)).status).toBe(404);
    // user 1 is untouched
    expect((await aAgent.get('/api/summary')).body.overall.matches).toBeGreaterThan(0);
  });

  it('signed-in happy path links for that user; already-linked puuid is rejected', async () => {
    const c = await createUser(db, { displayName: 'Signed In C' });
    const { token } = await createSession(db, c.id, 3_600_000);
    const agent = request.agent(app);
    agent.jar.setCookie(`va_session=${token}`);
    const cb = await rsoCallback(agent, 'fixture-token-0002');
    expect(cb.headers.location).toContain('linked=1');
    const acc = await getRiotAccount(db, c.id);
    expect(acc?.puuid).toBe(PUUID_2);
    expect((await agent.get('/api/me')).body.user.displayName).toBe('Signed In C');
    await queue.idle();

    const d = await createUser(db, { displayName: 'Signed In D' });
    const dSession = await createSession(db, d.id, 3_600_000);
    const dAgent = request.agent(app);
    dAgent.jar.setCookie(`va_session=${dSession.token}`);
    const dup = await rsoCallback(dAgent, 'fixture-token-0002');
    expect(dup.headers.location).toContain('error=already_linked');
    expect(await getRiotAccount(db, d.id)).toBeNull();
    const dup1 = await rsoCallback(dAgent, 'fixture-token-0001');
    expect(dup1.headers.location).toContain('error=already_linked');
  }, 60_000);

  it('unknown fixture token ends in error=riot, not a 500', async () => {
    const res = await rsoCallback(request.agent(app), 'not-a-token');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=riot');
  });

  it('unlinked signed-in user gets empty data and 404 detail', async () => {
    const u = await createUser(db, { displayName: 'Nobody' });
    const { token } = await createSession(db, u.id, 3_600_000);
    const agent = request.agent(app);
    agent.jar.setCookie(`va_session=${token}`);
    const sum = await agent.get('/api/summary');
    expect(sum.status).toBe(200);
    expect(sum.body.overall.matches).toBe(0);
    expect((await agent.get('/api/matches')).body.items).toEqual([]);
    expect((await agent.get('/api/matches/abc')).status).toBe(404);
    expect((await agent.post('/api/sync').set(H)).status).toBe(409);
  });
});

describe('modes and limits', () => {
  it('non-demo env: /dev/login and mock authorize are 404', async () => {
    const real = mkApp(baseEnv({ demoMode: false, cookieSecure: true }));
    expect((await request(real).post('/api/dev/login').set(H)).status).toBe(404);
    expect((await request(real).get('/api/riot/mock-authorize?state=x')).status).toBe(404);
  });

  it('rate limits sensitive routes with 429', async () => {
    const limited = mkApp(baseEnv({ rateLimitSensitivePerMinute: 2 }));
    const post = () => request(limited).post('/api/riot/connect').set(H).send({ consent: true });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    const third = await post();
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('rate_limited');
    expect(third.headers['retry-after']).toBeTruthy();
  });

  it('invalid JSON is a 400 validation error', async () => {
    const res = await request(app).post('/api/riot/connect').set(H).set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
  });
});
