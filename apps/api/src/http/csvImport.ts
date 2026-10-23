import { MANUAL_CSV_COLUMNS, MANUAL_LIMITS, type ManualMatchInput } from '@va/shared';
import { HttpError } from './errors.js';
import { toCsv } from './csv.js';
import { validateManualInput, type Catalog } from './validation.js';

export interface CsvRow {
  /** 1-based physical line the row starts on */
  line: number;
  cells: string[];
}

const fileError = (message: string): HttpError => new HttpError(400, 'validation', message);

/**
 * RFC 4180 parser: quoted fields, "" escapes, commas/newlines inside quotes, CRLF/LF/CR, UTF-8 BOM.
 * Blank lines are skipped. An unterminated quote rejects the whole file, naming the line the quote opened on.
 */
export function parseCsv(input: string): CsvRow[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false; // currently inside quotes
  let wasQuoted = false; // the current cell used quotes (so '""' is a real empty cell)
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;
  let i = 0;

  const endCell = (): void => {
    cells.push(cell);
    cell = '';
    wasQuoted = false;
  };
  const endRow = (): void => {
    endCell();
    const blank = cells.length === 1 && cells[0] === '' && !wasQuotedRow;
    if (!blank) rows.push({ line: rowLine, cells });
    cells = [];
    wasQuotedRow = false;
  };
  let wasQuotedRow = false;

  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      if (ch === '\r' && text[i + 1] === '\n') {
        cell += '\r\n';
        line++;
        i += 2;
        continue;
      }
      if (ch === '\n' || ch === '\r') line++;
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === '' && !wasQuoted) {
      quoted = true;
      wasQuoted = true;
      wasQuotedRow = true;
      quoteLine = line;
      i++;
    } else if (ch === ',') {
      endCell();
      i++;
    } else if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      line++;
      rowLine = line;
    } else {
      cell += ch;
      i++;
    }
  }
  if (quoted) throw fileError(`The file is not valid CSV: the quoted field that starts on line ${quoteLine} is never closed.`);
  if (cell !== '' || cells.length > 0 || wasQuoted) endRow();
  return rows;
}

const COLUMN_FIELD: Record<string, keyof ManualMatchInput> = {
  date: 'date',
  map: 'mapId',
  agent: 'agentId',
  queue: 'queueId',
  rounds_won: 'roundsWon',
  rounds_lost: 'roundsLost',
  kills: 'kills',
  deaths: 'deaths',
  assists: 'assists',
  acs: 'acs',
  adr: 'adr',
  first_kills: 'firstKills',
  first_deaths: 'firstDeaths',
  patch: 'patch',
  note: 'note',
};
const NUMERIC_FIELDS = new Set<keyof ManualMatchInput>(['roundsWon', 'roundsLost', 'kills', 'deaths', 'assists', 'acs', 'adr', 'firstKills', 'firstDeaths']);
const NUMBER_RE = /^[+-]?\d+(\.\d+)?$/;

export interface ParsedImportRow {
  line: number;
  status: 'valid' | 'invalid';
  errors: string[];
  parsed: ManualMatchInput | null;
}

function resolve(raw: string, list: { id: string; name: string }[]): string {
  const key = raw.trim().toLowerCase();
  const hit = list.find((x) => x.name.trim().toLowerCase() === key) ?? list.find((x) => x.id.toLowerCase() === key);
  return hit ? hit.id : raw.trim();
}

const FIELD_COLUMN: Record<string, string> = Object.fromEntries(Object.entries(COLUMN_FIELD).map(([col, field]) => [field, col]));

/** Rewrites a validation error's `field:` prefix to the CSV column name, quoting the offending map/agent value. */
function toColumnError(error: string, raw: Record<string, string>): string {
  const m = /^(\w+): (.*)$/.exec(error);
  if (!m) return error;
  const [, field, problem] = m as unknown as [string, string, string];
  const col = FIELD_COLUMN[field] ?? field;
  const value = raw[field];
  return (field === 'mapId' || field === 'agentId') && value !== undefined ? `${col}: ${problem} "${value}"` : `${col}: ${problem}`;
}

/** Parses and validates a whole import file. File-level problems throw a 400 HttpError; row problems are per-row. */
export function parseImportFile(csv: string, catalog: Catalog): ParsedImportRow[] {
  const all = parseCsv(csv);
  if (all.length === 0) throw fileError('The file is empty. It needs a header row and at least one data row.');
  const [head, ...data] = all as [CsvRow, ...CsvRow[]];
  const header = head.cells.map((c) => c.trim().toLowerCase());
  const known = new Set(MANUAL_CSV_COLUMNS.map((c) => c.name));
  const unknown = header.filter((h) => !known.has(h));
  if (unknown.length > 0) throw fileError(`Unknown column(s) in the header row: ${[...new Set(unknown.map((u) => u || '(blank)'))].join(', ')}. Use the template for the expected columns.`);
  const dupes = header.filter((h, i) => header.indexOf(h) !== i);
  if (dupes.length > 0) throw fileError(`Column(s) listed more than once in the header row: ${[...new Set(dupes)].join(', ')}.`);
  const missing = MANUAL_CSV_COLUMNS.filter((c) => c.required && !header.includes(c.name)).map((c) => c.name);
  if (missing.length > 0) throw fileError(`Missing required column(s): ${missing.join(', ')}.`);
  if (data.length === 0) throw fileError('The file has a header row but no data rows.');
  if (data.length > MANUAL_LIMITS.importMaxRows) throw fileError(`Too many rows: the limit is ${MANUAL_LIMITS.importMaxRows} per import (this file has ${data.length}).`);

  return data.map((row): ParsedImportRow => {
    const input: Record<string, unknown> = {};
    const raw: Record<string, string> = {};
    header.forEach((col, idx) => {
      const field = COLUMN_FIELD[col]!;
      let v = (row.cells[idx] ?? '').trim();
      if (v.startsWith("'")) v = v.slice(1); // undo our export's formula-escaping
      if (v === '') return; // blank = not entered (optional) or missing (required → "is required")
      raw[field] = v;
      if (field === 'mapId') input[field] = resolve(v, catalog.maps);
      else if (field === 'agentId') input[field] = resolve(v, catalog.agents);
      else if (NUMERIC_FIELDS.has(field) && NUMBER_RE.test(v)) input[field] = Number(v);
      else input[field] = v;
    });
    const errors: string[] = [];
    if (row.cells.length > header.length) errors.push(`row: has ${row.cells.length} cells but the header has ${header.length} columns`);
    const r = validateManualInput(input, catalog);
    // Speak the file's language: "map: unknown map "Nowhere"" rather than API field names.
    if (!r.ok) errors.push(...r.errors.map((e) => toColumnError(e, raw)));
    if (errors.length > 0 || !r.ok) return { line: row.line, status: 'invalid', errors, parsed: null };
    return { line: row.line, status: 'valid', errors: [], parsed: r.value };
  });
}

export function buildTemplateCsv(catalog: Catalog, now: Date = new Date()): string {
  const example: Record<string, unknown> = {
    date: now.toISOString().slice(0, 10),
    map: catalog.maps[0]?.name ?? 'Ascent',
    agent: catalog.agents[0]?.name ?? 'Jett',
    queue: 'competitive',
    rounds_won: 13,
    rounds_lost: 9,
    kills: 18,
    deaths: 12,
    assists: 5,
    acs: 245,
    adr: 160,
    first_kills: 3,
    first_deaths: 2,
    patch: '',
    note: 'Example row: replace or delete it',
  };
  return toCsv(
    MANUAL_CSV_COLUMNS.map((c) => c.name),
    [MANUAL_CSV_COLUMNS.map((c) => example[c.name])],
  );
}
