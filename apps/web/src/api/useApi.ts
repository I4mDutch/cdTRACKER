import { useCallback, useEffect, useState } from 'react';
import { ApiClientError } from './client';

export interface ApiState<T> {
  data: T | null;
  error: ApiClientError | null;
  loading: boolean;
  reload: () => void;
}

function toError(e: unknown): ApiClientError {
  if (e instanceof ApiClientError) return e;
  return new ApiClientError(0, 'unknown', e instanceof Error ? e.message : 'Something went wrong');
}

/** Run `fn` on mount and whenever `deps` change. Stale responses are ignored. */
export function useApi<T>(fn: () => Promise<T>, deps: readonly unknown[]): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fn().then(
      (d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      },
      (e) => {
        if (cancelled) return;
        setData(null);
        setError(toError(e));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
