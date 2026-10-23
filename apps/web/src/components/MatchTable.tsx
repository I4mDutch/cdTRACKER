import { Link } from 'react-router-dom';
import type { MatchSummaryDto } from '@va/shared';
import { MANUAL_TITLE, OUTCOME_LABEL, OUTCOME_WORD, fmtDate, fmtNum, kdOf } from '../format';
import { Val } from './Val';

export function MatchTable({ rows, caption }: { rows: MatchSummaryDto[]; caption: string }) {
  return (
    <div className="table-wrap">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Map</th>
            <th scope="col">Agent</th>
            <th scope="col">Result</th>
            <th scope="col">Score</th>
            <th scope="col">K/D/A</th>
            <th scope="col">K/D</th>
            <th scope="col">ACS</th>
            <th scope="col">ADR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.matchId}>
              <td>
                <Link to={`/matches/${encodeURIComponent(m.matchId)}`}>{fmtDate(m.startedAt)}</Link>
                {m.source === 'manual' && (
                  <>
                    {' '}
                    <span className="badge badge-manual" title={MANUAL_TITLE}>
                      Manual
                    </span>
                  </>
                )}
              </td>
              <td>{m.mapName}</td>
              <td>{m.agentName}</td>
              <td>
                {m.excluded ? (
                  <span className="badge badge-muted">Excluded: {m.excluded.replace(/_/g, ' ')}</span>
                ) : (
                  <span title={OUTCOME_WORD[m.outcome]}>{OUTCOME_LABEL[m.outcome]}</span>
                )}
              </td>
              <td>
                {m.roundsWon}–{m.roundsLost}
              </td>
              <td>
                {m.kills}/{m.deaths}/{m.assists}
              </td>
              <td>
                <Val text={kdOf(m.kills, m.deaths)} />
              </td>
              <td>
                <Val text={fmtNum(m.acs)} />
              </td>
              <td>
                <Val text={fmtNum(m.adr)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
