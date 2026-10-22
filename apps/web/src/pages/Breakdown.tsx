import { useMemo, useState } from 'react';
import type { BreakdownResponse, BreakdownRow } from '@va/shared';
import { getAgents, getMaps } from '../api/client';
import { useApi } from '../api/useApi';
import { useFilter } from '../filters';
import { deltaClass, fmtDelta, fmtKd, fmtNum, fmtPct } from '../format';
import { Empty, MatchContext, Query } from '../components/States';
import { Val } from '../components/Val';

type SortKey = 'name' | 'matches' | 'winRate' | 'kd' | 'acs' | 'adr' | 'winRateDelta';
type Dir = 'ascending' | 'descending';

const COLS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'matches', label: 'Matches' },
  { key: 'winRate', label: 'Win rate' },
  { key: 'kd', label: 'K/D' },
  { key: 'acs', label: 'ACS' },
  { key: 'adr', label: 'ADR' },
  { key: 'winRateDelta', label: 'Δ win rate vs baseline' },
];

function sortValue(r: BreakdownRow, k: SortKey): string | number | null {
  switch (k) {
    case 'name':
      return r.name.toLowerCase();
    case 'matches':
      return r.stat.matches;
    case 'winRate':
      return r.stat.winRate;
    case 'kd':
      return r.stat.kd;
    case 'acs':
      return r.stat.acs;
    case 'adr':
      return r.stat.adr;
    case 'winRateDelta':
      return r.winRateDelta;
  }
}

export function sortRows(rows: BreakdownRow[], key: SortKey, dir: Dir): BreakdownRow[] {
  const m = dir === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x == null && y == null) return 0;
    if (x == null) return 1; // unavailable always last
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * m;
  });
}

function BreakdownTable({ rows, caption, nameLabel }: { rows: BreakdownRow[]; caption: string; nameLabel: string }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: 'matches', dir: 'descending' });
  const sorted = useMemo(() => sortRows(rows, sort.key, sort.dir), [rows, sort]);
  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'ascending' ? 'descending' : 'ascending' } : { key, dir: key === 'name' ? 'ascending' : 'descending' }));
  return (
    <div className="table-wrap">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.key} scope="col" aria-sort={sort.key === c.key ? sort.dir : 'none'}>
                <button type="button" className="sort" onClick={() => toggle(c.key)}>
                  {c.key === 'name' ? nameLabel : c.label}
                  <span aria-hidden="true">{sort.key === c.key ? (sort.dir === 'ascending' ? ' ▲' : ' ▼') : ''}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                {r.name}
                {r.lowSample && (
                  <>
                    {' '}
                    <span className="badge badge-warn">Low sample</span>
                  </>
                )}
              </th>
              <td>{r.stat.matches}</td>
              <td>
                <Val text={fmtPct(r.stat.winRate)} />
              </td>
              <td>
                <Val text={fmtKd(r.stat.kd)} />
              </td>
              <td>
                <Val text={fmtNum(r.stat.acs)} />
              </td>
              <td>
                <Val text={fmtNum(r.stat.adr)} />
              </td>
              <td className={deltaClass(r.winRateDelta)}>
                <Val text={fmtDelta(r.winRateDelta)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const HEAT_METRICS: { label: string; get: (r: BreakdownRow) => number | null; fmt: (v: number | null) => string; lo: number; hi: number }[] = [
  { label: 'Win rate', get: (r) => r.stat.winRate, fmt: (v) => fmtPct(v), lo: 0.3, hi: 0.7 },
  { label: 'K/D', get: (r) => r.stat.kd, fmt: (v) => fmtKd(v), lo: 0.7, hi: 1.5 },
  { label: 'ACS', get: (r) => r.stat.acs, fmt: (v) => fmtNum(v), lo: 120, hi: 280 },
  { label: 'ADR', get: (r) => r.stat.adr, fmt: (v) => fmtNum(v), lo: 90, hi: 180 },
];

function Heatmap({ rows }: { rows: BreakdownRow[] }) {
  return (
    <div className="table-wrap">
      <table className="heatmap">
        <caption>Map performance heatmap (values shown as text; shading is a visual aid only)</caption>
        <thead>
          <tr>
            <th scope="col">Map</th>
            {HEAT_METRICS.map((m) => (
              <th key={m.label} scope="col">
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                {r.name}
                {r.lowSample && (
                  <>
                    {' '}
                    <span className="badge badge-warn">Low sample</span>
                  </>
                )}
              </th>
              {HEAT_METRICS.map((m) => {
                const v = m.get(r);
                const t = v == null ? null : Math.max(0, Math.min(1, (v - m.lo) / (m.hi - m.lo)));
                return (
                  <td
                    key={m.label}
                    style={t == null ? undefined : { background: `rgba(90, 169, 230, ${0.08 + t * 0.5})` }}
                  >
                    <Val text={m.fmt(v)} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BreakdownBody({ data, kind }: { data: BreakdownResponse; kind: 'agents' | 'maps' }) {
  const [view, setView] = useState<'table' | 'heatmap'>('table');
  const b = data.baseline;
  if (data.rows.length === 0) return <Empty />;
  return (
    <>
      <p className="context">
        Baseline: {b.matches} matches · win rate <Val text={fmtPct(b.winRate)} />. “Low sample” means fewer than{' '}
        {data.lowSampleThreshold} matches.
      </p>
      {kind === 'maps' && (
        <div className="toggle" role="group" aria-label="Map view">
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
            Table
          </button>
          <button type="button" aria-pressed={view === 'heatmap'} onClick={() => setView('heatmap')}>
            Heatmap
          </button>
        </div>
      )}
      {kind === 'maps' && view === 'heatmap' ? (
        <Heatmap rows={data.rows} />
      ) : (
        <BreakdownTable
          rows={data.rows}
          caption={kind === 'agents' ? 'Performance by agent' : 'Performance by map'}
          nameLabel={kind === 'agents' ? 'Agent' : 'Map'}
        />
      )}
    </>
  );
}

function BreakdownPage({ kind }: { kind: 'agents' | 'maps' }) {
  const { filter, filterKey } = useFilter();
  const state = useApi(() => (kind === 'agents' ? getAgents(filter) : getMaps(filter)), [filterKey, kind]);
  return (
    <div className="page">
      <h1>{kind === 'agents' ? 'Agents' : 'Maps'}</h1>
      <Query state={state}>
        {(d) => (
          <>
            <MatchContext matches={d.baseline.matches} />
            <BreakdownBody data={d} kind={kind} />
          </>
        )}
      </Query>
    </div>
  );
}

export const Agents = () => <BreakdownPage kind="agents" />;
export const Maps = () => <BreakdownPage kind="maps" />;
