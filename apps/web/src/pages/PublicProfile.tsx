import { useParams } from 'react-router-dom';
import { getPublicProfile } from '../api/client';
import { useApi } from '../api/useApi';
import { fmtKd, fmtPct, fmtRange } from '../format';
import { Footer } from '../components/Footer';
import { Query } from '../components/States';
import { Val } from '../components/Val';

export function PublicProfile() {
  const { token = '' } = useParams();
  const state = useApi(() => getPublicProfile(token), [token]);
  return (
    <div className="app">
      <header className="site-header">
        <span className="brand">VALORANT Analyzer</span>
        <span className="small">Shared profile</span>
      </header>
      <main id="main" className="page">
        <Query state={state}>
          {(p) => (
            <section className="card" aria-labelledby="pp">
              <h1 id="pp">{p.displayName}</h1>
              <p className="context">
                {p.matchCount} {p.matchCount === 1 ? 'match' : 'matches'} · {fmtRange(p.range.from, p.range.to)}
              </p>
              <dl className="facts">
                {p.winRate !== undefined && (
                  <>
                    <dt>Win rate</dt>
                    <dd><Val text={fmtPct(p.winRate)} /></dd>
                  </>
                )}
                {p.kd !== undefined && (
                  <>
                    <dt>K/D</dt>
                    <dd><Val text={fmtKd(p.kd)} /></dd>
                  </>
                )}
              </dl>
              {p.topAgents && (
                <table>
                  <caption>Top agents</caption>
                  <thead>
                    <tr><th scope="col">Agent</th><th scope="col">Matches</th><th scope="col">Win rate</th></tr>
                  </thead>
                  <tbody>
                    {p.topAgents.map((a) => (
                      <tr key={a.name}><th scope="row">{a.name}</th><td>{a.matches}</td><td><Val text={fmtPct(a.winRate)} /></td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {p.topMaps && (
                <table>
                  <caption>Top maps</caption>
                  <thead>
                    <tr><th scope="col">Map</th><th scope="col">Matches</th><th scope="col">Win rate</th></tr>
                  </thead>
                  <tbody>
                    {p.topMaps.map((a) => (
                      <tr key={a.name}><th scope="row">{a.name}</th><td>{a.matches}</td><td><Val text={fmtPct(a.winRate)} /></td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="small">{p.disclaimer}</p>
            </section>
          )}
        </Query>
      </main>
      <Footer />
    </div>
  );
}
