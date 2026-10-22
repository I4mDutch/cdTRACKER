import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, buildQuery, createShareLink, getMatches, getSummary, sendInsightFeedback } from '../src/api/client';
import { jsonResponse } from './helpers';

describe('api client', () => {
  it('builds query strings omitting empty values and sends credentials', async () => {
    const fn = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fn);
    await getSummary({ agentId: 'jett', mapId: '', patch: undefined, lastN: 20 });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/summary?agentId=jett&lastN=20');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBeUndefined();
  });

  it('includes paging params for matches', async () => {
    const fn = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fn);
    await getMatches({ queueId: 'competitive' }, 2, 20);
    expect((fn.mock.calls[0] as unknown as [string])[0]).toBe('/api/matches?page=2&pageSize=20&queueId=competitive');
  });

  it('buildQuery returns empty string when nothing set', () => {
    expect(buildQuery({ a: undefined, b: '' })).toBe('');
  });

  it('sends CSRF header and JSON content type on POST', async () => {
    const fn = vi.fn(async () => jsonResponse(null, 204));
    vi.stubGlobal('fetch', fn);
    await sendInsightFeedback({ findingId: 'f1', action: 'useful' });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/insights/feedback');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-Requested-With': 'va-web', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ findingId: 'f1', action: 'useful' });
  });

  it('parses ApiError into ApiClientError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'validation', message: 'Bad fields' } }, 400)));
    const err = await createShareLink({ fields: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 400, code: 'validation', message: 'Bad fields' });
  });

  it('falls back to a generic error for non-JSON failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 502 })));
    const err = await getSummary({}).catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: 'unknown' });
  });
});
