import type { TrackPoint } from "../types";
import { altitudeColor } from "../utils";
import { AltitudeLegend } from "./AltitudeLegend";

interface AltitudeChartProps {
  points: TrackPoint[];
}

export function AltitudeChart({ points }: AltitudeChartProps) {
  const values = points.map((point) => point[3]).filter((value): value is number => value != null && Number.isFinite(value));
  if (values.length < 2) return <div className="chart-empty">No altitude profile available</div>;

  const width = 620;
  const height = 150;
  const pad = 10;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coordinates = points.map((point, index) => {
    const altitude = point[3] != null && Number.isFinite(point[3]) ? point[3] : min;
    const x = pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - ((altitude - min) / range) * (height - pad * 2);
    return { x, y, altitude: point[3] != null && Number.isFinite(point[3]) ? point[3] : null };
  });
  const coordinatePoints = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${pad},${height - pad} ${coordinatePoints} ${width - pad},${height - pad}`;

  return (
    <div className="altitude-profile">
      <svg className="altitude-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Altitude from ${Math.round(min)} to ${Math.round(max)} metres`}>
        <defs>
          <linearGradient id="altitude-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#82f4ca" stopOpacity=".38" />
            <stop offset="100%" stopColor="#82f4ca" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#altitude-fill)" />
        {coordinates.slice(1).map((point, index) => {
          const previous = coordinates[index];
          const averageAltitude = previous.altitude != null && point.altitude != null
            ? (previous.altitude + point.altitude) / 2
            : previous.altitude ?? point.altitude;
          return <polyline key={`${point.x}-${point.y}`} points={`${previous.x},${previous.y} ${point.x},${point.y}`} fill="none" stroke={altitudeColor(averageAltitude)} strokeWidth="3" strokeLinecap="round" />;
        })}
      </svg>
      <AltitudeLegend className="chart-altitude-legend" />
    </div>
  );
}
