import type { GroupKey, GroupStat, MatchFilter, PlayerMatchRecord, RateInterval, StatLine, TrendMetric, TrendPoint } from '@va/shared';
import { DEFAULT_AGGREGATE_CONFIG, type AggregateConfig } from '../config.js';

/** STUB — implemented by task T03. */
export function wilsonInterval(successes: number, n: number, z = 1.96): RateInterval | null {
  throw new Error('not implemented');
}

/** STUB — implemented by task T03. */
export function smoothedRate(successes: number, n: number, priorRate: number, priorWeight: number): number {
  throw new Error('not implemented');
}

/** STUB — implemented by task T03. */
export function filterRecords(records: PlayerMatchRecord[], filter: MatchFilter): PlayerMatchRecord[] {
  throw new Error('not implemented');
}

/** STUB — implemented by task T03. */
export function computeStatLine(records: PlayerMatchRecord[]): StatLine {
  throw new Error('not implemented');
}

/** STUB — implemented by task T03. */
export function groupStats(records: PlayerMatchRecord[], key: GroupKey, config: AggregateConfig = DEFAULT_AGGREGATE_CONFIG): GroupStat[] {
  throw new Error('not implemented');
}

/** STUB — implemented by task T03. */
export function computeTrend(records: PlayerMatchRecord[], metric: TrendMetric, window: number): TrendPoint[] {
  throw new Error('not implemented');
}
