/**
 * Internal, normalized domain model. Produced by @va/core normalize, consumed by
 * aggregation, analysis, the database layer, and API DTOs.
 *
 * Convention: `null` means "the source did not provide the data needed" (unavailable),
 * never zero. Aggregations must track coverage instead of treating null as 0.
 */

export type MatchOutcome = 'win' | 'loss' | 'draw';

/** Why a match is excluded from analysis. Excluded matches are still stored. */
export type ExclusionReason = 'incomplete' | 'remake' | 'unsupported_queue' | 'player_missing' | 'inconsistent_teams';

export interface NormalizedTeam {
  teamId: string;
  won: boolean;
  roundsPlayed: number;
  roundsWon: number;
}

export interface NormalizedParticipant {
  puuid: string;
  teamId: string;
  agentId: string;
  /** Combat score total; null when player stats block is missing. */
  combatScore: number | null;
  roundsPlayed: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
}

export interface NormalizedKill {
  /** ms since round start */
  roundTimeMs: number;
  killer: string;
  victim: string;
  assistants: string[];
}

export interface NormalizedRound {
  /** 1-based (Riot sends 0-based; normalizer adds 1). */
  roundNumber: number;
  winningTeam: string;
  result: string;
  planter: string | null;
  defuser: string | null;
  /** Kills in this round sorted by roundTimeMs ascending. */
  kills: NormalizedKill[];
  /** Per-player damage dealt in this round (sum across receivers). */
  damage: { puuid: string; damage: number; headshots: number; bodyshots: number; legshots: number }[];
}

export interface NormalizedMatch {
  matchId: string;
  /** ISO 8601 UTC */
  startedAt: string;
  durationMs: number | null;
  /** Map asset path, e.g. "/Game/Maps/Ascent/Ascent" */
  mapId: string;
  queueId: string;
  seasonId: string | null;
  /** "8.11" style, or null when gameVersion missing/unparseable */
  patch: string | null;
  isCompleted: boolean;
  /** Max team roundsPlayed (0 if unknown). */
  roundsPlayed: number;
  teams: NormalizedTeam[];
  participants: NormalizedParticipant[];
  /** Empty array when the source supplied no round data. */
  rounds: NormalizedRound[];
  /** Set when the match should not count toward analysis. */
  excluded: ExclusionReason | null;
}

export type DataIssueSeverity = 'fatal' | 'warning';

export interface DataIssue {
  severity: DataIssueSeverity;
  /** machine-readable code, e.g. "missing_match_info", "team_round_mismatch" */
  code: string;
  message: string;
}

export type NormalizeResult =
  | { ok: true; match: NormalizedMatch; issues: DataIssue[] }
  | { ok: false; issues: DataIssue[] };

/** Where a record came from. Manual records are typed in or CSV-imported by the user and are never presented as Riot data. */
export type RecordSource = 'riot' | 'manual';

/**
 * One row per (linked player, match): the unit every aggregate and insight is built on.
 * Built by core `toPlayerRecord`. Round-derived fields are null when match.rounds is empty.
 */
export interface PlayerMatchRecord {
  /** Riot match id, or `manual-<uuid>` for manual entries. */
  matchId: string;
  source: RecordSource;
  puuid: string;
  startedAt: string;
  mapId: string;
  queueId: string;
  patch: string | null;
  agentId: string;
  teamId: string;
  outcome: MatchOutcome;
  roundsPlayed: number;
  roundsWon: number;
  roundsLost: number;
  kills: number;
  deaths: number;
  assists: number;
  /** Total combat score; null if unavailable. */
  combatScore: number | null;
  /** Round-derived (null when no round data): */
  damageDealt: number | null;
  headshots: number | null;
  bodyshots: number | null;
  legshots: number | null;
  /** Rounds where this player got the first kill of the round. */
  firstKills: number | null;
  /** Rounds where this player was the first death of the round. */
  firstDeaths: number | null;
  plants: number | null;
  defuses: number | null;
  /**
   * Riot in-game Performance Score. Not present in the documented match API, so always null
   * until an approved response proves otherwise. UI must not imply it exists.
   */
  performanceScore: null;
}

export interface MatchFilter {
  agentId?: string;
  mapId?: string;
  queueId?: string;
  patch?: string;
  /** ISO date/time inclusive lower bound on startedAt */
  from?: string;
  /** ISO date/time exclusive upper bound on startedAt */
  to?: string;
  /** Keep only the N most recent matches after other filters */
  lastN?: number;
  /** Restrict to one source; undefined = both */
  source?: RecordSource;
}

export interface RateInterval {
  low: number;
  high: number;
}

/** Aggregate over a set of PlayerMatchRecords. All rates are null when the denominator is 0/unavailable. */
export interface StatLine {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** wins / matches (draws count as non-wins) */
  winRate: number | null;
  /** 95% Wilson interval on winRate */
  winRateInterval: RateInterval | null;
  rounds: number;
  kills: number;
  deaths: number;
  assists: number;
  /** kills / deaths; when deaths === 0 and kills > 0, kd = kills and zeroDeaths = true */
  kd: number | null;
  /** (kills + assists) / deaths with the same zero-death rule */
  kda: number | null;
  zeroDeaths: boolean;
  killsPerRound: number | null;
  deathsPerRound: number | null;
  assistsPerRound: number | null;
  /** Average combat score per round over matches where combatScore is available */
  acs: number | null;
  /** Σ damageDealt / Σ rounds, over records where damageDealt !== null */
  adr: number | null;
  /** headshots / (headshots + bodyshots + legshots), over records where all three are non-null */
  headshotPct: number | null;
  /** Over records where firstKills AND firstDeaths are non-null, divided by those records' rounds */
  firstKillsPerRound: number | null;
  firstDeathsPerRound: number | null;
  /** firstKills / (firstKills + firstDeaths), same record set */
  firstDuelWinRate: number | null;
  coverage: {
    /** matches contributing combatScore */
    combatScore: number;
    /** matches contributing damageDealt */
    roundData: number;
    /** rounds within those matches (ADR denominator) */
    roundDataRounds: number;
    /** matches contributing firstKills + firstDeaths */
    firstDuel: number;
    /** rounds within those matches (first-duel per-round denominator) */
    firstDuelRounds: number;
  };
}

export type GroupKey = 'agentId' | 'mapId' | 'queueId' | 'patch';

export interface GroupStat {
  key: string;
  stat: StatLine;
  /** true when stat.matches < config.lowSampleMatches */
  lowSample: boolean;
}

export type TrendMetric = 'winRate' | 'kd' | 'acs' | 'adr' | 'killsPerRound' | 'deathsPerRound';

export interface TrendPoint {
  /** index of the last match in the window (0 = oldest) */
  index: number;
  matchId: string;
  startedAt: string;
  /** rolling value over `window` matches ending here; null when unavailable */
  value: number | null;
  /** matches in this window that contributed a value */
  sample: number;
}

export type EvidenceLevel = 'low' | 'moderate' | 'strong';

export type FindingType =
  | 'agent_win_rate'
  | 'map_win_rate'
  | 'deaths_per_round'
  | 'assists_per_round'
  | 'first_duel';

export interface Finding {
  /** Deterministic: `${type}:${subject.kind}:${subject.id}` */
  id: string;
  type: FindingType;
  subject: { kind: 'overall' | 'agent' | 'map'; id: string };
  metric: keyof StatLine;
  value: number;
  baseline: number;
  /** Human-readable baseline description, e.g. "your overall win rate in this window" */
  baselineLabel: string;
  direction: 'below' | 'above';
  sampleMatches: number;
  sampleRounds: number;
  evidence: EvidenceLevel;
  /** One sentence. Must use hedged wording for low/moderate evidence ("possible focus", "worth reviewing"). */
  summary: string;
  /** One practice suggestion. Never claims a cause the data cannot observe. */
  recommendation: string;
  /** How this finding was generated, for the "how was this generated" UI. */
  method: string;
  /** Contributing matches (most recent first, max 20). */
  matchIds: string[];
  analysisVersion: string;
}

export type ScoreComponentKey = 'outcome' | 'combat' | 'impact' | 'objective';

export interface ScoreComponent {
  key: ScoreComponentKey;
  label: string;
  /** configured weight (0..1) */
  weight: number;
  /** weight after re-normalizing over available components (0 when unavailable) */
  effectiveWeight: number;
  available: boolean;
  /** raw metric value in the window (e.g. kd 1.12), null when unavailable */
  rawValue: number | null;
  /** 0..100, null when unavailable */
  normalized: number | null;
  sourceFields: string[];
  note: string;
}

export interface ScoreResult {
  /** false when there is not enough data; score is then null */
  available: boolean;
  reason: string | null;
  score: number | null;
  formulaVersion: string;
  components: ScoreComponent[];
  /** sum of configured weights of available components (0..1) */
  coverage: number;
  sampleMatches: number;
  historyMatches: number;
  relativeTo: 'own-history';
}
