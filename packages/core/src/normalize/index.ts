import type { NormalizeResult, NormalizedMatch, PlayerMatchRecord, RiotMatchDto } from '@va/shared';
import { DEFAULT_NORMALIZE_CONFIG, type NormalizeConfig } from '../config.js';

/** STUB — implemented by task T02. */
export function parsePatch(gameVersion: string | undefined | null): string | null {
  throw new Error('not implemented');
}

/** STUB — implemented by task T02. */
export function normalizeMatch(raw: unknown, config: NormalizeConfig = DEFAULT_NORMALIZE_CONFIG): NormalizeResult {
  throw new Error('not implemented');
}

/** STUB — implemented by task T02. Returns null when puuid is not a participant. */
export function toPlayerRecord(match: NormalizedMatch, puuid: string): PlayerMatchRecord | null {
  throw new Error('not implemented');
}

export type { RiotMatchDto };
