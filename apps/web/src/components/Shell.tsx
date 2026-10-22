import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { connectRiot, devLogin, getMe, logout } from '../api/client';
import { useApi } from '../api/useApi';
import { MeContext } from '../me';
import { ErrorState, Loading } from './States';
import { FilterBar } from './FilterBar';
import { Footer } from './Footer';

const DATA_NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/agents', label: 'Agents' },
  { to: '/maps', label: 'Maps' },
  { to: '/insights', label: 'Insights' },
  { to: '/matches', label: 'Matches' },
];
const FILTERED = new Set(['/', '/agents', '/maps', '/insights', '/matches']);

export function Shell() {
  const me = useApi(getMe, []);
  const loc = useLocation();

  let body;
  if (me.loading && !me.data) body = <Loading />;
  else if (me.error) body = <ErrorState error={me.error} onRetry={me.reload} />;
  else if (me.data && !me.data.user) {
    body = <Landing demoMode={me.data.demoMode} onSignedIn={me.reload} />;
  } else if (me.data) {
    body = (
      <MeContext.Provider value={{ me: me.data, reloadMe: me.reload }}>
        {FILTERED.has(loc.pathname) && <FilterBar />}
        <Outlet />
      </MeContext.Provider>
    );
  }

  const signedIn = !!me.data?.user;
  return (
    <div className="app">
      <header className="site-header">
        <a className="brand" href="/">
          VALORANT Analyzer
        </a>
        {signedIn && (
          <nav aria-label="Main">
            {DATA_NAV.map((n) => (
              <NavLink key={n.to} to={{ pathname: n.to, search: loc.search }} end={n.end}>
                {n.label}
              </NavLink>
            ))}
            <NavLink to="/settings">Settings</NavLink>
          </nav>
        )}
        {signedIn && me.data?.user && <span className="who">{me.data.user.displayName}</span>}
        {signedIn && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              logout().finally(() => window.location.assign('/'));
            }}
          >
            Sign out
          </button>
        )}
      </header>
      <main id="main">{body}</main>
      <Footer />
    </div>
  );
}

function Landing({ demoMode, onSignedIn }: { demoMode: boolean; onSignedIn: () => void }) {
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="landing">
      <h1>Understand your VALORANT match history</h1>
      <p>
        Import your own authorized match history and see win rate, K/D, agent and map breakdowns, and evidence-based
        practice suggestions. Everything is calculated from your own matches.
      </p>
      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I agree that
        VALORANT Analyzer may read my own match history from Riot to calculate these statistics.
      </label>
      <div className="actions">
        <button
          type="button"
          disabled={!consent}
          onClick={() => {
            setError(null);
            connectRiot().then(
              (r) => window.location.assign(r.redirectUrl),
              (e: Error) => setError(e.message),
            );
          }}
        >
          Sign in
        </button>
        {demoMode && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              devLogin().then(onSignedIn, (e: Error) => setError(e.message));
            }}
          >
            Try demo
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="state-error">
          {error}
        </p>
      )}
    </section>
  );
}
