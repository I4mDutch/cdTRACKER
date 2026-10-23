import type { PlayerMatchRecord } from '@va/shared';

/**
 * RFC 4180 cell escaping plus CSV-injection defense: string cells that a spreadsheet could
 * interpret as a formula (leading = + - @, tab or CR) are prefixed with a single quote.
 * Numbers and booleans are never prefixed (a negative number is not a formula).
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'string' ? value : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [header.map(escapeCsvCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCsvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

export const RECORD_COLUMNS = [
  'matchId',
  'puuid',
  'startedAt',
  'source',
  'mapId',
  'queueId',
  'patch',
  'agentId',
  'teamId',
  'outcome',
  'roundsPlayed',
  'roundsWon',
  'roundsLost',
  'kills',
  'deaths',
  'assists',
  'combatScore',
  'damageDealt',
  'headshots',
  'bodyshots',
  'legshots',
  'firstKills',
  'firstDeaths',
  'plants',
  'defuses',
  'performanceScore',
] as const satisfies readonly (keyof PlayerMatchRecord)[];

// Compile-time check that every PlayerMatchRecord field is exported.
type MissingColumns = Exclude<keyof PlayerMatchRecord, (typeof RECORD_COLUMNS)[number]>;
export const _allColumnsCovered: [MissingColumns] extends [never] ? true : never = true;

export const EXTRA_COLUMNS = ['map_name', 'agent_name', 'excluded'] as const;
export const ALL_COLUMNS: readonly string[] = [...RECORD_COLUMNS, ...EXTRA_COLUMNS];

export const COLUMN_DEFINITIONS: Record<string, string> = {
  matchId: 'Riot match identifier',
  puuid: 'Your Riot account identifier (this export contains only your own data)',
  startedAt: 'Match start time, ISO 8601 UTC',
  source: 'Where the row came from: riot (synced from Riot) or manual (typed in or imported by you)',
  mapId: 'Map asset path',
  queueId: 'Queue, e.g. competitive',
  patch: 'Game patch, major.minor; empty when unavailable',
  agentId: 'Agent identifier you played',
  teamId: 'Your team (Red or Blue)',
  outcome: 'win, loss or draw from your team perspective',
  roundsPlayed: 'Total rounds in the match',
  roundsWon: 'Rounds your team won',
  roundsLost: 'Rounds your team lost',
  kills: 'Your kills',
  deaths: 'Your deaths',
  assists: 'Your assists',
  combatScore: 'Total combat score from Riot; empty when unavailable',
  damageDealt: 'Total damage you dealt (calculated from round data); empty when no round data',
  headshots: 'Headshots landed (from round data); empty when no round data',
  bodyshots: 'Bodyshots landed (from round data); empty when no round data',
  legshots: 'Legshots landed (from round data); empty when no round data',
  firstKills: 'Rounds where you got the first kill (calculated); empty when no round data',
  firstDeaths: 'Rounds where you died first (calculated); empty when no round data',
  plants: 'Spike plants by you (from round data); empty when no round data',
  defuses: 'Spike defuses by you (from round data); empty when no round data',
  performanceScore: 'Riot in-game Performance Score. Not provided by the Riot match API, always empty',
  map_name: 'Display name of the map',
  agent_name: 'Display name of the agent',
  excluded: 'Reason the match is excluded from analysis (e.g. remake); empty when it counts',
};
