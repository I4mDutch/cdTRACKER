import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { MatchFilter } from '@va/shared';

const KEYS = ['agentId', 'mapId', 'queueId', 'patch', 'from', 'to'] as const;

export function parseFilter(sp: URLSearchParams): MatchFilter {
  const f: MatchFilter = {};
  for (const k of KEYS) {
    const v = sp.get(k);
    if (v) f[k] = v;
  }
  const src = sp.get('source');
  if (src === 'riot' || src === 'manual') f.source = src;
  const n = Number(sp.get('lastN'));
  if (Number.isInteger(n) && n > 0) f.lastN = n;
  return f;
}

/** The global filter lives in the URL search params so views are shareable/bookmarkable. */
export function useFilter(): { filter: MatchFilter; filterKey: string; setFilter: (f: MatchFilter) => void } {
  const [sp, setSp] = useSearchParams();
  const filter = useMemo(() => parseFilter(sp), [sp]);
  const filterKey = JSON.stringify(filter);
  const setFilter = useCallback(
    (f: MatchFilter) => {
      const next = new URLSearchParams();
      for (const k of KEYS) if (f[k]) next.set(k, f[k] as string);
      if (f.source) next.set('source', f.source);
      if (f.lastN) next.set('lastN', String(f.lastN));
      setSp(next, { replace: false });
    },
    [setSp],
  );
  return { filter, filterKey, setFilter };
}
