import { useSearchParams } from 'react-router-dom';
import { getMatches } from '../api/client';
import { useApi } from '../api/useApi';
import { useFilter } from '../filters';
import { Empty, MatchContext, Query } from '../components/States';
import { MatchTable } from '../components/MatchTable';

export function Matches() {
  const { filter, filterKey } = useFilter();
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const state = useApi(() => getMatches(filter, page, 20), [filterKey, page]);
  const go = (p: number) => {
    const next = new URLSearchParams(sp);
    next.set('page', String(p));
    setSp(next);
  };
  return (
    <div className="page">
      <h1>Matches</h1>
      <Query state={state}>
        {(d) => {
          if (d.total === 0) return <><MatchContext matches={0} /><Empty /></>;
          const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
          return (
            <>
              <MatchContext matches={d.total} />
              <MatchTable rows={d.items} caption="Matches, newest first" />
              <nav className="pager" aria-label="Pagination">
                <button type="button" className="secondary" disabled={d.page <= 1} onClick={() => go(d.page - 1)}>
                  Previous
                </button>
                <span>
                  Page {d.page} of {pages}
                </span>
                <button type="button" className="secondary" disabled={d.page >= pages} onClick={() => go(d.page + 1)}>
                  Next
                </button>
              </nav>
            </>
          );
        }}
      </Query>
    </div>
  );
}
