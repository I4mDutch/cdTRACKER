import { vi } from 'vitest';
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MeResponse, StatLine } from '@va/shared';
import { MeContext } from '../src/me';

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Install a fetch mock routed by "METHOD /path" (query string ignored). */
export function mockFetch(routes: Record<string, unknown | ((init?: RequestInit) => Response)>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = url.split('?')[0] as string;
    const handler = routes[`${method} ${path}`];
    if (handler === undefined) return jsonResponse({ error: { code: 'not_found', message: `no mock for ${method} ${url}` } }, 404);
    if (typeof handler === 'function') return (handler as (i?: RequestInit) => Response)(init);
    return jsonResponse(handler);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const ME: MeResponse = {
  user: { id: 'u1', displayName: 'Demo' },
  link: { state: 'up_to_date', riotId: 'Demo#0001', region: 'na', lastSyncedAt: null, lastError: null, consentedAt: null },
  demoMode: true,
};

export function renderAt(ui: ReactElement, path: string, routePath = '*') {
  return render(
    <MeContext.Provider value={{ me: ME, reloadMe: () => {} }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={ui} />
        </Routes>
      </MemoryRouter>
    </MeContext.Provider>,
  );
}

export function statLine(over: Partial<StatLine> = {}): StatLine {
  return {
    matches: 10, wins: 5, losses: 5, draws: 0, winRate: 0.5, winRateInterval: { low: 0.24, high: 0.76 },
    rounds: 200, kills: 150, deaths: 140, assists: 50, kd: 1.07, kda: 1.43, zeroDeaths: false,
    killsPerRound: 0.75, deathsPerRound: 0.7, assistsPerRound: 0.25, acs: 210, adr: 140, headshotPct: 0.2,
    firstKillsPerRound: 0.1, firstDeathsPerRound: 0.1, firstDuelWinRate: 0.5,
    coverage: { combatScore: 10, roundData: 10, roundDataRounds: 200, firstDuel: 10, firstDuelRounds: 200 },
    ...over,
  };
}
