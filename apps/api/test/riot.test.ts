import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FixtureRiotClient, HttpRiotClient, RiotApiError, createLimiter } from '../src/riot';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'riot-fixture-'));
  await mkdir(path.join(dir, 'matchlists'));
  await mkdir(path.join(dir, 'matches'));
  await writeFile(
    path.join(dir, 'accounts.json'),
    JSON.stringify([{ accessToken: 'tok-1', account: { puuid: 'p-1', gameName: 'Tester', tagLine: 'NA1' }, shard: 'na' }]),
  );
  await writeFile(path.join(dir, 'content.json'), JSON.stringify({ version: 'v1', agents: [] }));
  await writeFile(path.join(dir, 'matchlists', 'p-1.json'), JSON.stringify({ puuid: 'p-1', history: [] }));
  await writeFile(path.join(dir, 'matches', 'm-1.json'), JSON.stringify({ matchInfo: { matchId: 'm-1' } }));
  // A file that a traversal would reach if segments were not validated.
  await writeFile(path.join(dir, 'x.json'), JSON.stringify({ secret: true }));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function catchErr(p: Promise<unknown>): Promise<RiotApiError> {
  try {
    await p;
  } catch (e) {
    return e as RiotApiError;
  }
  throw new Error('expected rejection');
}

describe('FixtureRiotClient', () => {
  const client = () => new FixtureRiotClient({ dir });

  it('returns account, matchlist, match and content', async () => {
    const c = client();
    expect(await c.getMyAccount('tok-1')).toMatchObject({ puuid: 'p-1' });
    expect(await c.getMatchlist('p-1', 'na')).toMatchObject({ puuid: 'p-1' });
    expect(await c.getMatch('m-1', 'na')).toMatchObject({ matchInfo: { matchId: 'm-1' } });
    expect(await c.getContent('na')).toMatchObject({ version: 'v1' });
  });

  it('rejects unknown token with auth 401', async () => {
    const e = await catchErr(client().getMyAccount('nope'));
    expect(e).toBeInstanceOf(RiotApiError);
    expect([e.category, e.status]).toEqual(['auth', 401]);
  });

  it('missing match and matchlist are not_found 404', async () => {
    const e = await catchErr(client().getMatch('missing', 'na'));
    expect([e.category, e.status]).toEqual(['not_found', 404]);
    const e2 = await catchErr(client().getMatchlist('missing', 'na'));
    expect([e2.category, e2.status]).toEqual(['not_found', 404]);
  });

  it('blocks path traversal', async () => {
    const e = await catchErr(client().getMatch('../x', 'na'));
    expect(e.category).toBe('not_found');
    const e2 = await catchErr(client().getMatchlist('../../x', 'na'));
    expect(e2.category).toBe('not_found');
  });
});

describe('createLimiter', () => {
  it('runs FIFO with bounded concurrency', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        limit(async () => {
          order.push(i);
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});

const KEY = 'RGAPI-super-secret-key';
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

describe('HttpRiotClient', () => {
  const make = (fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof HttpRiotClient>[0]> = {}) => {
    const sleep = vi.fn(async (_ms: number) => {});
    const client = new HttpRiotClient({ apiKey: KEY, fetchImpl, sleep, ...extra });
    return { client, sleep };
  };

  it('uses correct URLs and headers', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ ok: true }));
    const { client } = make(fetchImpl as unknown as typeof fetch);

    await client.getMyAccount('access-tok');
    await client.getMatchlist('pu/id', 'eu');
    await client.getMatch('m-1', 'na');
    await client.getContent('ap');

    const calls = fetchImpl.mock.calls.map(([u, i]) => [String(u), (i?.headers ?? {}) as Record<string, string>] as const);
    expect(calls[0]![0]).toBe('https://americas.api.riotgames.com/riot/account/v1/accounts/me');
    expect(calls[0]![1].Authorization).toBe('Bearer access-tok');
    expect(calls[0]![1]['X-Riot-Token']).toBeUndefined();
    expect(calls[1]![0]).toBe('https://eu.api.riotgames.com/val/match/v1/matchlists/by-puuid/pu%2Fid');
    expect(calls[1]![1]['X-Riot-Token']).toBe(KEY);
    expect(calls[2]![0]).toBe('https://na.api.riotgames.com/val/match/v1/matches/m-1');
    expect(calls[3]![0]).toBe('https://ap.api.riotgames.com/val/content/v1/contents?locale=en-US');
  });

  it('does not retry 404', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    const { client, sleep } = make(fetchImpl as unknown as typeof fetch);
    const e = await catchErr(client.getMatch('x', 'na'));
    expect(e.category).toBe('not_found');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('maps 401 and 403 without retry', async () => {
    for (const [status, category] of [[401, 'auth'], [403, 'forbidden']] as const) {
      const fetchImpl = vi.fn(async () => new Response('', { status }));
      const { client } = make(fetchImpl as unknown as typeof fetch);
      expect((await catchErr(client.getContent('na'))).category).toBe(category);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('retries 429 honoring Retry-After then succeeds', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () =>
      n++ === 0 ? new Response('', { status: 429, headers: { 'Retry-After': '2' } }) : json({ done: true }),
    );
    const { client, sleep } = make(fetchImpl as unknown as typeof fetch);
    expect(await client.getMatch('m', 'na')).toEqual({ done: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('retries 5xx up to maxRetries then throws upstream', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    const { client, sleep } = make(fetchImpl as unknown as typeof fetch, { maxRetries: 2 });
    const e = await catchErr(client.getMatch('m', 'na'));
    expect(e.category).toBe('upstream');
    expect(e.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('maps fetch throw to network (retryable)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const { client } = make(fetchImpl as unknown as typeof fetch, { maxRetries: 1 });
    const e = await catchErr(client.getContent('na'));
    expect(e.category).toBe('network');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps abort to timeout', async () => {
    const fetchImpl = vi.fn(
      (_u: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        }),
    );
    const { client } = make(fetchImpl as unknown as typeof fetch, { timeoutMs: 10, maxRetries: 0 });
    const e = await catchErr(client.getContent('na'));
    expect(e.category).toBe('timeout');
  });

  it('never exceeds maxConcurrent', async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return json({});
    });
    const { client } = make(fetchImpl as unknown as typeof fetch, { maxConcurrent: 3 });
    await Promise.all(Array.from({ length: 10 }, (_, i) => client.getMatch(`m${i}`, 'na')));
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(peak).toBe(3);
  });

  it('error messages exclude the key and access token', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 }));
    const { client } = make(fetchImpl as unknown as typeof fetch, { maxRetries: 0 });
    const e1 = await catchErr(client.getMatch('m', 'na'));
    const e2 = await catchErr(client.getMyAccount('secret-access-token'));
    for (const e of [e1, e2]) {
      expect(e.message).not.toContain(KEY);
      expect(e.message).not.toContain('secret-access-token');
    }
  });
});
