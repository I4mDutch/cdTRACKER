import { SCORE_DISCLAIMER, type ScoreResponse } from '@va/shared';
import { fmtNum, fmtPct } from '../format';
import { ManualInclude } from './States';

export function ScoreCard({ score }: { score: ScoreResponse }) {
  return (
    <section className={`card score-card ${score.available ? '' : 'muted'}`} aria-labelledby="score-heading">
      <h3 id="score-heading">Analyzer Score</h3>
      {score.available && score.score != null ? (
        <p className="big" data-testid="score-value">
          {score.score.toFixed(0)}
          <span className="unit"> / 100</span>
        </p>
      ) : (
        <p data-testid="score-unavailable">
          Not enough data yet.{' '}
          {score.reason ?? 'The Analyzer Score needs more matches with complete data before it can be shown.'}
        </p>
      )}
      <p className="small">{SCORE_DISCLAIMER}</p>
      <p className="small">
        Formula {score.formulaVersion} · coverage {fmtPct(score.coverage, 0)} · relative to your own history (
        {score.sampleMatches} of {score.historyMatches} matches)
        <ManualInclude sources={score.sources} />
      </p>
      <p className="small">Riot Performance Score: not available from the Riot API</p>
      <details>
        <summary>Component breakdown</summary>
        <table>
          <caption>Analyzer Score components</caption>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Weight → effective</th>
              <th scope="col">Normalized (0–100)</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {score.components.map((c) => (
              <tr key={c.key}>
                <th scope="row">{c.label}</th>
                <td>
                  {fmtPct(c.weight, 0)} → {fmtPct(c.effectiveWeight, 0)}
                </td>
                <td>{c.available && c.normalized != null ? fmtNum(c.normalized, 0) : 'unavailable'}</td>
                <td>{c.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
