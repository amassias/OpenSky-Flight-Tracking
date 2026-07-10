import type { TrackPoint } from "../types";

interface AltitudeChartProps {
  points: TrackPoint[];
}

export function AltitudeChart({ points }: AltitudeChartProps) {
  const values = points.map((point) => point[3]).filter((value): value is number => value != null);
  if (values.length < 2) return <div className="chart-empty">No altitude profile available</div>;

  const width = 620;
  const height = 150;
  const pad = 10;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coordinates = points.map((point, index) => {
    const altitude = point[3] ?? min;
    const x = pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - ((altitude - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const area = `${pad},${height - pad} ${coordinates} ${width - pad},${height - pad}`;

  return (
    <svg className="altitude-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Altitude from ${Math.round(min)} to ${Math.round(max)} metres`}>
      <defs>
        <linearGradient id="altitude-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#82f4ca" stopOpacity=".38" />
          <stop offset="100%" stopColor="#82f4ca" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#altitude-fill)" />
      <polyline points={coordinates} fill="none" stroke="#82f4ca" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}
