import type { ReactNode } from 'react';
import type { ApiState } from '../api/useApi';
import type { SourceCounts } from '@va/shared';
import { fmtRange } from '../format';
import { MANUAL_TITLE } from '../format';

/** " · includes N manual entries" — rendered only when manual records fed the numbers. */
export function ManualInclude({ sources }: { sources?: SourceCounts | null }) {
  if (!sources || sources.manual <= 0) return null;
  return (
    <span title={MANUAL_TITLE} data-testid="manual-included">
      {' · '}includes {sources.manual} manual {sources.manual === 1 ? 'entry' : 'entries'}
    </span>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="state state-loading" role="status">
      {label}
    </p>
  );
}

export function ErrorState({ error, onRetry }: { error: { message: string; status?: number }; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <p>{error.status === 401 ? 'Please sign in to see this page.' : error.message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ children = 'No matches for these filters' }: { children?: ReactNode }) {
  return <p className="state state-empty">{children}</p>;
}

/** "N matches · from – to" context line shown on every data view. */
export function MatchContext({
  matches,
  from,
  to,
  sources,
}: {
  matches: number;
  from?: string | null;
  to?: string | null;
  sources?: SourceCounts | null;
}) {
  return (
    <p className="context">
      {matches} {matches === 1 ? 'match' : 'matches'}
      {from !== undefined || to !== undefined ? ` · ${fmtRange(from, to)}` : ''}
      <ManualInclude sources={sources} />
    </p>
  );
}

/** Handles the loading / error states of a query; `children` renders once data exists. */
export function Query<T>({ state, children }: { state: ApiState<T>; children: (data: T) => ReactNode }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Loading />;
  return <>{children(state.data)}</>;
}
