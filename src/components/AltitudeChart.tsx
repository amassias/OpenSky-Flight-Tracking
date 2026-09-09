import { useState, type PointerEvent } from "react";
import type { TrackPoint } from "../types";
import { altitudeColor, formatAltitude } from "../utils";
import { AltitudeLegend } from "./AltitudeLegend";

interface AltitudeChartProps {
  points: TrackPoint[];
}

export function AltitudeChart({ points }: AltitudeChartProps) {
  const values = points.map((point) => point[3]).filter((value): value is number => value != null && Number.isFinite(value));
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
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
  const hoveredPoint = hoveredIndex == null ? null : coordinates[hoveredIndex] ?? null;
  const hoveredAltitude = hoveredPoint?.altitude ?? null;
  const tooltipLabel = hoveredAltitude == null ? "No altitude" : formatAltitude(hoveredAltitude);
  const tooltipWidth = 100;
  const tooltipX = hoveredPoint ? Math.min(Math.max(hoveredPoint.x - tooltipWidth / 2, pad), width - pad - tooltipWidth) : 0;
  const tooltipY = hoveredPoint ? Math.max(hoveredPoint.y - 32, pad) : 0;

  function handlePointerMove(event: PointerEvent<SVGRectElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const relativeX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * width;
    const clampedX = Math.min(Math.max(relativeX, pad), width - pad);
    const ratio = (clampedX - pad) / (width - pad * 2);
    const index = Math.round(ratio * Math.max(points.length - 1, 1));
    setHoveredIndex(Math.max(0, Math.min(points.length - 1, index)));
  }

  return (
    <div className="altitude-profile">
      <svg className="altitude-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Altitude from ${Math.round(min)} to ${Math.round(max)} metres`}>
        <title>Hover the altitude path to inspect each point</title>
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
        {hoveredPoint && (
          <g className="altitude-hover" pointerEvents="none">
            <line className="altitude-hover-line" x1={hoveredPoint.x} x2={hoveredPoint.x} y1={pad} y2={height - pad} />
            <circle className="altitude-hover-dot" cx={hoveredPoint.x} cy={hoveredPoint.y} r="4" fill={altitudeColor(hoveredAltitude)} />
            <g className="altitude-tooltip" transform={`translate(${tooltipX} ${tooltipY})`}>
              <rect width={tooltipWidth} height="22" rx="5" />
              <text x={tooltipWidth / 2} y="14" textAnchor="middle">{tooltipLabel}</text>
            </g>
          </g>
        )}
        <rect
          className="altitude-hover-target"
          x={pad}
          y="0"
          width={width - pad * 2}
          height={height}
          fill="transparent"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoveredIndex(null)}
        />
      </svg>
      <span className="sr-only altitude-hover-readout" role="status" aria-live="polite">
        {hoveredPoint ? `Altitude ${tooltipLabel}` : "Hover the altitude path to inspect altitude."}
      </span>
      <AltitudeLegend className="chart-altitude-legend" />
    </div>
  );
}
