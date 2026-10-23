import type { ExclusionReason, MatchOutcome } from '@va/shared';
import { DEFAULT_NORMALIZE_CONFIG, type NormalizeConfig } from '../config.js';

/** Prefix that distinguishes manual entry ids from Riot match ids everywhere (`manual-<uuid>`). */
export const MANUAL_ID_PREFIX = 'manual-';

/** Manual entries carry no team payload, so the outcome is derived from the score. */
export function manualOutcome(roundsWon: number, roundsLost: number): MatchOutcome {
  if (roundsWon > roundsLost) return 'win';
  if (roundsWon < roundsLost) return 'loss';
  return 'draw';
}

/** Same exclusion rules as Riot matches (see normalizeMatch), minus the ones that need a full payload. */
export function manualExclusion(queueId: string, roundsPlayed: number, config: NormalizeConfig = DEFAULT_NORMALIZE_CONFIG): ExclusionReason | null {
  if (roundsPlayed <= config.remakeMaxRounds) return 'remake';
  if (!config.supportedQueues.includes(queueId)) return 'unsupported_queue';
  return null;
}
