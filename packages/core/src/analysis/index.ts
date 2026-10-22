import type { Finding, PlayerMatchRecord, ScoreResult } from '@va/shared';
import { DEFAULT_ANALYSIS_CONFIG, DEFAULT_SCORE_CONFIG, type AnalysisConfig, type ScoreConfig } from '../config.js';

/** Display names for subjects, keyed by agentId / mapId. Missing names fall back to the id. */
export interface NameLookup {
  agents: Record<string, string>;
  maps: Record<string, string>;
}

/** STUB — implemented by task T06. */
export function generateFindings(records: PlayerMatchRecord[], names: NameLookup, config: AnalysisConfig = DEFAULT_ANALYSIS_CONFIG): Finding[] {
  throw new Error('not implemented');
}

/** STUB — implemented by task T06. `records` is the full (already filtered) history; the window is the most recent config.windowMatches. */
export function computeAnalyzerScore(records: PlayerMatchRecord[], config: ScoreConfig = DEFAULT_SCORE_CONFIG): ScoreResult {
  throw new Error('not implemented');
}
