import type { RiotAccountDto, RiotContentDto, RiotMatchlistDto } from '@va/shared';

/** Routing shards for VAL-MATCH-V1 (e.g. https://na.api.riotgames.com). */
export type RiotShard = 'na' | 'eu' | 'ap' | 'kr' | 'latam' | 'br' | 'esports';

export type RiotErrorCategory = 'auth' | 'forbidden' | 'not_found' | 'rate_limited' | 'upstream' | 'network' | 'timeout';

export class RiotApiError extends Error {
  constructor(
    message: string,
    readonly category: RiotErrorCategory,
    /** HTTP status, or 0 for network/timeout */
    readonly status: number,
    /** From Retry-After on 429, in ms */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'RiotApiError';
  }

  /** 429, 5xx, network and timeout errors are retryable; 401/403/404 are not. */
  get retryable(): boolean {
    return this.category === 'rate_limited' || this.category === 'upstream' || this.category === 'network' || this.category === 'timeout';
  }
}

/**
 * Everything the app reads from Riot goes through this interface.
 * Implementations: FixtureRiotClient (demo/tests), HttpRiotClient (production key, pending approval).
 */
export interface RiotClient {
  /** ACCOUNT-V1 /riot/account/v1/accounts/me using the player's RSO access token. */
  getMyAccount(accessToken: string): Promise<RiotAccountDto>;
  /** VAL-MATCH-V1 /val/match/v1/matchlists/by-puuid/{puuid} */
  getMatchlist(puuid: string, shard: RiotShard): Promise<RiotMatchlistDto>;
  /** VAL-MATCH-V1 /val/match/v1/matches/{matchId}. Returned unvalidated: the normalizer validates. */
  getMatch(matchId: string, shard: RiotShard): Promise<unknown>;
  /** VAL-CONTENT-V1 /val/content/v1/contents */
  getContent(shard: RiotShard): Promise<RiotContentDto>;
}
