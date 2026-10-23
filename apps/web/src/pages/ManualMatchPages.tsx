import { Link, useParams } from 'react-router-dom';
import { getManualMatch } from '../api/client';
import { useApi } from '../api/useApi';
import { ManualMatchForm } from '../components/ManualMatchForm';
import { Query } from '../components/States';

export function ManualMatchCreate() {
  return (
    <div className="page">
      <p>
        <Link to="/matches">← All matches</Link>
      </p>
      <h1>Add match</h1>
      <ManualMatchForm />
    </div>
  );
}

export function ManualMatchEdit() {
  const { matchId = '' } = useParams();
  const isManual = matchId.startsWith('manual-');
  const state = useApi(
    () => (isManual ? getManualMatch(matchId) : Promise.reject(new Error('Only manual entries can be edited.'))),
    [matchId],
  );
  return (
    <div className="page">
      <p>
        <Link to={`/matches/${encodeURIComponent(matchId)}`}>← Back to match</Link>
      </p>
      <h1>Edit manual entry</h1>
      <Query state={state}>{(m) => <ManualMatchForm initial={m} editId={matchId} />}</Query>
    </div>
  );
}
