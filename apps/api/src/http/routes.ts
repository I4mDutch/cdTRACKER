import { Router, type Request, type Response } from 'express';
import { asc, eq } from 'drizzle-orm';
import {
  DEFAULT_AGGREGATE_CONFIG,
  DEFAULT_ANALYSIS_CONFIG,
  DEFAULT_SCORE_CONFIG,
  computeAnalyzerScore,
  computeStatLine,
  computeTrend,
  filterRecords,
  generateFindings,
  groupStats,
  type NameLookup,
} from '@va/core';
import type {
  BreakdownResponse,
  ConnectResponse,
  FilterOptionsResponse,
  InsightsResponse,
  LinkState,
  MatchFilter,
  MeResponse,
  Paginated,
  PublicProfileDto,
  ScoreResponse,
  ShareLinkDto,
  SummaryResponse,
  SyncResponse,
} from '@va/shared';
import {
  consumeOAuthState,
  createOAuthState,
  createSession,
  createShareLink,
  createUser,
  deleteSession,
  deleteUserMatchData,
  getJob,
  getNameLookup,
  getPlayerMatch,
  getRiotAccount,
  getRiotAccountByPuuid,
  getUser,
  listFeedback,
  listPlayerRecords,
  listShareLinks,
  resolveShareToken,
  revokeShareLink,
  saveFeedback,
  saveSnapshot,
  schema,
  upsertRiotAccount,
  type Db,
  type RiotAccountRow,
  type ShareLinkRow,
  type StoredPlayerRecord,
  type UserRow,
} from '../db/index.js';
import type { SyncQueue } from '../ingestion/index.js';
import type { RiotClient } from '../riot/index.js';
import type { Env } from '../env.js';
import { ALL_COLUMNS, COLUMN_DEFINITIONS, RECORD_COLUMNS, toCsv } from './csv.js';
import { csvRow, toBreakdownRows, toMatchDetail, toMatchSummary } from './dto.js';
import { HttpError, log } from './errors.js';
import { SESSION_COOKIE, currentToken, currentUser, rateLimit, requireUser, userOf } from './middleware.js';
import type { RsoProvider } from './rso.js';
import { connectSchema, createShareSchema, feedbackSchema, paginationSchema as pagination, parse, parseFilter } from './validation.js';

export interface RouterDeps {
  db: Db;
  riot: RiotClient;
  rso: RsoProvider;
  queue: SyncQueue;
  env: Env;
}

const DEMO_PUUID = 'demo-puuid-0001';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TREND_WINDOW = 10;
const RECENT_COUNT = 10;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const jobState = (s: string): SyncResponse['state'] =>
  s === 'queued' || s === 'running' || s === 'succeeded' ? s : 'failed';

const isoDay = (iso: string): string => iso.slice(0, 10);

export function createApiRouter(deps: RouterDeps): Router {
  const { db, riot, rso, queue, env } = deps;
  const router = Router();

  // ---------- helpers ----------
  const setSessionCookie = async (res: Response, userId: string): Promise<void> => {
    const ttlMs = env.sessionTtlHours * 3_600_000;
    const { token, expiresAt } = await createSession(db, userId, ttlMs);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.cookieSecure,
      path: '/',
      expires: expiresAt,
    });
  };

  const meFor = async (user: UserRow | null): Promise<MeResponse> => {
    const account = user ? await getRiotAccount(db, user.id) : null;
    return {
      user: user ? { id: user.id, displayName: user.displayName } : null,
      link: {
        state: (account?.linkState as LinkState | undefined) ?? 'unlinked',
        riotId: account?.gameName ? `${account.gameName}#${account.tagLine ?? ''}` : null,
        region: account?.shard ?? null,
        lastSyncedAt: account?.lastSyncedAt?.toISOString() ?? null,
        lastError: account?.lastError ?? null,
        consentedAt: account?.consentedAt?.toISOString() ?? null,
      },
      demoMode: env.demoMode,
    };
  };

  /** Authorization by construction: data routes only ever use the session user's own puuid. */
  const puuidOf = async (res: Response): Promise<string | null> => {
    const account = await getRiotAccount(db, userOf(res).id);
    if (!account || account.linkState === 'unlinked' || account.linkState === 'consent_removed') return null;
    return account.puuid;
  };

  const loadFiltered = async (
    req: Request,
    res: Response,
    opts?: { includeExcluded?: boolean },
  ): Promise<{ filter: MatchFilter; records: StoredPlayerRecord[]; all: StoredPlayerRecord[] }> => {
    const filter = parseFilter(req.query);
    const puuid = await puuidOf(res);
    const all = puuid ? await listPlayerRecords(db, puuid, opts) : [];
    return { filter, all, records: filterRecords(all, filter) as StoredPlayerRecord[] };
  };

  const redirectSettings = (res: Response, query: string): void => {
    res.redirect(302, `${env.publicBaseUrl}/settings?${query}`);
  };

  // ---------- rate limits ----------
  const sensitive = rateLimit({ max: env.rateLimitSensitivePerMinute, group: 'sensitive' });
  router.use(rateLimit({ max: env.rateLimitPerMinute, group: 'general' }));

  // ---------- session ----------
  router.get('/me', async (_req, res) => {
    res.json(await meFor(currentUser(res)));
  });

  router.post('/dev/login', async (_req, res) => {
    if (!env.demoMode) throw new HttpError(404, 'not_found', 'Not found.');
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.isDemo, true)).orderBy(asc(schema.users.createdAt)).limit(1);
    const user = existing ?? (await createUser(db, { displayName: 'Demo Player', isDemo: true }));
    const account = await getRiotAccount(db, user.id);
    if (!account) {
      const owner = await getRiotAccountByPuuid(db, DEMO_PUUID);
      if (owner) throw new HttpError(409, 'conflict', 'The demo Riot account is linked to another user.');
      await upsertRiotAccount(db, {
        userId: user.id,
        puuid: DEMO_PUUID,
        gameName: 'DemoPlayer',
        tagLine: '0001',
        shard: 'na',
        consentedAt: new Date(),
      });
    }
    await queue.enqueue(user.id);
    await setSessionCookie(res, user.id);
    res.json(await meFor(user));
  });

  router.post('/logout', async (_req, res) => {
    const token = currentToken(res);
    if (token) await deleteSession(db, token);
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: env.cookieSecure, path: '/' });
    res.status(204).end();
  });

  // ---------- RSO ----------
  router.post('/riot/connect', sensitive, async (req, res) => {
    parse(connectSchema, req.body);
    const state = await createOAuthState(db, currentUser(res)?.id ?? null);
    const body: ConnectResponse = { redirectUrl: rso.authorizeUrl(state) };
    res.json(body);
  });

  router.get('/riot/mock-authorize', (req, res) => {
    if (!env.demoMode) throw new HttpError(404, 'not_found', 'Not found.');
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const enc = encodeURIComponent(state);
    const approve = `/api/riot/callback?code=fixture-token-0001&state=${enc}`;
    const cancel = `/api/riot/callback?error=access_denied&state=${enc}`;
    res
      .status(200)
      .type('html')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<title>Mock Riot Sign On (demo)</title>` +
          `<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem}a{display:inline-block;margin:.5rem .75rem .5rem 0;padding:.6rem 1rem;border:1px solid #444;border-radius:6px;text-decoration:none;color:inherit}</style>` +
          `</head><body><h1>Mock Riot Sign On (demo)</h1>` +
          `<p>This is a stand-in for Riot Sign On. No real account is used. Approving signs you in as the demo player.</p>` +
          `<a href="${escapeHtml(approve)}">Approve</a><a href="${escapeHtml(cancel)}">Cancel</a></body></html>`,
      );
  });

  router.get('/riot/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const st = state ? await consumeOAuthState(db, state) : null;
    if (!st) return redirectSettings(res, 'error=state');
    if (typeof req.query.error === 'string') return redirectSettings(res, 'error=cancelled');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) return redirectSettings(res, 'error=cancelled');

    let riotAccount;
    try {
      // The access token lives only inside this try block: never stored, never logged.
      const { accessToken } = await rso.exchangeCode(code);
      riotAccount = await riot.getMyAccount(accessToken);
    } catch (err) {
      log('rso_callback_failed', { error: err instanceof Error ? err.name : 'unknown' });
      return redirectSettings(res, 'error=riot');
    }
    const puuid = riotAccount.puuid;
    const link = { puuid, gameName: riotAccount.gameName ?? null, tagLine: riotAccount.tagLine ?? null, shard: 'na', consentedAt: new Date() };
    const owner = await getRiotAccountByPuuid(db, puuid);

    let userId: string;
    if (st.userId) {
      // Linking while signed in.
      if (owner && owner.userId !== st.userId) return redirectSettings(res, 'error=already_linked');
      const current = await getRiotAccount(db, st.userId);
      if (current && current.puuid !== puuid) await deleteUserMatchData(db, st.userId); // switching accounts: drop the old account's data
      await upsertRiotAccount(db, { userId: st.userId, ...link });
      userId = st.userId;
      if (!currentUser(res) || currentUser(res)?.id !== userId) await setSessionCookie(res, userId);
    } else {
      // RSO as sign-in.
      if (owner) {
        userId = owner.userId;
        await upsertRiotAccount(db, { userId, ...link });
      } else {
        const user = await createUser(db, { displayName: riotAccount.gameName ?? 'Player' });
        userId = user.id;
        await upsertRiotAccount(db, { userId, ...link });
      }
      await setSessionCookie(res, userId);
    }
    await queue.enqueue(userId);
    redirectSettings(res, 'linked=1');
  });

  // ---------- sync ----------
  router.post('/sync', requireUser, sensitive, async (_req, res) => {
    const user = userOf(res);
    if (!(await puuidOf(res))) throw new HttpError(409, 'not_linked', 'Link a Riot account first.');
    const job = await queue.enqueue(user.id);
    const body: SyncResponse = { jobId: job.id, state: jobState(job.state) };
    res.status(202).json(body);
  });

  router.get('/sync/:jobId', requireUser, async (req, res) => {
    const id = String(req.params.jobId);
    const job = UUID_RE.test(id) ? await getJob(db, id, userOf(res).id) : null;
    if (!job) throw new HttpError(404, 'not_found', 'Sync job not found.');
    const body: SyncResponse = { jobId: job.id, state: jobState(job.state) };
    res.json(body);
  });

  // ---------- data ----------
  router.get('/filters/options', requireUser, async (_req, res) => {
    const puuid = await puuidOf(res);
    const records = puuid ? await listPlayerRecords(db, puuid) : [];
    const names = await getNameLookup(db);
    const uniq = (xs: (string | null)[]): string[] => [...new Set(xs.filter((x): x is string => x !== null))].sort();
    const body: FilterOptionsResponse = {
      agents: uniq(records.map((r) => r.agentId)).map((id) => ({ id, name: names.agents[id] ?? id })),
      maps: uniq(records.map((r) => r.mapId)).map((id) => ({ id, name: names.maps[id] ?? id })),
      queues: uniq(records.map((r) => r.queueId)),
      patches: uniq(records.map((r) => r.patch)).reverse(),
    };
    res.json(body);
  });

  router.get('/matches', requireUser, async (req, res) => {
    const { page, pageSize } = parse(pagination, req.query);
    const { records } = await loadFiltered(req, res, { includeExcluded: true });
    const names = await getNameLookup(db);
    const newestFirst = [...records].reverse();
    const items = newestFirst.slice((page - 1) * pageSize, page * pageSize).map((r) => toMatchSummary(r, names));
    const body: Paginated<(typeof items)[number]> = { items, page, pageSize, total: newestFirst.length };
    res.json(body);
  });

  router.get('/matches/:matchId', requireUser, async (req, res) => {
    const puuid = await puuidOf(res);
    const found = puuid ? await getPlayerMatch(db, String(req.params.matchId), puuid) : null;
    if (!found) throw new HttpError(404, 'not_found', 'Match not found.');
    res.json(toMatchDetail(found.match, found.record, found.rounds, await getNameLookup(db)));
  });

  router.get('/summary', requireUser, async (req, res) => {
    const { filter, records } = await loadFiltered(req, res);
    const names = await getNameLookup(db);
    const body: SummaryResponse = {
      filter,
      overall: computeStatLine(records),
      trends: (['winRate', 'kd'] as const).map((metric) => ({
        metric,
        window: TREND_WINDOW,
        points: computeTrend(records, metric, TREND_WINDOW),
      })),
      recent: records.slice(-RECENT_COUNT).reverse().map((r) => toMatchSummary(r, names)),
      range: { from: records[0]?.startedAt ?? null, to: records[records.length - 1]?.startedAt ?? null },
    };
    res.json(body);
  });

  const breakdown = (key: 'agentId' | 'mapId') => async (req: Request, res: Response) => {
    const { filter, records } = await loadFiltered(req, res);
    const names = await getNameLookup(db);
    const lookup = key === 'agentId' ? names.agents : names.maps;
    const baseline = computeStatLine(records);
    const body: BreakdownResponse = {
      filter,
      baseline,
      rows: toBreakdownRows(groupStats(records, key), baseline, (id) => lookup[id] ?? id),
      lowSampleThreshold: DEFAULT_AGGREGATE_CONFIG.lowSampleMatches,
    };
    res.json(body);
  };
  router.get('/agents', requireUser, breakdown('agentId'));
  router.get('/maps', requireUser, breakdown('mapId'));

  router.get('/insights', requireUser, async (req, res) => {
    const user = userOf(res);
    const { filter, records } = await loadFiltered(req, res);
    const names: NameLookup = await getNameLookup(db);
    const findings = generateFindings(records, names);
    const feedback = await listFeedback(db, user.id);
    const generatedAt = new Date().toISOString();
    const body: InsightsResponse = {
      findings,
      analysisVersion: DEFAULT_ANALYSIS_CONFIG.version,
      generatedAt,
      dismissed: feedback.filter((f) => f.action === 'dismiss').map((f) => f.findingId),
      config: { minMatches: DEFAULT_ANALYSIS_CONFIG.minMatches, minRounds: DEFAULT_ANALYSIS_CONFIG.minRounds },
    };
    await saveSnapshot(db, user.id, 'insights', DEFAULT_ANALYSIS_CONFIG.version, filter, findings);
    res.json(body);
  });

  router.post('/insights/feedback', requireUser, async (req, res) => {
    const input = parse(feedbackSchema, req.body);
    await saveFeedback(db, userOf(res).id, input.findingId, input.action);
    res.status(204).end();
  });

  router.get('/score', requireUser, async (req, res) => {
    const user = userOf(res);
    const { filter, records } = await loadFiltered(req, res);
    const result = computeAnalyzerScore(records);
    const body: ScoreResponse = { ...result, window: { lastN: DEFAULT_SCORE_CONFIG.windowMatches } };
    await saveSnapshot(db, user.id, 'score', DEFAULT_SCORE_CONFIG.formulaVersion, filter, body);
    res.json(body);
  });

  // ---------- export ----------
  router.get('/export.csv', requireUser, async (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="valorant-analyzer-export.csv"');
    if (req.query.definitions === '1') {
      res.send(toCsv(['column', 'definition'], ALL_COLUMNS.map((c) => [c, COLUMN_DEFINITIONS[c] ?? ''])));
      return;
    }
    const { records } = await loadFiltered(req, res, { includeExcluded: true });
    const names = await getNameLookup(db);
    res.send(toCsv(ALL_COLUMNS, records.map((r) => csvRow(r, names, RECORD_COLUMNS))));
  });

  // ---------- share links ----------
  const toShareDto = (row: ShareLinkRow, url?: string): ShareLinkDto => ({
    id: row.id,
    ...(url ? { url } : {}),
    fields: row.fields,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revoked: row.revokedAt !== null,
  });

  router.get('/share-links', requireUser, async (_req, res) => {
    res.json((await listShareLinks(db, userOf(res).id)).map((r) => toShareDto(r)));
  });

  router.post('/share-links', requireUser, async (req, res) => {
    const input = parse(createShareSchema, req.body);
    const fields = [...new Set(input.fields)];
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
    const { row, token } = await createShareLink(db, userOf(res).id, fields, expiresAt);
    res.status(201).json(toShareDto(row, `${env.publicBaseUrl}/p/${token}`));
  });

  router.delete('/share-links/:id', requireUser, async (req, res) => {
    const id = String(req.params.id);
    const ok = UUID_RE.test(id) ? await revokeShareLink(db, userOf(res).id, id) : false;
    if (!ok) throw new HttpError(404, 'not_found', 'Share link not found.');
    res.status(204).end();
  });

  router.get('/public/:token', async (req, res) => {
    const token = String(req.params.token);
    const share = token.length <= 200 ? await resolveShareToken(db, token) : null;
    const owner = share ? await getUser(db, share.userId) : null;
    if (!share || !owner) throw new HttpError(404, 'not_found', 'This link is invalid or has expired.');
    const account: RiotAccountRow | null = await getRiotAccount(db, owner.id);
    const all = account ? await listPlayerRecords(db, account.puuid) : [];
    const records = filterRecords(all, { queueId: 'competitive' });
    const names = await getNameLookup(db);
    const stat = computeStatLine(records);
    const from = records[0]?.startedAt ?? null;
    const to = records[records.length - 1]?.startedAt ?? null;
    const top = (key: 'agentId' | 'mapId', lookup: Record<string, string>) =>
      groupStats(records, key)
        .slice(0, 3)
        .map((g) => ({ name: lookup[g.key] ?? g.key, matches: g.stat.matches, winRate: g.stat.winRate }));
    const body: PublicProfileDto = {
      displayName: owner.displayName,
      range: { from, to },
      matchCount: records.length,
      disclaimer:
        from && to
          ? `Stats from ${records.length} matches between ${isoDay(from)} and ${isoDay(to)}. Not an official Riot rating.`
          : `Stats from ${records.length} matches. Not an official Riot rating.`,
    };
    if (share.fields.includes('winRate')) body.winRate = stat.winRate;
    if (share.fields.includes('kd')) body.kd = stat.kd;
    if (share.fields.includes('topAgents')) body.topAgents = top('agentId', names.agents);
    if (share.fields.includes('topMaps')) body.topMaps = top('mapId', names.maps);
    res.setHeader('X-Robots-Tag', 'noindex');
    res.json(body);
  });

  // ---------- account ----------
  router.delete('/account-link', requireUser, async (_req, res) => {
    await deleteUserMatchData(db, userOf(res).id);
    res.status(204).end();
  });

  return router;
}
