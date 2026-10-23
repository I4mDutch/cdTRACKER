import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MANUAL_LIMITS, type ImportResponse, type ManualMatchDto, type MatchDetailDto, type MatchSummaryDto, type SummaryResponse } from '@va/shared';
import { ManualMatchCreate, ManualMatchEdit } from '../src/pages/ManualMatchPages';
import { ImportPage } from '../src/pages/Import';
import { MatchTable } from '../src/components/MatchTable';
import { MatchDetail } from '../src/pages/MatchDetail';
import { Overview } from '../src/pages/Overview';
import { FilterBar } from '../src/components/FilterBar';
import { jsonResponse, mockFetch, renderAt, statLine } from './helpers';

vi.mock('react-chartjs-2', () => ({
  Line: () => <canvas data-testid="chart" />,
}));

const OPTIONS = {
  agents: [], maps: [], queues: [], patches: [],
  catalog: {
    agents: [{ id: 'jett', name: 'Jett' }, { id: 'sage', name: 'Sage' }],
    maps: [{ id: '/Game/Maps/Ascent/Ascent', name: 'Ascent' }, { id: '/Game/Maps/Bind/Bind', name: 'Bind' }],
  },
};

const DTO: ManualMatchDto = {
  id: 'manual-abc', startedAt: '2026-03-04T12:00:00.000Z', mapId: '/Game/Maps/Bind/Bind', agentId: 'sage', queueId: 'unrated',
  patch: '9.05', roundsWon: 13, roundsLost: 7, kills: 18, deaths: 12, assists: 4, acs: 240, adr: null, firstKills: null,
  firstDeaths: null, note: 'late night', outcome: 'win', excluded: null, createdAt: '2026-03-05T10:00:00.000Z', updatedAt: '2026-03-05T10:00:00.000Z',
};

function Where() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname + l.search}</div>;
}

function renderApp(ui: React.ReactElement, path: string, routePath: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={ui} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>, over: Record<string, string> = {}) {
  await user.selectOptions(await screen.findByLabelText('Map'), '/Game/Maps/Ascent/Ascent');
  await user.selectOptions(screen.getByLabelText('Agent'), 'jett');
  const vals: Record<string, string> = { 'Rounds won': '13', 'Rounds lost': '9', Kills: '20', Deaths: '10', Assists: '5', ...over };
  for (const [label, v] of Object.entries(vals)) await user.type(screen.getByLabelText(label), v);
}

describe('Manual match form', () => {
  it('blocks out-of-range values with inline errors and no request', async () => {
    const fetchFn = mockFetch({ 'GET /api/filters/options': OPTIONS });
    const user = userEvent.setup();
    renderApp(<ManualMatchCreate />, '/matches/new', '/matches/new');
    await fillRequired(user, { Kills: '151', 'Rounds won': '0', 'Rounds lost': '0' });
    await user.click(screen.getByRole('button', { name: 'Add match' }));
    const kills = screen.getByLabelText('Kills');
    expect(kills).toHaveAttribute('aria-invalid', 'true');
    expect(kills.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText(`Kills must be between 0 and ${MANUAL_LIMITS.maxKda}.`)).toBeInTheDocument();
    expect(screen.getByText(/add up to at least 1/)).toBeInTheDocument();
    expect(fetchFn.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('rejects first kills + first deaths above total rounds', async () => {
    mockFetch({ 'GET /api/filters/options': OPTIONS });
    const user = userEvent.setup();
    renderApp(<ManualMatchCreate />, '/matches/new', '/matches/new');
    await fillRequired(user, { 'Rounds won': '1', 'Rounds lost': '1' });
    await user.type(screen.getByLabelText('First kills'), '2');
    await user.type(screen.getByLabelText('First deaths'), '1');
    await user.click(screen.getByRole('button', { name: 'Add match' }));
    expect(screen.getByText(/can’t exceed the total rounds \(2\)/)).toBeInTheDocument();
  });

  it('shows the derived result live and explains blanks', async () => {
    mockFetch({ 'GET /api/filters/options': OPTIONS });
    const user = userEvent.setup();
    renderApp(<ManualMatchCreate />, '/matches/new', '/matches/new');
    await user.type(await screen.findByLabelText('Rounds won'), '13');
    await user.type(screen.getByLabelText('Rounds lost'), '9');
    expect(screen.getByTestId('derived-result')).toHaveTextContent('Result: Win 13–9');
    await user.clear(screen.getByLabelText('Rounds won'));
    await user.type(screen.getByLabelText('Rounds won'), '9');
    expect(screen.getByTestId('derived-result')).toHaveTextContent('Result: Draw 9–9');
    expect(screen.getByText(/blanks are treated as unavailable, not zero/)).toBeInTheDocument();
  });

  it('posts a date-only body with blanks omitted and navigates to the detail', async () => {
    const fetchFn = mockFetch({
      'GET /api/filters/options': OPTIONS,
      'POST /api/manual-matches': () => jsonResponse(DTO, 201),
    });
    const user = userEvent.setup();
    renderApp(<ManualMatchCreate />, '/matches/new', '/matches/new');
    await fillRequired(user);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-03-04' } });
    await user.click(screen.getByRole('button', { name: 'Add match' }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/matches/manual-abc'));
    const call = fetchFn.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      date: '2026-03-04', mapId: '/Game/Maps/Ascent/Ascent', agentId: 'jett', queueId: 'competitive',
      roundsWon: 13, roundsLost: 9, kills: 20, deaths: 10, assists: 5,
    });
  });

  it('shows the duplicate message on 409', async () => {
    mockFetch({
      'GET /api/filters/options': OPTIONS,
      'POST /api/manual-matches': () => jsonResponse({ error: { code: 'duplicate', message: 'dup' } }, 409),
    });
    const user = userEvent.setup();
    renderApp(<ManualMatchCreate />, '/matches/new', '/matches/new');
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Add match' }));
    expect(await screen.findByText('An identical entry already exists.')).toBeInTheDocument();
  });

  it('warns when the game catalog is empty', async () => {
    mockFetch({ 'GET /api/filters/options': { ...OPTIONS, catalog: { agents: [], maps: [] } } });
    renderApp(<ManualMatchCreate />, '/matches/new', '/matches/new');
    expect(await screen.findByText(/Game content .* hasn’t loaded yet/)).toBeInTheDocument();
  });

  it('edit page loads existing values and PUTs changes', async () => {
    const fetchFn = mockFetch({
      'GET /api/filters/options': OPTIONS,
      'GET /api/manual-matches/manual-abc': DTO,
      'PUT /api/manual-matches/manual-abc': () => jsonResponse(DTO),
    });
    const user = userEvent.setup();
    renderApp(<ManualMatchEdit />, '/matches/manual-abc/edit', '/matches/:matchId/edit');
    expect(await screen.findByLabelText('Kills')).toHaveValue('18');
    expect(screen.getByLabelText('Map')).toHaveValue('/Game/Maps/Bind/Bind');
    expect(screen.getByLabelText('Agent')).toHaveValue('sage');
    expect(screen.getByLabelText('Note')).toHaveValue('late night');
    expect(screen.getByLabelText('ADR')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/matches/manual-abc'));
    const call = fetchFn.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toMatchObject({ date: '2026-03-04', agentId: 'sage', acs: 240, note: 'late night', patch: '9.05' });
    expect(body).not.toHaveProperty('adr');
  });
});

const importResp = (over: Partial<ImportResponse> = {}): ImportResponse => ({
  dryRun: true,
  rows: [
    { line: 2, status: 'valid', errors: [], parsed: { date: '2026-03-04', mapId: '/Game/Maps/Ascent/Ascent', agentId: 'jett', queueId: 'competitive', roundsWon: 13, roundsLost: 9, kills: 20, deaths: 10, assists: 5 } },
    { line: 3, status: 'duplicate', errors: [], parsed: { date: '2026-03-03', mapId: '/Game/Maps/Bind/Bind', agentId: 'sage', queueId: 'competitive', roundsWon: 13, roundsLost: 1, kills: 1, deaths: 1, assists: 1 } },
  ],
  counts: { valid: 1, invalid: 0, duplicate: 1 },
  imported: 0,
  ...over,
});

const csvFile = (text = 'date,map\n') => new File([text], 'matches.csv', { type: 'text/csv' });

describe('CSV import page', () => {
  it('renders the dry-run preview with text status badges and enables import', async () => {
    mockFetch({ 'GET /api/filters/options': OPTIONS, 'POST /api/manual-matches/import': () => jsonResponse(importResp()) });
    renderApp(<ImportPage />, '/import', '/import');
    expect(screen.getByRole('link', { name: 'Download template' })).toHaveAttribute('href', '/api/manual-matches/template.csv');
    expect(screen.getByRole('table', { name: /CSV columns/ })).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('CSV file'), csvFile());
    const table = await screen.findByRole('table', { name: 'Import preview' });
    expect(within(table).getByText('Valid')).toBeInTheDocument();
    expect(within(table).getByText('Duplicate')).toBeInTheDocument();
    expect(screen.getByText(/Duplicates already exist and will be skipped/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Import 1 match' })).toBeEnabled();
  });

  it('disables import while any row is invalid and lists the errors', async () => {
    const bad = importResp({
      rows: [{ line: 2, status: 'invalid', errors: ['kills: must be a whole number between 0 and 150'], parsed: null }],
      counts: { valid: 0, invalid: 1, duplicate: 0 },
    });
    mockFetch({ 'GET /api/filters/options': OPTIONS, 'POST /api/manual-matches/import': () => jsonResponse(bad) });
    renderApp(<ImportPage />, '/import', '/import');
    await userEvent.upload(screen.getByLabelText('CSV file'), csvFile());
    expect(await screen.findByText('Invalid')).toBeInTheDocument();
    expect(screen.getByText('kills: must be a whole number between 0 and 150')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Import/ })).toBeDisabled();
  });

  it('sends dryRun:false on confirm and links to manual matches', async () => {
    const fetchFn = mockFetch({
      'GET /api/filters/options': OPTIONS,
      'POST /api/manual-matches/import': (init?: RequestInit) => {
        const body = JSON.parse(init?.body as string) as { dryRun: boolean };
        return jsonResponse(body.dryRun ? importResp() : importResp({ dryRun: false, imported: 1 }));
      },
    });
    renderApp(<ImportPage />, '/import', '/import');
    await userEvent.upload(screen.getByLabelText('CSV file'), csvFile('date,map\n2026-03-04,Ascent\n'));
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1 match' }));
    expect(await screen.findByText(/Imported 1 match\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View manual entries/ })).toHaveAttribute('href', '/matches?source=manual');
    const bodies = fetchFn.mock.calls
      .filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')
      .map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies).toEqual([
      { csv: 'date,map\n2026-03-04,Ascent\n', dryRun: true },
      { csv: 'date,map\n2026-03-04,Ascent\n', dryRun: false },
    ]);
  });

  it('rejects oversize files client-side', async () => {
    const fetchFn = mockFetch({ 'GET /api/filters/options': OPTIONS });
    renderApp(<ImportPage />, '/import', '/import');
    const big = csvFile('x');
    Object.defineProperty(big, 'size', { value: MANUAL_LIMITS.importMaxBytes + 1 });
    await userEvent.upload(screen.getByLabelText('CSV file'), big);
    expect(await screen.findByRole('alert')).toHaveTextContent(/too large/);
    expect(fetchFn.mock.calls.some((c) => String(c[0]).includes('/import'))).toBe(false);
  });
});

const summaryRow = (over: Partial<MatchSummaryDto> = {}): MatchSummaryDto => ({
  matchId: 'm1', source: 'riot', startedAt: '2026-01-01T00:00:00Z', mapId: 'a', mapName: 'Ascent', queueId: 'competitive', patch: null,
  agentId: 'jett', agentName: 'Jett', outcome: 'win', roundsWon: 13, roundsLost: 9, kills: 1, deaths: 1, assists: 1, acs: null, adr: null, excluded: null,
  ...over,
});

describe('Manual labelling', () => {
  it('shows a Manual badge only on manual rows', () => {
    render(
      <MemoryRouter>
        <MatchTable rows={[summaryRow(), summaryRow({ matchId: 'manual-1', source: 'manual' })]} caption="c" />
      </MemoryRouter>,
    );
    const badges = screen.getAllByText('Manual');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveAttribute('title', 'Entered manually — not from Riot');
  });

  const detail = (): MatchDetailDto => ({
    summary: summaryRow({ matchId: 'manual-1', source: 'manual' }),
    durationMs: null,
    teams: [{ teamId: 'Blue', isPlayerTeam: true, roundsWon: 13, won: true }, { teamId: 'Red', isPlayerTeam: false, roundsWon: 9, won: false }],
    rounds: [],
    fieldSources: [{ field: 'kills', source: 'manual' }],
    manual: { note: 'my note', createdAt: '2026-03-05T10:00:00Z', updatedAt: '2026-03-06T10:00:00Z' },
  });

  it('shows the manual banner with edit and a confirmed delete', async () => {
    const fetchFn = mockFetch({
      'GET /api/matches/manual-1': detail(),
      'DELETE /api/manual-matches/manual-1': () => jsonResponse(null, 204),
    });
    const user = userEvent.setup();
    renderApp(<MatchDetail />, '/matches/manual-1', '/matches/:matchId');
    expect(await screen.findByText('Manual entry — entered by you, not from Riot')).toBeInTheDocument();
    expect(screen.getByText('Note: my note')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/matches/manual-1/edit');
    expect(screen.getByText("Round-level data isn't available for manual entries.")).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Manual entry' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(fetchFn.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, delete entry' }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/matches'));
  });

  it('does not show a manual banner for Riot matches', async () => {
    mockFetch({ 'GET /api/matches/m1': { ...detail(), summary: summaryRow(), manual: null } });
    renderAt(<MatchDetail />, '/matches/m1', '/matches/:matchId');
    await screen.findByText('Team results', { selector: 'h2' });
    expect(screen.queryByText(/Manual entry —/)).toBeNull();
  });

  it('says "includes N manual entries" on the overview only when there are some', async () => {
    const summary: SummaryResponse = {
      filter: {}, overall: statLine(), trends: [], recent: [], range: { from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' },
      sources: { riot: 8, manual: 2 },
    };
    const score = { available: false, reason: 'x', score: null, formulaVersion: 'v1', components: [], coverage: 0, sampleMatches: 1, historyMatches: 1, relativeTo: 'own-history', window: { lastN: 20 }, sources: { riot: 8, manual: 2 } };
    const insights = { findings: [], analysisVersion: 'a', generatedAt: '2026-01-03T00:00:00Z', dismissed: [], config: { minMatches: 5, minRounds: 100 }, sources: { riot: 8, manual: 2 } };
    mockFetch({ 'GET /api/summary': summary, 'GET /api/score': score, 'GET /api/insights': insights });
    renderAt(<Overview />, '/');
    const notes = await screen.findAllByText(/includes 2 manual entries/);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toHaveAttribute('title', 'Entered manually — not from Riot');
  });

  it('writes the Source filter to the URL', async () => {
    mockFetch({ 'GET /api/filters/options': OPTIONS });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/matches']}>
        <Routes>
          <Route path="*" element={<><FilterBar /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.selectOptions(screen.getByLabelText('Source'), 'manual');
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/matches?source=manual'));
  });
});
