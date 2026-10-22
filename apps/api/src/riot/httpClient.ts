import type { RiotAccountDto, RiotContentDto, RiotMatchlistDto } from '@va/shared';
import { createLimiter } from './limiter';
import { RiotApiError, type RiotClient, type RiotShard } from './types';

type AccountRegion = 'americas' | 'europe' | 'asia';

export interface HttpRiotClientOptions {
  /** Sent as X-Riot-Token; never logged or included in errors. */
  apiKey: string;
  accountRegion?: AccountRegion;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxConcurrent?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const BACKOFF_CAP_MS = 30_000;

function categoryForStatus(status: number): RiotApiError['category'] {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'upstream';
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const secs = Number(value);
  if (!Number.isFinite(secs) || secs < 0) return null;
  return Math.round(secs * 1000);
}

export class HttpRiotClient implements RiotClient {
  private readonly apiKey: string;
  private readonly accountRegion: AccountRegion;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limit: ReturnType<typeof createLimiter>;

  constructor(opts: HttpRiotClientOptions) {
    this.apiKey = opts.apiKey;
    this.accountRegion = opts.accountRegion ?? 'americas';
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseBackoffMs = opts.baseBackoffMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.limit = createLimiter(opts.maxConcurrent ?? 4);
  }

  getMyAccount(accessToken: string): Promise<RiotAccountDto> {
    const url = `https://${this.accountRegion}.api.riotgames.com/riot/account/v1/accounts/me`;
    return this.request<RiotAccountDto>(url, { Authorization: `Bearer ${accessToken}` });
  }

  getMatchlist(puuid: string, shard: RiotShard): Promise<RiotMatchlistDto> {
    return this.request<RiotMatchlistDto>(
      `https://${shard}.api.riotgames.com/val/match/v1/matchlists/by-puuid/${encodeURIComponent(puuid)}`,
      { 'X-Riot-Token': this.apiKey },
    );
  }

  getMatch(matchId: string, shard: RiotShard): Promise<unknown> {
    return this.request<unknown>(
      `https://${shard}.api.riotgames.com/val/match/v1/matches/${encodeURIComponent(matchId)}`,
      { 'X-Riot-Token': this.apiKey },
    );
  }

  getContent(shard: RiotShard): Promise<RiotContentDto> {
    return this.request<RiotContentDto>(`https://${shard}.api.riotgames.com/val/content/v1/contents?locale=en-US`, {
      'X-Riot-Token': this.apiKey,
    });
  }

  private async request<T>(url: string, headers: Record<string, string>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.limit(() => this.attemptOnce<T>(url, headers));
      } catch (err) {
        if (!(err instanceof RiotApiError) || !err.retryable || attempt >= this.maxRetries) throw err;
        const backoff = Math.random() * Math.min(BACKOFF_CAP_MS, this.baseBackoffMs * 2 ** attempt);
        const wait = err.category === 'rate_limited' && err.retryAfterMs !== null ? err.retryAfterMs : backoff;
        attempt++;
        await this.sleep(wait);
      }
    }
  }

  private async attemptOnce<T>(url: string, headers: Record<string, string>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
      } catch {
        if (controller.signal.aborted) throw new RiotApiError(`Riot request timed out after ${this.timeoutMs}ms`, 'timeout', 0);
        throw new RiotApiError('Riot request failed (network error)', 'network', 0);
      }
      if (!res.ok) {
        const retryAfterMs = res.status === 429 ? parseRetryAfter(res.headers.get('Retry-After')) : null;
        throw new RiotApiError(`Riot API responded with HTTP ${res.status}`, categoryForStatus(res.status), res.status, retryAfterMs);
      }
      try {
        return (await res.json()) as T;
      } catch {
        if (controller.signal.aborted) throw new RiotApiError(`Riot request timed out after ${this.timeoutMs}ms`, 'timeout', 0);
        throw new RiotApiError('Riot API returned an invalid JSON body', 'upstream', res.status);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
