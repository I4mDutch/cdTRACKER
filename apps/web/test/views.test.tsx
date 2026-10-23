import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RIOT_NOTICE, type BreakdownResponse, type Finding, type InsightsResponse, type ScoreResponse, type SummaryResponse } from '@va/shared';
import { Overview } from '../src/pages/Overview';
import { Agents } from '../src/pages/Breakdown';
import { MatchDetail } from '../src/pages/MatchDetail';
import { Insights } from '../src/pages/Insights';
import { Footer } from '../src/components/Footer';
import { mockFetch, renderAt, statLine, jsonResponse } from './helpers';

vi.mock('react-chartjs-2', () => ({
  Line: (props: { 'aria-label'?: string }) => <canvas data-testid="chart" aria-label={props['aria-label']} />,
}));

const summary: SummaryResponse = {
  filter: {},
  overall: statLine(),
  trends: [
    { metric: 'winRate', window: 5, points: [{ index: 0, matchId: 'm1', startedAt: '2026-01-01T00:00:00Z', value: 0.4, sample: 5 }, { index: 1, matchId: 'm2', startedAt: '2026-01-02T00:00:00Z', value: 0.6, sample: 5 }] },
    { metric: 'kd', window: 5, points: [{ index: 0, matchId: 'm1', startedAt: '2026-01-01T00:00:00Z', value: 1, sample: 5 }] },
  ],
  recent: [],
  range: { from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' },
  sources: { riot: 10, manual: 0 },
};
const noScore: ScoreResponse = {
  available: false, reason: 'Needs at least 20 matches.', score: null, formulaVersion: 'score-v1',
  components: [], coverage: 0, sampleMatches: 5, historyMatches: 5, relativeTo: 'own-history', window: { lastN: 20 }, sources: { riot: 5, manual: 0 },
};
const insights: InsightsResponse = { findings: [], analysisVersion: 'a1', generatedAt: '2026-01-03T00:00:00Z', dismissed: [], config: { minMatches: 5, minRounds: 100 }, sources: { riot: 5, manual: 0 } };

describe('Overview', () => {
  it('shows a muted explanation instead of a score value when unavailable', async () => {
    mockFetch({ 'GET /api/summary': summary, 'GET /api/score': noScore, 'GET /api/insights': insights });
    renderAt(<Overview />, '/');
    expect(await screen.findByTestId('score-unavailable')).toHaveTextContent('Needs at least 20 matches.');
    expect(screen.queryByTestId('score-value')).toBeNull();
    expect(screen.getByText(/Riot Performance Score: not available from the Riot API/)).toBeInTheDocument();
    expect(await screen.findAllByTestId('chart')).toHaveLength(2);
  });

  it('shows the score value with disclaimer when available', async () => {
    const score: ScoreResponse = { ...noScore, available: true, reason: null, score: 63.2, coverage: 0.8 };
    mockFetch({ 'GET /api/summary': summary, 'GET /api/score': score, 'GET /api/insights': insights });
    renderAt(<Overview />, '/');
    expect(await screen.findByTestId('score-value')).toHaveTextContent('63');
    expect(screen.getByText(/not Riot MMR/)).toBeInTheDocument();
  });

  it('shows the empty state with no matches', async () => {
    mockFetch({ 'GET /api/summary': { ...summary, overall: statLine({ matches: 0 }) }, 'GET /api/score': noScore, 'GET /api/insights': insights });
    renderAt(<Overview />, '/');
    expect(await screen.findByText('No matches for these filters')).toBeInTheDocument();
  });

  it('shows an error state', async () => {
    mockFetch({});
    renderAt(<Overview />, '/');
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  });
});

describe('Agents table', () => {
  const data: BreakdownResponse = {
    filter: {}, baseline: statLine({ matches: 30 }), lowSampleThreshold: 5, sources: { riot: 30, manual: 0 },
    rows: [
      { id: 'jett', name: 'Jett', stat: statLine({ matches: 20, winRate: 0.6, kd: 1.2 }), lowSample: false, winRateDelta: 0.1, kdDelta: 0.1 },
      { id: 'sage', name: 'Sage', stat: statLine({ matches: 3, winRate: 0.3, kd: 0.8 }), lowSample: true, winRateDelta: -0.2, kdDelta: -0.2 },
      { id: 'omen', name: 'Omen', stat: statLine({ matches: 7, winRate: 0.5, kd: 1.0 }), lowSample: false, winRateDelta: 0, kdDelta: 0 },
    ],
  };
  const names = () => screen.getAllByRole('rowheader').map((r) => r.textContent?.replace('Low sample', '').trim());

  it('sorts by header click and shows Low sample badge and signed delta', async () => {
    mockFetch({ 'GET /api/agents': data });
    renderAt(<Agents />, '/agents');
    await screen.findByRole('table');
    expect(names()).toEqual(['Jett', 'Omen', 'Sage']); // default: matches desc
    expect(screen.getByText('Low sample')).toBeInTheDocument();
    expect(screen.getByText('▲ +10.0 pp')).toBeInTheDocument();
    expect(screen.getByText('▼ −20.0 pp')).toBeInTheDocument();

    const header = () => screen.getByRole('columnheader', { name: /^Win rate/ });
    expect(header()).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(within(header()).getByRole('button'));
    expect(header()).toHaveAttribute('aria-sort', 'descending');
    expect(names()).toEqual(['Jett', 'Omen', 'Sage']);
    await userEvent.click(within(header()).getByRole('button'));
    expect(header()).toHaveAttribute('aria-sort', 'ascending');
    expect(names()).toEqual(['Sage', 'Omen', 'Jett']);
  });
});

describe('Match detail', () => {
  it('shows a notice and no round table when rounds are empty', async () => {
    mockFetch({
      'GET /api/matches/m1': {
        summary: { matchId: 'm1', startedAt: '2026-01-01T00:00:00Z', mapId: 'a', mapName: 'Ascent', queueId: 'competitive', patch: '9.01', agentId: 'jett', agentName: 'Jett', source: 'riot', outcome: 'win', roundsWon: 13, roundsLost: 9, kills: 20, deaths: 10, assists: 5, acs: 250, adr: null, excluded: null },
        durationMs: 1800000,
        teams: [{ teamId: 'Blue', isPlayerTeam: true, roundsWon: 13, won: true }, { teamId: 'Red', isPlayerTeam: false, roundsWon: 9, won: false }],
        rounds: [],
        manual: null,
        fieldSources: [{ field: 'adr', source: 'unavailable', note: 'no round data' }, { field: 'kills', source: 'riot' }],
      },
    });
    renderAt(<MatchDetail />, '/matches/m1', '/matches/:matchId');
    expect(await screen.findByText("Round-level data wasn't provided for this match.")).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /Round timeline/ })).toBeNull();
    expect(screen.getByRole('table', { name: /Where each field comes from/ })).toBeInTheDocument();
    expect(screen.getByText('unavailable')).toBeInTheDocument();
  });
});

describe('Insights', () => {
  const finding: Finding = {
    id: 'agent_win_rate:agent:sage', type: 'agent_win_rate', subject: { kind: 'agent', id: 'sage' }, metric: 'winRate',
    value: 0.3, baseline: 0.5, baselineLabel: 'your overall win rate in this window', direction: 'below',
    sampleMatches: 8, sampleRounds: 160, evidence: 'moderate', summary: 'Sage may be a possible focus area.',
    recommendation: 'Review two recent Sage matches.', method: 'Compared against overall win rate.', matchIds: ['m1'], analysisVersion: 'a1',
  };
  it('sends dismiss feedback', async () => {
    const fetchFn = mockFetch({
      'GET /api/insights': { ...insights, findings: [finding] },
      'POST /api/insights/feedback': () => jsonResponse(null, 204),
    });
    renderAt(<Insights />, '/insights');
    expect(await screen.findByText('Sage may be a possible focus area.', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText(/Evidence: moderate/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      const call = fetchFn.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ findingId: finding.id, action: 'dismiss' });
    });
  });
});

describe('Footer', () => {
  it('shows the Riot notice', () => {
    render(<Footer />);
    expect(screen.getByText(RIOT_NOTICE)).toBeInTheDocument();
  });
});
