import { Link, useParams } from 'react-router-dom';
import { getMatch } from '../api/client';
import { useApi } from '../api/useApi';
import { OUTCOME_WORD, fmtDateTime, fmtDuration, fmtNum, kdOf } from '../format';
import { Query } from '../components/States';
import { Val } from '../components/Val';

export function MatchDetail() {
  const { matchId = '' } = useParams();
  const state = useApi(() => getMatch(matchId), [matchId]);
  return (
    <div className="page">
      <p>
        <Link to="/matches">← All matches</Link>
      </p>
      <h1>Match detail</h1>
      <Query state={state}>
        {(d) => {
          const s = d.summary;
          return (
            <>
              <section className="card" aria-labelledby="ms">
                <h2 id="ms">
                  {s.mapName} · {s.agentName}
                </h2>
                <p>
                  {s.excluded ? (
                    <span className="badge badge-muted">Excluded from analysis: {s.excluded.replace(/_/g, ' ')}</span>
                  ) : (
                    <strong>{OUTCOME_WORD[s.outcome]}</strong>
                  )}{' '}
                  {s.roundsWon}–{s.roundsLost}
                </p>
                <dl className="facts">
                  <dt>Started</dt>
                  <dd>{fmtDateTime(s.startedAt)}</dd>
                  <dt>Duration</dt>
                  <dd><Val text={fmtDuration(d.durationMs)} /></dd>
                  <dt>Queue</dt>
                  <dd>{s.queueId}</dd>
                  <dt>Patch</dt>
                  <dd>{s.patch ?? '—'}</dd>
                  <dt>K/D/A</dt>
                  <dd>
                    {s.kills}/{s.deaths}/{s.assists}
                  </dd>
                  <dt>K/D</dt>
                  <dd><Val text={kdOf(s.kills, s.deaths)} /></dd>
                  <dt>ACS</dt>
                  <dd><Val text={fmtNum(s.acs)} /></dd>
                  <dt>ADR</dt>
                  <dd><Val text={fmtNum(s.adr)} /></dd>
                </dl>
              </section>

              <section>
                <h2>Team results</h2>
                <div className="table-wrap">
                  <table>
                    <caption>Team results</caption>
                    <thead>
                      <tr>
                        <th scope="col">Team</th>
                        <th scope="col">Rounds won</th>
                        <th scope="col">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.teams.map((t) => (
                        <tr key={t.teamId}>
                          <th scope="row">{t.isPlayerTeam ? 'Your team' : 'Opponents'}</th>
                          <td>{t.roundsWon}</td>
                          <td>{t.won ? 'Won' : 'Lost'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2>Rounds</h2>
                {d.rounds.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <caption>Round timeline (your own numbers)</caption>
                      <thead>
                        <tr>
                          <th scope="col">Round</th>
                          <th scope="col">Result</th>
                          <th scope="col">Outcome</th>
                          <th scope="col">Kills</th>
                          <th scope="col">Died</th>
                          <th scope="col">Damage</th>
                          <th scope="col">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.rounds.map((r) => {
                          const notes = [
                            r.firstKill && 'first kill',
                            r.firstDeath && 'first death',
                            r.planted && 'planted',
                            r.defused && 'defused',
                          ].filter(Boolean);
                          return (
                            <tr key={r.roundNumber}>
                              <th scope="row">{r.roundNumber}</th>
                              <td>{r.won ? 'Won' : 'Lost'}</td>
                              <td>{r.result}</td>
                              <td>{r.kills}</td>
                              <td>{r.died ? 'Yes' : 'No'}</td>
                              <td>{r.damage}</td>
                              <td>{notes.join(', ') || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="notice">Round-level data wasn't provided for this match.</p>
                )}
              </section>

              <section>
                <h2>Data sources</h2>
                <div className="table-wrap">
                  <table>
                    <caption>Where each field comes from</caption>
                    <thead>
                      <tr>
                        <th scope="col">Field</th>
                        <th scope="col">Source</th>
                        <th scope="col">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.fieldSources.map((f) => (
                        <tr key={f.field}>
                          <th scope="row">{f.field}</th>
                          <td>{f.source}</td>
                          <td>{f.note ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          );
        }}
      </Query>
    </div>
  );
}
