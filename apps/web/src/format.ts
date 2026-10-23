export const UNAVAILABLE = '—';
export const UNAVAILABLE_TITLE = 'Not available from the data source';

type N = number | null | undefined;

/** Fraction (0..1) → "52.3%". */
export function fmtPct(v: N, digits = 1): string {
  return v == null || Number.isNaN(v) ? UNAVAILABLE : `${(v * 100).toFixed(digits)}%`;
}

export function fmtKd(v: N): string {
  return v == null || Number.isNaN(v) ? UNAVAILABLE : v.toFixed(2);
}

export function fmtNum(v: N, digits = 0): string {
  return v == null || Number.isNaN(v) ? UNAVAILABLE : v.toFixed(digits);
}

/** Fraction delta → "+5.2 pp" / "−3.1 pp" with an arrow glyph so it never relies on color alone. */
export function fmtDelta(v: N): string {
  if (v == null || Number.isNaN(v)) return UNAVAILABLE;
  const pp = v * 100;
  if (Math.abs(pp) < 0.05) return '■ 0.0 pp';
  return pp > 0 ? `▲ +${pp.toFixed(1)} pp` : `▼ −${Math.abs(pp).toFixed(1)} pp`;
}

export function deltaClass(v: N): string {
  if (v == null || Math.abs(v) < 0.0005) return 'delta-flat';
  return v > 0 ? 'delta-up' : 'delta-down';
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return UNAVAILABLE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return UNAVAILABLE;
  return d.toISOString().slice(0, 10);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return UNAVAILABLE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return UNAVAILABLE;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

export function fmtRange(from: string | null | undefined, to: string | null | undefined): string {
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return UNAVAILABLE;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

const RATE_METRICS = new Set(['winRate', 'headshotPct', 'firstDuelWinRate']);
const PER_ROUND_METRICS = new Set([
  'killsPerRound',
  'deathsPerRound',
  'assistsPerRound',
  'firstKillsPerRound',
  'firstDeathsPerRound',
]);

export function fmtMetric(metric: string, v: N): string {
  if (RATE_METRICS.has(metric)) return fmtPct(v);
  if (PER_ROUND_METRICS.has(metric)) return fmtNum(v, 2);
  return fmtNum(v, 2);
}

const METRIC_LABELS: Record<string, string> = {
  winRate: 'Win rate',
  kd: 'K/D',
  kda: 'KDA',
  acs: 'ACS',
  adr: 'ADR',
  killsPerRound: 'Kills per round',
  deathsPerRound: 'Deaths per round',
  assistsPerRound: 'Assists per round',
  firstDuelWinRate: 'First-duel win rate',
  firstKillsPerRound: 'First kills per round',
  firstDeathsPerRound: 'First deaths per round',
  headshotPct: 'Headshot %',
};
export const metricLabel = (m: string): string => METRIC_LABELS[m] ?? m;

export const OUTCOME_LABEL: Record<string, string> = { win: 'W', loss: 'L', draw: 'D' };
export const OUTCOME_WORD: Record<string, string> = { win: 'Win', loss: 'Loss', draw: 'Draw' };

export function kdOf(kills: number, deaths: number): string {
  if (deaths === 0) return kills > 0 ? kills.toFixed(2) : UNAVAILABLE;
  return (kills / deaths).toFixed(2);
}

export const MANUAL_TITLE = 'Entered manually — not from Riot';
