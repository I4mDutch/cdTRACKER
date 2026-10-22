/** Versioned, documented defaults. Changing a value that affects output requires a version bump. */

export interface NormalizeConfig {
  /** Queues included in analysis; other queues are stored but excluded (`unsupported_queue`). */
  supportedQueues: string[];
  /** Completed matches with fewer total rounds than this are treated as remakes. */
  remakeMaxRounds: number;
}

export const DEFAULT_NORMALIZE_CONFIG: NormalizeConfig = {
  supportedQueues: ['competitive'],
  remakeMaxRounds: 4,
};

export interface AggregateConfig {
  /** Groups with fewer matches are flagged lowSample. */
  lowSampleMatches: number;
}

export const DEFAULT_AGGREGATE_CONFIG: AggregateConfig = {
  lowSampleMatches: 5,
};

export interface AnalysisConfig {
  version: string;
  /** Minimum matches in a subject sample before any finding is produced. */
  minMatches: number;
  /** Minimum rounds (with round data where required) before a per-round finding is produced. */
  minRounds: number;
  /** Absolute win-rate gap (subject vs baseline) required for a win-rate finding. */
  winRateGap: number;
  /** Relative gap for per-round metrics, e.g. 0.15 = 15% worse than baseline. */
  perRoundRelativeGap: number;
  /** Bayesian smoothing: prior weight in pseudo-matches pulled toward the baseline rate. */
  smoothingPriorMatches: number;
  /** Cap on findings returned, after sorting by evidence then gap. */
  maxFindings: number;
}

export const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  version: 'analysis-v1',
  minMatches: 8,
  minRounds: 150,
  winRateGap: 0.08,
  perRoundRelativeGap: 0.15,
  smoothingPriorMatches: 5,
  maxFindings: 5,
};

export interface ScoreConfig {
  formulaVersion: string;
  weights: { outcome: number; combat: number; impact: number; objective: number };
  /** Minimum matches in the scored window. */
  minWindowMatches: number;
  /** Minimum matches in the history used as the normalization baseline. */
  minHistoryMatches: number;
  /** Default window size (most recent N matches). */
  windowMatches: number;
}

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  formulaVersion: 'analyzer-score-v1',
  weights: { outcome: 0.3, combat: 0.25, impact: 0.25, objective: 0.2 },
  minWindowMatches: 10,
  minHistoryMatches: 20,
  windowMatches: 20,
};
