import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Finding, InsightFeedbackRequest, InsightsResponse } from '@va/shared';
import { getInsights, sendInsightFeedback } from '../api/client';
import { useApi } from '../api/useApi';
import { useFilter } from '../filters';
import { fmtMetric, metricLabel } from '../format';
import { Empty, ErrorState, Query } from '../components/States';

function FindingCard({
  f,
  data,
  dismissed,
  onFeedback,
}: {
  f: Finding;
  data: InsightsResponse;
  dismissed: boolean;
  onFeedback: (id: string, action: InsightFeedbackRequest['action']) => void;
}) {
  const [sent, setSent] = useState<string | null>(null);
  return (
    <article className="card finding" aria-label={f.summary}>
      <h3>{f.summary}</h3>
      <p>
        <strong>Suggestion:</strong> {f.recommendation}
      </p>
      <p className="small">
        {metricLabel(f.metric)}: {fmtMetric(f.metric, f.value)} vs {fmtMetric(f.metric, f.baseline)} (
        {f.baselineLabel}) · {f.sampleMatches} matches, {f.sampleRounds} rounds ·{' '}
        <span className="badge">Evidence: {f.evidence}</span>
      </p>
      <details>
        <summary>How was this generated?</summary>
        <p>{f.method}</p>
        <p className="small">
          Analysis version {f.analysisVersion}. Requires at least {data.config.minMatches} matches and{' '}
          {data.config.minRounds} rounds.
        </p>
        {f.matchIds.length > 0 && (
          <>
            <p className="small">Contributing matches:</p>
            <ul className="inline-list">
              {f.matchIds.slice(0, 20).map((id, i) => (
                <li key={id}>
                  <Link to={`/matches/${encodeURIComponent(id)}`}>Match {i + 1}</Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
      <div className="actions">
        {!dismissed && (
          <button type="button" className="secondary" onClick={() => onFeedback(f.id, 'dismiss')}>
            Dismiss
          </button>
        )}
        <button type="button" className="secondary" onClick={() => { setSent('not_useful'); onFeedback(f.id, 'not_useful'); }}>
          Not useful
        </button>
        <button type="button" className="secondary" onClick={() => { setSent('useful'); onFeedback(f.id, 'useful'); }}>
          Useful
        </button>
        {sent && <span className="small" role="status">Thanks for the feedback.</span>}
      </div>
    </article>
  );
}

export function Insights() {
  const { filter, filterKey } = useFilter();
  const state = useApi(() => getInsights(filter), [filterKey]);
  const [fbError, setFbError] = useState<string | null>(null);

  const feedback = (findingId: string, action: InsightFeedbackRequest['action']) => {
    setFbError(null);
    sendInsightFeedback({ findingId, action }).then(
      () => {
        if (action === 'dismiss') state.reload();
      },
      (e: Error) => setFbError(e.message),
    );
  };

  return (
    <div className="page">
      <h1>Insights</h1>
      <p className="small">
        These are observations about patterns in your own matches, not causes. Low-evidence items are worth reviewing,
        not conclusions.
      </p>
      {fbError && <ErrorState error={{ message: fbError }} />}
      <Query state={state}>
        {(d) => {
          const active = d.findings.filter((f) => !d.dismissed.includes(f.id));
          const dismissed = d.findings.filter((f) => d.dismissed.includes(f.id));
          return (
            <>
              <p className="context">
                Analysis {d.analysisVersion} · generated {d.generatedAt.slice(0, 10)}
              </p>
              {active.length === 0 ? (
                <Empty>No insights with enough evidence for these filters yet.</Empty>
              ) : (
                active.map((f) => <FindingCard key={f.id} f={f} data={d} dismissed={false} onFeedback={feedback} />)
              )}
              {dismissed.length > 0 && (
                <details className="dismissed">
                  <summary>Dismissed ({dismissed.length})</summary>
                  {dismissed.map((f) => (
                    <FindingCard key={f.id} f={f} data={d} dismissed onFeedback={feedback} />
                  ))}
                </details>
              )}
            </>
          );
        }}
      </Query>
    </div>
  );
}
