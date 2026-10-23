import { describe, expect, it } from 'vitest';
import { MANUAL_CSV_COLUMNS } from '@va/shared';
import { buildTemplateCsv, parseCsv, parseImportFile } from '../src/http/csvImport.js';

const catalog = {
  agents: [
    { id: 'agent-jett', name: 'Jett' },
    { id: 'agent-sage', name: 'Sage' },
  ],
  maps: [
    { id: '/Game/Maps/Ascent/Ascent', name: 'Ascent' },
    { id: '/Game/Maps/Bind/Bind', name: 'Bind' },
  ],
};
const HEADER = 'date,map,agent,rounds_won,rounds_lost,kills,deaths,assists';
const ROW = '2025-03-14,Ascent,Jett,13,9,18,12,5';

const run = (csv: string) => parseImportFile(csv, catalog);
const fails = (csv: string): string => {
  try {
    run(csv);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected a file-level error');
};

describe('parseCsv', () => {
  it('parses plain rows with LF and CRLF', () => {
    expect(parseCsv('a,b\n1,2\n').map((r) => r.cells)).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\r\n1,2\r\n').map((r) => r.cells)).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('handles quotes, escaped quotes, embedded commas and newlines', () => {
    const rows = parseCsv('a,b\n"x, y","say ""hi"""\n"two\nlines",z\n');
    expect(rows[1]!.cells).toEqual(['x, y', 'say "hi"']);
    expect(rows[2]!.cells).toEqual(['two\nlines', 'z']);
  });
  it('strips a UTF-8 BOM and ignores trailing and blank lines', () => {
    const rows = parseCsv('﻿a,b\n1,2\n\n\n');
    expect(rows.map((r) => r.cells)).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('keeps empty cells and a final row without newline', () => {
    expect(parseCsv('a,b,c\n1,,3')[1]!.cells).toEqual(['1', '', '3']);
    expect(parseCsv('a\n""')[1]!.cells).toEqual(['']);
  });
  it('reports physical line numbers across embedded newlines', () => {
    const rows = parseCsv('a,b\n"x\ny",1\n\n2,3\n');
    expect(rows.map((r) => r.line)).toEqual([1, 2, 5]);
  });
  it('rejects an unterminated quote naming the line it opened on', () => {
    expect(() => parseCsv('a,b\n1,2\n3,"oops\n4,5\n')).toThrow(/line 3/);
  });
});

describe('parseImportFile headers', () => {
  it('is case-insensitive, trims and accepts any column order', () => {
    const rows = run(' Kills , DATE,Map,agent,Rounds_Won,rounds_lost,deaths,assists\n18,2025-03-14,Ascent,Jett,13,9,12,5');
    expect(rows[0]).toMatchObject({ status: 'valid', parsed: { kills: 18, roundsWon: 13 } });
  });
  it('rejects unknown columns, naming them', () => {
    expect(fails(`${HEADER},bogus,extra\n${ROW},1,2`)).toMatch(/bogus, extra/);
  });
  it('rejects missing required columns, naming them', () => {
    expect(fails('date,map,agent,kills\n2025-03-14,Ascent,Jett,1')).toMatch(/rounds_won, rounds_lost, deaths, assists/);
  });
  it('rejects empty and header-only files', () => {
    expect(fails('')).toMatch(/empty/);
    expect(fails(`${HEADER}\n`)).toMatch(/no data rows/);
  });
  it('rejects duplicate columns', () => {
    expect(fails(`${HEADER},kills\n${ROW},1`)).toMatch(/more than once/);
  });
  it('rejects more than the row limit', () => {
    const many = Array.from({ length: 1001 }, () => ROW).join('\n');
    expect(fails(`${HEADER}\n${many}`)).toMatch(/Too many rows/);
  });
});

describe('parseImportFile rows', () => {
  it('resolves map and agent by name (case-insensitive) or id', () => {
    const rows = run(`${HEADER}\n2025-03-14, ascent ,JETT,13,9,18,12,5\n2025-03-15,/Game/Maps/Bind/Bind,agent-sage,13,9,18,12,5`);
    expect(rows[0]!.parsed).toMatchObject({ mapId: '/Game/Maps/Ascent/Ascent', agentId: 'agent-jett' });
    expect(rows[1]!.parsed).toMatchObject({ mapId: '/Game/Maps/Bind/Bind', agentId: 'agent-sage' });
  });
  it('reports unknown map and agent', () => {
    const [r] = run(`${HEADER}\n2025-03-14,Nowhere,Nobody,13,9,18,12,5`);
    expect(r).toMatchObject({ status: 'invalid', parsed: null });
    expect(r!.errors.some((e) => /^map: unknown map "/.test(e))).toBe(true);
    expect(r!.errors.some((e) => /^agent: unknown agent "/.test(e))).toBe(true);
  });
  it('turns blank optional cells into null and defaults the queue', () => {
    const [r] = run(`${HEADER},queue,acs,adr,first_kills,first_deaths,patch,note\n${ROW},,,,,,,`);
    expect(r!.parsed).toMatchObject({ queueId: 'competitive', acs: null, adr: null, firstKills: null, firstDeaths: null, patch: null, note: null });
  });
  it('strips one leading apostrophe from cells', () => {
    const [r] = run(`${HEADER},note\n${ROW},'=1+1`);
    expect(r!.parsed!.note).toBe('=1+1');
  });
  it('flags bad values with field: problem messages and keeps going', () => {
    const rows = run(`${HEADER}\n${ROW}\n2025-03-14,Ascent,Jett,13,9,-1,12,5\n2999-01-01,Ascent,Jett,13,9,1,1,1\n2025-03-14,Ascent,Jett,abc,9,1,1,1`);
    expect(rows.map((r) => r.status)).toEqual(['valid', 'invalid', 'invalid', 'invalid']);
    expect(rows[1]!.errors[0]).toMatch(/^kills: /);
    expect(rows[2]!.errors[0]).toMatch(/^date: .*future/);
    expect(rows[3]!.errors[0]).toMatch(/^rounds_won: /);
  });
  it('rejects first kills + first deaths above the rounds played', () => {
    const [r] = run(`${HEADER},first_kills,first_deaths\n2025-03-14,Ascent,Jett,1,1,1,1,1,2,1`);
    expect(r!.errors.join()).toMatch(/^first_kills: first kills plus first deaths/);
  });
  it('uses the physical line of the row start', () => {
    const rows = run(`${HEADER},note\n${ROW},"a\nb"\n2025-03-15,Ascent,Jett,13,9,18,12,5,x`);
    expect(rows.map((r) => r.line)).toEqual([2, 4]);
    expect(rows[0]!.parsed!.note).toBe('a\nb');
  });
});

describe('template', () => {
  it('lists every column and its example row imports cleanly', () => {
    const csv = buildTemplateCsv(catalog);
    expect(csv.split('\r\n')[0]).toBe(MANUAL_CSV_COLUMNS.map((c) => c.name).join(','));
    const rows = run(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'valid', parsed: { mapId: '/Game/Maps/Ascent/Ascent', agentId: 'agent-jett' } });
  });
});
