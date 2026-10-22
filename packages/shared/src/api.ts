/**
 * HTTP contract between apps/api and apps/web. All responses are JSON unless noted.
 * Errors: non-2xx responses carry ApiError.
 * Mutating requests (POST/DELETE) must send header `X-Requested-With: va-web` (CSRF guard).
 */
import type {
  Finding,
  MatchFilter,
  MatchOutcome,
  ScoreResult,
  StatLine,
  TrendMetric,
  TrendPoint,
} from './domain.js';

export interface ApiError {
  error: {
    /** e.g. "unauthenticated", "forbidden", "not_found", "rate_limited", "validation", "upstream", "internal" */
    code: string;
    /** Safe, user-facing message. Never contains tokens or other players' data. */
    message: string;
  };
}

export type LinkState = 'unlinked' | 'linked' | 'syncing' | 'up_to_date' | 'consent_removed' | 'sync_failed';

export interface MeResponse {
  user: { id: string; displayName: string } | null;
  link: {
    state: LinkState;
    /** "gameName#tagLine" of the linked account (the user's own), when known */
    riotId: string | null;
    region: string | null;
    lastSyncedAt: string | null;
    lastError: string | null;
    consentedAt: string | null;
  };
  /** True when the server runs with fixture data / mock RSO instead of live Riot access. */
  demoMode: boolean;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Query params accepted by list/summary endpoints (all optional, strings on the wire). */
export type FilterQuery = MatchFilter;

export interface MatchSummaryDto {
  matchId: string;
  startedAt: string;
  mapId: string;
  mapName: string;
  queueId: string;
  patch: string | null;
  agentId: string;
  agentName: string;
  outcome: MatchOutcome;
  roundsWon: number;
  roundsLost: number;
  kills: number;
  deaths: number;
  assists: number;
  /** combatScore / roundsPlayed, null when unavailable */
  acs: number | null;
  adr: number | null;
  excluded: string | null;
}

export interface RoundSummaryDto {
  roundNumber: number;
  /** from the linked player's perspective */
  won: boolean;
  result: string;
  /** linked player's own numbers for this round */
  kills: number;
  died: boolean;
  damage: number;
  firstKill: boolean;
  firstDeath: boolean;
  planted: boolean;
  defused: boolean;
}

/**
 * Match detail shows ONLY the linked player's own stats plus team-level results.
 * Other participants' identities and individual stats are never included.
 */
export interface MatchDetailDto {
  summary: MatchSummaryDto;
  durationMs: number | null;
  teams: { teamId: string; isPlayerTeam: boolean; roundsWon: number; won: boolean }[];
  /** Empty when the source had no round data; UI must then show the summary only. */
  rounds: RoundSummaryDto[];
  /** Which fields came from Riot and which the app calculated */
  fieldSources: { field: string; source: 'riot' | 'calculated' | 'unavailable'; note?: string }[];
}

export interface SummaryResponse {
  filter: MatchFilter;
  overall: StatLine;
  trends: { metric: TrendMetric; window: number; points: TrendPoint[] }[];
  recent: MatchSummaryDto[];
  /** Earliest/latest startedAt in the filtered set (for "date range + match count" context) */
  range: { from: string | null; to: string | null };
}

export interface BreakdownRow {
  id: string;
  name: string;
  stat: StatLine;
  lowSample: boolean;
  /** stat.winRate - baseline.winRate; null when either is null */
  winRateDelta: number | null;
  kdDelta: number | null;
}

export interface BreakdownResponse {
  filter: MatchFilter;
  baseline: StatLine;
  rows: BreakdownRow[];
  lowSampleThreshold: number;
}

export interface InsightsResponse {
  findings: Finding[];
  analysisVersion: string;
  generatedAt: string;
  /** Finding ids the user dismissed (still returned, flagged) */
  dismissed: string[];
  config: { minMatches: number; minRounds: number };
}

export interface InsightFeedbackRequest {
  findingId: string;
  action: 'dismiss' | 'not_useful' | 'useful';
}

export type ScoreResponse = ScoreResult & {
  window: { lastN: number };
};

export interface SyncResponse {
  jobId: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed';
}

export type ShareField = 'winRate' | 'kd' | 'topAgents' | 'topMaps' | 'matchCount';

export interface CreateShareLinkRequest {
  fields: ShareField[];
  /** days until expiry; omit for no expiry */
  expiresInDays?: number;
}

export interface ShareLinkDto {
  id: string;
  /** Only returned once, at creation. */
  url?: string;
  fields: ShareField[];
  createdAt: string;
  expiresAt: string | null;
  revoked: boolean;
}

/** Public card: only the owner's opted-in fields. Never includes other players. */
export interface PublicProfileDto {
  displayName: string;
  range: { from: string | null; to: string | null };
  matchCount: number;
  winRate?: number | null;
  kd?: number | null;
  topAgents?: { name: string; matches: number; winRate: number | null }[];
  topMaps?: { name: string; matches: number; winRate: number | null }[];
  disclaimer: string;
}

export const RIOT_NOTICE =
  "VALORANT Analyzer isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

export const SCORE_DISCLAIMER =
  'The Analyzer Score is a personal summary relative to your own match history. It is not Riot MMR, a rank, or an official VALORANT rating.';

export interface ConnectResponse {
  /** Browser navigates here (Riot authorize URL, or the mock RSO page in demo mode). */
  redirectUrl: string;
}

export interface FilterOptionsResponse {
  agents: { id: string; name: string }[];
  maps: { id: string; name: string }[];
  queues: string[];
  patches: string[];
}

/**
 * Route table (all under /api, JSON, cookie session `va_session`; 401 ApiError when unauthenticated):
 *
 *   GET    /me                      → MeResponse (200 with user:null when signed out)
 *   POST   /dev/login               → MeResponse        demo mode only; signs in as demo user 0001
 *   POST   /logout                  → 204
 *   POST   /riot/connect            → ConnectResponse   body: { consent: true } required
 *   GET    /riot/callback?code&state→ 302 to /settings?linked=1 (or ?error=<code>)
 *   POST   /sync                    → 202 SyncResponse
 *   GET    /sync/:jobId             → SyncResponse
 *   GET    /filters/options         → FilterOptionsResponse
 *   GET    /matches?page&pageSize&<filter> → Paginated<MatchSummaryDto>  (newest first; pageSize ≤ 100, default 20)
 *   GET    /matches/:matchId        → MatchDetailDto
 *   GET    /summary?<filter>        → SummaryResponse
 *   GET    /agents?<filter>         → BreakdownResponse
 *   GET    /maps?<filter>           → BreakdownResponse
 *   GET    /insights?<filter>       → InsightsResponse
 *   POST   /insights/feedback       → 204   body: InsightFeedbackRequest
 *   GET    /score?<filter>          → ScoreResponse
 *   GET    /export.csv?<filter>     → text/csv attachment
 *   GET    /share-links             → ShareLinkDto[]
 *   POST   /share-links             → 201 ShareLinkDto (with url)   body: CreateShareLinkRequest
 *   DELETE /share-links/:id         → 204
 *   GET    /public/:token           → PublicProfileDto (no auth; 404 when revoked/expired)
 *   DELETE /account-link            → 204 (unlink + delete stored match data)
 *
 * <filter> = agentId, mapId, queueId, patch, from, to, lastN (see MatchFilter). queueId defaults to "competitive".
 */
export const API_ROUTES_DOC = true;
