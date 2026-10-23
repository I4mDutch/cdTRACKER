/**
 * HTTP contract between apps/api and apps/web. All responses are JSON unless noted.
 * Errors: non-2xx responses carry ApiError.
 * Mutating requests (POST/DELETE) must send header `X-Requested-With: va-web` (CSRF guard).
 */
import type {
  Finding,
  MatchFilter,
  MatchOutcome,
  RecordSource,
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

/** How many records of each source fed a response (after filtering). UI must say when manual entries are included. */
export interface SourceCounts {
  riot: number;
  manual: number;
}

export interface MatchSummaryDto {
  matchId: string;
  source: RecordSource;
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
  fieldSources: { field: string; source: 'riot' | 'manual' | 'calculated' | 'unavailable'; note?: string }[];
  /** Present only for manual entries */
  manual: { note: string | null; createdAt: string; updatedAt: string } | null;
}

export interface SummaryResponse {
  filter: MatchFilter;
  overall: StatLine;
  trends: { metric: TrendMetric; window: number; points: TrendPoint[] }[];
  recent: MatchSummaryDto[];
  /** Earliest/latest startedAt in the filtered set (for "date range + match count" context) */
  range: { from: string | null; to: string | null };
  sources: SourceCounts;
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
  sources: SourceCounts;
}

export interface InsightsResponse {
  findings: Finding[];
  analysisVersion: string;
  generatedAt: string;
  /** Finding ids the user dismissed (still returned, flagged) */
  dismissed: string[];
  config: { minMatches: number; minRounds: number };
  sources: SourceCounts;
}

export interface InsightFeedbackRequest {
  findingId: string;
  action: 'dismiss' | 'not_useful' | 'useful';
}

export type ScoreResponse = ScoreResult & {
  window: { lastN: number };
  sources: SourceCounts;
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
  /** How many of matchCount are manual entries (always shown on the card when > 0) */
  manualCount: number;
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
  /** Values present in the user's own records (for filtering) */
  agents: { id: string; name: string }[];
  maps: { id: string; name: string }[];
  queues: string[];
  patches: string[];
  /** Every known agent/map from game content, sorted by name (for the manual entry form). Map ids are asset paths. */
  catalog: { agents: { id: string; name: string }[]; maps: { id: string; name: string }[] };
}

// ---------------------------------------------------------------------------
// Manual entry & CSV import
// ---------------------------------------------------------------------------

export const MANUAL_QUEUES = ['competitive', 'unrated', 'swiftplay', 'premier', 'spikerush', 'other'] as const;
export type ManualQueue = (typeof MANUAL_QUEUES)[number];

/** Validation limits shared by the form, CSV import and the server. */
export const MANUAL_LIMITS = {
  /** No earlier than this (VALORANT closed beta start) */
  minDate: '2020-04-07',
  maxRoundsPerSide: 50,
  maxKda: 150,
  maxAcs: 1000,
  maxAdr: 1000,
  noteMaxLength: 500,
  importMaxRows: 1000,
  importMaxBytes: 1_000_000,
} as const;

/**
 * Body for POST/PUT /manual-matches. Outcome is derived: roundsWon > roundsLost → win, < → loss, = → draw.
 * Optional stats are null/omitted when the user doesn't know them; they are then "unavailable", never 0.
 */
export interface ManualMatchInput {
  /** "YYYY-MM-DD" (stored as 12:00 UTC that day) or a full ISO 8601 date-time. Not in the future, not before minDate. */
  date: string;
  /** Map id as returned by GET /filters/options maps[].id */
  mapId: string;
  /** Agent id as returned by GET /filters/options agents[].id */
  agentId: string;
  queueId: ManualQueue;
  /** "9.08" style; optional */
  patch?: string | null;
  roundsWon: number;
  roundsLost: number;
  kills: number;
  deaths: number;
  assists: number;
  /** Average combat score as shown in game (stored as combatScore = round(acs × rounds)) */
  acs?: number | null;
  /** Average damage per round (stored as damageDealt = round(adr × rounds)) */
  adr?: number | null;
  firstKills?: number | null;
  firstDeaths?: number | null;
  note?: string | null;
}

export interface ManualMatchDto extends Required<Omit<ManualMatchInput, 'date'>> {
  /** `manual-<uuid>` — same id the match list and detail use */
  id: string;
  /** ISO 8601 */
  startedAt: string;
  outcome: MatchOutcome;
  /** Exclusion reason using the same rules as Riot matches (e.g. unsupported_queue, remake) */
  excluded: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * CSV import template columns, in order. Header row required; column order free; names case-insensitive.
 * map / agent accept display names (case-insensitive) or ids. Empty optional cells = unknown.
 */
export const MANUAL_CSV_COLUMNS: { name: string; required: boolean; description: string }[] = [
  { name: 'date', required: true, description: 'YYYY-MM-DD or ISO 8601 date-time' },
  { name: 'map', required: true, description: 'Map name, e.g. Ascent' },
  { name: 'agent', required: true, description: 'Agent name, e.g. Jett' },
  { name: 'queue', required: false, description: `One of ${MANUAL_QUEUES.join(', ')} (default competitive)` },
  { name: 'rounds_won', required: true, description: 'Rounds your team won' },
  { name: 'rounds_lost', required: true, description: 'Rounds your team lost' },
  { name: 'kills', required: true, description: 'Your kills' },
  { name: 'deaths', required: true, description: 'Your deaths' },
  { name: 'assists', required: true, description: 'Your assists' },
  { name: 'acs', required: false, description: 'Average combat score' },
  { name: 'adr', required: false, description: 'Average damage per round' },
  { name: 'first_kills', required: false, description: 'First kills (opening kills)' },
  { name: 'first_deaths', required: false, description: 'First deaths' },
  { name: 'patch', required: false, description: 'Game patch, e.g. 9.08' },
  { name: 'note', required: false, description: 'Free text, up to 500 characters' },
];

export interface ImportRequest {
  /** Raw CSV text (UTF-8, optional BOM). At most importMaxBytes / importMaxRows data rows. */
  csv: string;
  /** true = validate and preview only, nothing is saved */
  dryRun: boolean;
}

export interface ImportRowResult {
  /** 1-based line number in the file (header = line 1) */
  line: number;
  status: 'valid' | 'invalid' | 'duplicate';
  /** Human-readable problems, e.g. `kills: must be a whole number between 0 and 150` */
  errors: string[];
  /** Parsed values when the row is valid or a duplicate */
  parsed: ManualMatchInput | null;
}

export interface ImportResponse {
  dryRun: boolean;
  rows: ImportRowResult[];
  counts: { valid: number; invalid: number; duplicate: number };
  /** Rows saved (0 on dryRun, and 0 when any row is invalid: imports are all-or-nothing) */
  imported: number;
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
 *   DELETE /account-link            → 204 (unlink + delete stored Riot match data; manual entries are kept)
 *
 *   POST   /manual-matches          → 201 ManualMatchDto    body: ManualMatchInput (409 "duplicate" if identical entry exists)
 *   GET    /manual-matches/template.csv → text/csv attachment (header row + one example row)
 *   POST   /manual-matches/import   → 200 ImportResponse    body: ImportRequest (JSON, up to ~1.5 MB)
 *   GET    /manual-matches/:id      → ManualMatchDto        (id = "manual-<uuid>", own entries only, else 404)
 *   PUT    /manual-matches/:id      → ManualMatchDto        body: ManualMatchInput
 *   DELETE /manual-matches/:id      → 204
 *   DELETE /manual-matches          → 204   body: { confirm: true }   deletes ALL of the user's manual entries
 *
 * Manual entries do NOT require a linked Riot account. They appear in /matches, /summary, /agents, /maps,
 * /insights, /score, /export.csv and the public card alongside Riot records, always marked source "manual".
 *
 * <filter> = agentId, mapId, queueId, patch, from, to, lastN, source ("riot" | "manual"; omitted = both)
 * (see MatchFilter). queueId defaults to "competitive".
 */
export const API_ROUTES_DOC = true;
