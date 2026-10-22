import { Line } from 'react-chartjs-2';
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import type { TrendPoint } from '@va/shared';
import { fmtDate } from '../format';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

interface Props {
  title: string;
  yLabel: string;
  points: TrendPoint[];
  /** formatter for table fallback + tooltips */
  format: (v: number | null) => string;
  /** multiply plotted values (e.g. 100 for percentages) */
  scale?: number;
}

export function TrendChart({ title, yLabel, points, format, scale = 1 }: Props) {
  const labels = points.map((p) => fmtDate(p.startedAt));
  const data = {
    labels,
    datasets: [
      {
        label: yLabel,
        data: points.map((p) => (p.value == null ? null : p.value * scale)),
        borderColor: '#5aa9e6',
        backgroundColor: '#5aa9e6',
        spanGaps: false,
        tension: 0.25,
        pointRadius: 2,
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: true, text: title, color: '#d6dbe6' },
    },
    scales: {
      x: { title: { display: true, text: 'Match date (end of window)', color: '#9aa3b5' }, ticks: { color: '#9aa3b5', maxTicksLimit: 8 } },
      y: { title: { display: true, text: yLabel, color: '#9aa3b5' }, ticks: { color: '#9aa3b5' } },
    },
  };
  return (
    <figure className="chart">
      <div className="chart-canvas">
        <Line data={data} options={options} role="img" aria-label={`${title}. Line chart; data table follows.`} />
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Match date</th>
            <th scope="col">{yLabel}</th>
            <th scope="col">Matches in window</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.matchId}>
              <td>{fmtDate(p.startedAt)}</td>
              <td>{format(p.value)}</td>
              <td>{p.sample}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
