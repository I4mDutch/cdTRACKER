import { Link } from 'react-router-dom';
import type { Finding, SummaryResponse, TrendPoint } from '@va/shared';
import { getInsights, getScore, getSummary } from '../api/client';
import { useApi } from '../api/useApi';
import { useFilter } from '../filters';
import { fmtKd, fmtPct, metricLabel, fmtMetric } from '../format';
import { Empty, MatchContext, Query } from '../components/States';
import { ScoreCard } from '../components/ScoreCard';
import { TrendChart } from '../components/TrendChart';
import { MatchTable } from '../components/MatchTable';
import { Val } from '../components/Val';

function trendDirection(points: TrendPoint[], flatBand: number): string {
  const vals = points.filter((p) => p.value != null).map((p) => p.value as number);
  if (vals.length < 2) return 'Not enough data';
  const delta = (vals[vals.length - 1] as number) - (vals[0] as number);
  if (Math.abs(delta) <= flatBand) return '■ Flat';
  return delta > 0 ? '▲ Up' : '▼ Down';
}

export function KeyFindings({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return <p className="small">No findings with enough evidence yet.</p>;
  return (
    <ul className="findings-brief">
      {findings.map((f) => (
        <li key={f.id}>
          <strong>{f.summary}</strong>
          <span className="small">
            {' '}
            {metricLabel(f.metric)}: {fmtMetric(f.metric, f.value)} vs {fmtMetric(f.metric, f.baseline)} (
            {f.baselineLabel}) · <span className="badge">Evidence: {f.evidence}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function OverviewBody({ s }: { s: SummaryResponse }) {
  const o = s.overall;
  const wr = s.trends.find((t) => t.metric === 'winRate');
  const kd = s.trends.find((t) => t.metric === 'kd');
  const interval = o.winRateInterval
    ? `95% interval: ${fmtPct(o.winRateInterval.low)} – ${fmtPct(o.winRateInterval.high)}`
    : 'Interval not available';
  return (
    <>
      <MatchContext matches={o.matches} from={s.range.from} to={s.range.to} sources={s.sources} />
      <div className="cards">
        <section className="card" aria-label="Matches analyzed">
          <h3>Matches analyzed</h3>
          <p className="big">{o.matches}</p>
          <p className="small">
            {o.wins}W · {o.losses}L · {o.draws}D
          </p>
        </section>
        <section className="card" aria-label="Win rate">
          <h3>Win rate</h3>
          <p className="big" title={interval}>
            <Val text={fmtPct(o.winRate)} />
          </p>
          <p className="small">{interval}</p>
        </section>
        <section className="card" aria-label="K/D">
          <h3>K/D</h3>
          <p className="big">
            <Val text={fmtKd(o.kd)} />
          </p>
          {o.zeroDeaths && <p className="small">No deaths in this window; K/D equals kills.</p>}
        </section>
        <section className="card" aria-label="Trend">
          <h3>Win rate trend</h3>
          <p className="big">{wr ? trendDirection(wr.points, 0.01) : 'Not enough data'}</p>
          <p className="small">First vs latest rolling value</p>
        </section>
      </div>
      <div className="charts">
        {wr && wr.points.length > 0 && (
          <TrendChart
            title={`Win rate, rolling ${wr.window}-match window`}
            yLabel="Win rate (%)"
            points={wr.points}
            scale={100}
            format={(v) => fmtPct(v)}
          />
        )}
        {kd && kd.points.length > 0 && (
          <TrendChart
            title={`K/D, rolling ${kd.window}-match window`}
            yLabel="K/D"
            points={kd.points}
            format={(v) => fmtKd(v)}
          />
        )}
      </div>
      <section>
        <h2>Recent matches</h2>
        <MatchTable rows={s.recent} caption="Recent matches" />
        <p>
          <Link to="/matches">All matches</Link>
        </p>
      </section>
    </>
  );
}

export function Overview() {
  const { filter, filterKey } = useFilter();
  const summary = useApi(() => getSummary(filter), [filterKey]);
  const insights = useApi(() => getInsights(filter), [filterKey]);
  const score = useApi(() => getScore(filter), [filterKey]);

  return (
    <div className="page">
      <h1>Overview</h1>
      <Query state={summary}>
        {(s) =>
          s.overall.matches === 0 ? (
            <>
              <MatchContext matches={0} from={s.range.from} to={s.range.to} sources={s.sources} />
              <Empty />
            </>
          ) : (
            <OverviewBody s={s} />
          )
        }
      </Query>
      <div className="two-col">
        <Query state={score}>{(sc) => <ScoreCard score={sc} />}</Query>
        <section className="card" aria-labelledby="kf">
          <h3 id="kf">Key findings</h3>
          <Query state={insights}>
            {(i) => (
              <>
                <KeyFindings findings={i.findings.filter((f) => !i.dismissed.includes(f.id)).slice(0, 3)} />
                <p>
                  <Link to="/insights">All insights</Link>
                </p>
              </>
            )}
          </Query>
        </section>
      </div>
    </div>
  );
}
