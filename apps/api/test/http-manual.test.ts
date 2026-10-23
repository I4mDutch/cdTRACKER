import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { FilterOptionsResponse, ImportResponse, ManualMatchDto, ManualMatchInput } from '@va/shared';
import { MANUAL_CSV_COLUMNS } from '@va/shared';
import { createApp } from '../src/app.js';
import type { Env } from '../src/env.js';
import { createPgliteDb, createSession, createUser, upsertContent, type Db } from '../src/db/index.js';
import { SyncQueue } from '../src/ingestion/index.js';
import { DEFAULT_FIXTURE_DIR, FixtureRiotClient } from '../src/riot/index.js';
import { MockRsoProvider } from '../src/http/rso.js';

const H = { 'X-Requested-With': 'va-web' };

const env: Env = {
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
};

let db: Db;
let queue: SyncQueue;
let app: Express;
let catalog: FilterOptionsResponse['catalog'];
const riot = new FixtureRiotClient({ dir: DEFAULT_FIXTURE_DIR });

type Agent = ReturnType<typeof request.agent>;
async function signedIn(name: string): Promise<Agent> {
  const user = await createUser(db, { displayName: name });
  const { token } = await createSession(db, user.id, 3_600_000);
  const agent = request.agent(app);
  agent.jar.setCookie(`va_session=${token}`);
  return agent;
}

const entry = (over: Partial<ManualMatchInput> = {}): ManualMatchInput => ({
  date: '2025-03-14',
  mapId: catalog.maps[0]!.id,
  agentId: catalog.agents[0]!.id,
  queueId: 'competitive',
  roundsWon: 13,
  roundsLost: 9,
  kills: 18,
  deaths: 12,
  assists: 5,
  acs: 245,
  adr: 160,
  firstKills: 3,
  firstDeaths: 2,
  note: 'scrim after work',
  ...over,
});

beforeAll(async () => {
  db = await createPgliteDb();
  queue = new SyncQueue({ db, riot });
  app = createApp({ db, riot, rso: new MockRsoProvider(), queue, env });
  const content = await riot.getContent('na');
  await upsertContent(db, [
    ...content.characters.map((c) => ({ kind: 'agent' as const, id: c.id, name: c.name, assetPath: null })),
    ...content.maps.map((m) => ({ kind: 'map' as const, id: m.id, name: m.name, assetPath: m.assetPath ?? null })),
  ]);
  const probe = await signedIn('Probe');
  catalog = ((await probe.get('/api/filters/options')).body as FilterOptionsResponse).catalog;
}, 60_000);

afterAll(async () => {
  await queue.idle();
});

describe('manual entry without a linked Riot account', () => {
  let u: Agent;
  let created: ManualMatchDto;

  beforeAll(async () => {
    u = await signedIn('Manual Only');
  });

  it('exposes a sorted catalog with map ids', () => {
    expect(catalog.agents.length).toBeGreaterThan(1);
    expect(catalog.maps.length).toBeGreaterThan(1);
    const names = catalog.maps.map((m) => m.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('POST creates an entry (201) with a derived outcome', async () => {
    const res = await u.post('/api/manual-matches').set(H).send(entry());
    expect(res.status).toBe(201);
    created = res.body as ManualMatchDto;
    expect(created.id).toMatch(/^manual-[0-9a-f-]{36}$/);
    expect(created).toMatchObject({ outcome: 'win', acs: 245, adr: 160, excluded: null, startedAt: '2025-03-14T12:00:00.000Z', note: 'scrim after work' });
    expect((await u.get(`/api/manual-matches/${created.id}`)).body).toEqual(created);
  });

  it('shows up in matches, summary, detail and export with source manual', async () => {
    const list = await u.get('/api/matches?queueId=all');
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ matchId: created.id, source: 'manual', outcome: 'win', acs: 245 });

    const summary = await u.get('/api/summary');
    expect(summary.body.sources).toEqual({ riot: 0, manual: 1 });
    expect(summary.body.overall.matches).toBe(1);

    const detail = await u.get(`/api/matches/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.rounds).toEqual([]);
    expect(detail.body.durationMs).toBeNull();
    expect(detail.body.manual).toMatchObject({ note: 'scrim after work' });
    expect(detail.body.teams).toEqual([
      { teamId: 'you', isPlayerTeam: true, roundsWon: 13, won: true },
      { teamId: 'opponents', isPlayerTeam: false, roundsWon: 9, won: false },
    ]);
    const fs = (f: string) => detail.body.fieldSources.find((x: { field: string }) => x.field === f)?.source;
    expect(fs('kills')).toBe('manual');
    expect(fs('acs')).toBe('manual');
    expect(fs('winRate')).toBe('calculated');
    expect(fs('performanceScore')).toBe('unavailable');

    for (const p of ['agents', 'maps', 'insights', 'score']) {
      expect((await u.get(`/api/${p}`)).body.sources).toEqual({ riot: 0, manual: 1 });
    }

    const csv = await u.get('/api/export.csv');
    const lines = csv.text.trim().split('\r\n');
    expect(lines[0]).toContain(',source,');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(created.id);
    expect(lines[1]).toContain(',manual,');
    expect((await u.get('/api/export.csv?definitions=1')).text).toContain('source,');
  });

  it('stores unknown optional stats as null (Not entered), never 0', async () => {
    const res = await u.post('/api/manual-matches').set(H).send(entry({ date: '2025-03-15', acs: null, adr: undefined, firstKills: null, firstDeaths: null }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ acs: null, adr: null, firstKills: null, firstDeaths: null });
    const detail = await u.get(`/api/matches/${res.body.id}`);
    const f = detail.body.fieldSources.find((x: { field: string }) => x.field === 'acs');
    expect(f).toMatchObject({ source: 'unavailable', note: 'Not entered' });
    await u.delete(`/api/manual-matches/${res.body.id}`).set(H);
  });

  it('rejects invalid input with field names', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const cases: [Partial<ManualMatchInput>, RegExp][] = [
      [{ date: future }, /date: .*future/],
      [{ date: '2019-01-01' }, /date: .*before/],
      [{ date: 'yesterday' }, /date: /],
      [{ mapId: 'nope' }, /mapId: unknown map/],
      [{ agentId: 'nope' }, /agentId: unknown agent/],
      [{ firstKills: 20, firstDeaths: 10 }, /firstKills/],
      [{ kills: -1 }, /kills: /],
      [{ kills: 151 }, /kills: /],
      [{ roundsWon: 51 }, /roundsWon: /],
      [{ roundsWon: 0, roundsLost: 0 }, /roundsWon/],
      [{ acs: 1001 }, /acs: /],
      [{ patch: 'nine' }, /patch: /],
      [{ queueId: 'ranked' as never }, /queueId: /],
      [{ note: 'x'.repeat(501) }, /note: /],
    ];
    for (const [over, re] of cases) {
      const res = await u.post('/api/manual-matches').set(H).send(entry(over));
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(res.body.error.code).toBe('validation');
      expect(res.body.error.message).toMatch(re);
    }
  });

  it('409 on an identical entry', async () => {
    const res = await u.post('/api/manual-matches').set(H).send(entry());
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'duplicate', message: 'An identical manual entry already exists.' });
  });

  it('PUT updates the entry and the derived outcome; duplicate on PUT is 409', async () => {
    const put = await u.put(`/api/manual-matches/${created.id}`).set(H).send(entry({ roundsWon: 5, roundsLost: 13, note: null }));
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ id: created.id, outcome: 'loss', roundsWon: 5, note: null });
    expect((await u.get('/api/matches?queueId=all')).body.items[0].outcome).toBe('loss');

    const other = await u.post('/api/manual-matches').set(H).send(entry({ date: '2025-03-16' }));
    expect(other.status).toBe(201);
    const clash = await u.put(`/api/manual-matches/${other.body.id}`).set(H).send(entry({ roundsWon: 5, roundsLost: 13 }));
    expect(clash.status).toBe(409);
    expect((await u.put(`/api/manual-matches/${created.id}`).set(H).send(entry({ kills: -3 }))).status).toBe(400);
    await u.delete(`/api/manual-matches/${other.body.id}`).set(H);
  });

  it('flags unsupported queues as excluded', async () => {
    const res = await u.post('/api/manual-matches').set(H).send(entry({ date: '2025-03-17', queueId: 'unrated' }));
    expect(res.status).toBe(201);
    expect(res.body.excluded).toBe('unsupported_queue');
    await u.delete(`/api/manual-matches/${res.body.id}`).set(H);
  });

  it('bad ids are 404; other users cannot see, change or delete an entry', async () => {
    expect((await u.get('/api/manual-matches/not-an-id')).status).toBe(404);
    expect((await u.get('/api/manual-matches/manual-nope')).status).toBe(404);
    expect((await u.get('/api/matches/manual-00000000-0000-4000-8000-000000000000')).status).toBe(404);
    const v = await signedIn('Other');
    expect((await v.get(`/api/manual-matches/${created.id}`)).status).toBe(404);
    expect((await v.get(`/api/matches/${created.id}`)).status).toBe(404);
    expect((await v.put(`/api/manual-matches/${created.id}`).set(H).send(entry())).status).toBe(404);
    expect((await v.delete(`/api/manual-matches/${created.id}`).set(H)).status).toBe(404);
    expect((await v.get('/api/matches?queueId=all')).body.total).toBe(0);
    expect((await u.get(`/api/manual-matches/${created.id}`)).status).toBe(200);
  });

  it('requires sign-in and the CSRF header on every manual route', async () => {
    const anon = request.agent(app);
    expect((await anon.get('/api/manual-matches/template.csv')).status).toBe(401);
    expect((await anon.post('/api/manual-matches').set(H).send(entry())).status).toBe(401);
    expect((await u.post('/api/manual-matches').send(entry({ date: '2025-04-01' }))).status).toBe(403);
    expect((await u.put(`/api/manual-matches/${created.id}`).send(entry())).status).toBe(403);
    expect((await u.delete(`/api/manual-matches/${created.id}`)).status).toBe(403);
    expect((await u.delete('/api/manual-matches').send({ confirm: true })).status).toBe(403);
    expect((await u.post('/api/manual-matches/import').send({ csv: 'x', dryRun: true })).status).toBe(403);
    expect((await u.get(`/api/manual-matches/${created.id}`)).status).toBe(200);
  });

  it('/sync still needs a linked account', async () => {
    expect((await u.post('/api/sync').set(H)).status).toBe(409);
  });

  it('DELETE one, then DELETE all requires confirm', async () => {
    const extra = await u.post('/api/manual-matches').set(H).send(entry({ date: '2025-03-20' }));
    expect((await u.delete(`/api/manual-matches/${extra.body.id}`).set(H)).status).toBe(204);
    expect((await u.delete(`/api/manual-matches/${extra.body.id}`).set(H)).status).toBe(404);

    expect((await u.delete('/api/manual-matches').set(H)).status).toBe(400);
    expect((await u.delete('/api/manual-matches').set(H).send({ confirm: false })).status).toBe(400);
    expect((await u.get('/api/matches?queueId=all')).body.total).toBe(1);
    expect((await u.delete('/api/manual-matches').set(H).send({ confirm: true })).status).toBe(204);
    expect((await u.get('/api/matches?queueId=all')).body.total).toBe(0);
  });
});

describe('CSV import', () => {
  let u: Agent;
  const mapName = (): string => catalog.maps[0]!.name;
  const agentName = (): string => catalog.agents[0]!.name;
  const HEAD = 'date,map,agent,rounds_won,rounds_lost,kills,deaths,assists,acs,note';
  const row = (day: string, kills = 10): string => `${day},${mapName()},${agentName()},13,7,${kills},8,4,230,`;
  const post = (a: Agent, csv: string, dryRun: boolean) => a.post('/api/manual-matches/import').set(H).send({ csv, dryRun });
  const total = async (a: Agent): Promise<number> => (await a.get('/api/matches?queueId=all')).body.total as number;

  beforeAll(async () => {
    u = await signedIn('Importer');
  });

  it('dry run reports per-row status and saves nothing', async () => {
    const csv = `${HEAD}\n${row('2025-02-01')}\n${row('2025-02-02')}\n`;
    const res = await post(u, csv, true);
    expect(res.status).toBe(200);
    const body = res.body as ImportResponse;
    expect(body).toMatchObject({ dryRun: true, imported: 0, counts: { valid: 2, invalid: 0, duplicate: 0 } });
    expect(body.rows.map((r) => [r.line, r.status])).toEqual([[2, 'valid'], [3, 'valid']]);
    expect(body.rows[0]!.parsed).toMatchObject({ roundsWon: 13, kills: 10, acs: 230, note: null });
    expect(await total(u)).toBe(0);
  });

  it('imports nothing when any row is invalid', async () => {
    const csv = `${HEAD}\n${row('2025-02-01')}\n${row('2025-02-02', 999)}\n`;
    const res = await post(u, csv, false);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ imported: 0, counts: { valid: 1, invalid: 1, duplicate: 0 } });
    expect(res.body.rows[1]).toMatchObject({ line: 3, status: 'invalid', parsed: null });
    expect(res.body.rows[1].errors[0]).toMatch(/^kills: /);
    expect(await total(u)).toBe(0);
  });

  it('imports a valid file, then marks a re-import all duplicate', async () => {
    const csv = `﻿${HEAD}\r\n${row('2025-02-01')}\r\n${row('2025-02-02')}\r\n${row('2025-02-03')}\r\n`;
    const res = await post(u, csv, false);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: false, imported: 3, counts: { valid: 3, invalid: 0, duplicate: 0 } });
    expect(await total(u)).toBe(3);
    expect((await u.get('/api/summary')).body.sources.manual).toBe(3);

    const again = await post(u, csv, false);
    expect(again.body).toMatchObject({ imported: 0, counts: { valid: 0, invalid: 0, duplicate: 3 } });
    expect(await total(u)).toBe(3);
  });

  it('marks in-file duplicates and imports the rest', async () => {
    const csv = `${HEAD}\n${row('2025-03-01')}\n${row('2025-03-01')}\n${row('2025-03-02')}\n`;
    const res = await post(u, csv, false);
    expect(res.body).toMatchObject({ imported: 2, counts: { valid: 2, invalid: 0, duplicate: 1 } });
    expect(res.body.rows[1]).toMatchObject({ line: 3, status: 'duplicate' });
    expect(await total(u)).toBe(5);
  });

  it('file-level problems are 400 validation errors', async () => {
    const bad = async (csv: unknown, re: RegExp) => {
      const res = await u.post('/api/manual-matches/import').set(H).send({ csv, dryRun: true });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
      expect(res.body.error.message).toMatch(re);
    };
    await bad(`${HEAD},bogus\n${row('2025-02-01')},1`, /bogus/);
    await bad('date,map\n2025-01-01,x', /Missing required column/);
    await bad(`${HEAD}\n"unclosed,1`, /line 2/);
    await bad('', /empty/);
    await bad(`${HEAD}\n` + Array.from({ length: 1001 }, (_, i) => row('2025-01-01', i % 100)).join('\n'), /Too many rows/);
    await bad('x'.repeat(1_000_001), /too large/);
    await bad(42, /csv/);
    const noBody = await u.post('/api/manual-matches/import').set(H).send({});
    expect(noBody.status).toBe(400);
  });

  it('the template downloads and parses back with one valid row', async () => {
    const res = await u.get('/api/manual-matches/template.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="valorant-analyzer-manual-template.csv"');
    expect(res.text.split('\r\n')[0]).toBe(MANUAL_CSV_COLUMNS.map((c) => c.name).join(','));
    expect(res.text).toContain(catalog.maps[0]!.name);
    const dry = await post(u, res.text, true);
    expect(dry.body).toMatchObject({ counts: { valid: 1, invalid: 0, duplicate: 0 } });
  });
});

describe('demo user with Riot data and manual entries', () => {
  let d: Agent;

  beforeAll(async () => {
    d = request.agent(app);
    expect((await d.post('/api/dev/login').set(H)).status).toBe(200);
    await queue.idle();
    expect((await d.post('/api/manual-matches').set(H).send(entry({ date: '2025-03-14' }))).status).toBe(201);
    expect((await d.post('/api/manual-matches').set(H).send(entry({ date: '2025-03-15', agentId: catalog.agents[1]!.id }))).status).toBe(201);
  });

  it('filters by source and reports sources on analysis responses', async () => {
    const all = (await d.get('/api/summary')).body;
    const riotOnly = (await d.get('/api/summary?source=riot')).body;
    const manualOnly = (await d.get('/api/summary?source=manual')).body;
    expect(riotOnly.sources.manual).toBe(0);
    expect(riotOnly.sources.riot).toBeGreaterThan(0);
    expect(manualOnly.sources).toEqual({ riot: 0, manual: 2 });
    expect(all.sources).toEqual({ riot: riotOnly.sources.riot, manual: 2 });
    expect(all.overall.matches).toBe(riotOnly.overall.matches + 2);

    const list = (await d.get('/api/matches?source=manual&queueId=all')).body;
    expect(list.total).toBe(2);
    expect(list.items.every((i: { source: string }) => i.source === 'manual')).toBe(true);
    const riotList = (await d.get('/api/matches?source=riot&queueId=all')).body;
    expect(riotList.items.every((i: { source: string }) => i.source === 'riot')).toBe(true);
    expect((await d.get('/api/matches?source=bogus')).status).toBe(400);

    expect((await d.get('/api/insights')).body.sources).toEqual(all.sources);
    expect((await d.get('/api/score')).body.sources).toEqual(all.sources);
    expect((await d.get('/api/agents?source=manual')).body.sources).toEqual({ riot: 0, manual: 2 });
    expect((await d.get('/api/export.csv?queueId=all')).text).toContain(',manual,');
  });

  it('the public card counts both sources and says so', async () => {
    const link = await d.post('/api/share-links').set(H).send({ fields: ['winRate', 'matchCount'] });
    expect(link.status).toBe(201);
    const token = (link.body.url as string).split('/p/')[1];
    const card = (await request(app).get(`/api/public/${token}`)).body;
    const riotCompetitive = (await d.get('/api/summary?source=riot')).body.overall.matches;
    expect(card.manualCount).toBe(2);
    expect(card.matchCount).toBe(riotCompetitive + 2);
    expect(card.disclaimer).toMatch(/ Includes 2 manually entered matches\.$/);
  });

  it('the public card for a manual-only user has no suffix when there are none', async () => {
    const x = await signedIn('NoManual');
    const link = await x.post('/api/share-links').set(H).send({ fields: ['matchCount'] });
    const token = (link.body.url as string).split('/p/')[1];
    const card = (await request(app).get(`/api/public/${token}`)).body;
    expect(card).toMatchObject({ manualCount: 0, matchCount: 0 });
    expect(card.disclaimer).not.toContain('manually');
  });

  it('unlinking keeps manual entries', async () => {
    expect((await d.delete('/api/account-link').set(H)).status).toBe(204);
    const sum = (await d.get('/api/summary')).body;
    expect(sum.sources).toEqual({ riot: 0, manual: 2 });
    expect((await d.get('/api/matches?queueId=all')).body.total).toBe(2);
  });
});
