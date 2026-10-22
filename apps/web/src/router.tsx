import { createBrowserRouter } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Overview } from './pages/Overview';
import { Agents, Maps } from './pages/Breakdown';
import { Insights } from './pages/Insights';
import { Matches } from './pages/Matches';
import { MatchDetail } from './pages/MatchDetail';
import { Settings } from './pages/Settings';
import { PublicProfile } from './pages/PublicProfile';

export const routes = [
  { path: '/p/:token', element: <PublicProfile /> },
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'agents', element: <Agents /> },
      { path: 'maps', element: <Maps /> },
      { path: 'insights', element: <Insights /> },
      { path: 'matches', element: <Matches /> },
      { path: 'matches/:matchId', element: <MatchDetail /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
