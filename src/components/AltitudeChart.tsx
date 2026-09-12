import { useMemo, useState, type PointerEvent } from "react";
import type { TrackPoint } from "../types";
import { altitudeColor, extent, formatAltitude } from "../utils";
import { AltitudeLegend } from "./AltitudeLegend";

interface AltitudeChartProps {
  points: TrackPoint[];
}

const WIDTH = 620;
const HEIGHT = 150;
const PAD = 10;

export function AltitudeChart({ points }: AltitudeChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Recomputed only when the track changes, not on every pointer move.
  const chart = useMemo(() => {
    const values = points
      .map((point) => point[3])
      .filter((value): value is number => value != null && Number.isFinite(value));
    if (values.length < 2) return null;

    const { min, max } = extent(values);
    const range = max - min || 1;
    const lastIndex = Math.max(points.length - 1, 1);
    const coordinates = points.map((point, index) => {
      const raw = point[3];
      const known = raw != null && Number.isFinite(raw) ? raw : null;
      const altitude = known ?? min;
      return {
        x: PAD + (index / lastIndex) * (WIDTH - PAD * 2),
        y: HEIGHT - PAD - ((altitude - min) / range) * (HEIGHT - PAD * 2),
        altitude: known,
      };
    });
    const coordinatePoints = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
    return {
      min,
      max,
      coordinates,
      area: `${PAD},${HEIGHT - PAD} ${coordinatePoints} ${WIDTH - PAD},${HEIGHT - PAD}`,
    };
  }, [points]);

  // The path is thousands of elements on a long track; keeping it out of the
  // hover render keeps pointer tracking smooth.
  const segments = useMemo(() => {
    if (!chart) return null;
    return chart.coordinates.slice(1).map((point, index) => {
      const previous = chart.coordinates[index];
      const averageAltitude = previous.altitude != null && point.altitude != null
        ? (previous.altitude + point.altitude) / 2
        : previous.altitude ?? point.altitude;
      return (
        <polyline
          key={index}
          points={`${previous.x},${previous.y} ${point.x},${point.y}`}
          fill="none"
          stroke={altitudeColor(averageAltitude)}
          strokeWidth="3"
          strokeLinecap="round"
        />
      );
    });
  }, [chart]);

  if (!chart) return <div className="chart-empty">No altitude profile available</div>;

  const { min, max, coordinates, area } = chart;
  const width = WIDTH;
  const height = HEIGHT;
  const pad = PAD;
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
      <svg className="altitude-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Altitude from ${formatAltitude(min)} to ${formatAltitude(max)}`}>
        <title>Hover the altitude path to inspect each point</title>
        <defs>
          <linearGradient id="altitude-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#82f4ca" stopOpacity=".38" />
            <stop offset="100%" stopColor="#82f4ca" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#altitude-fill)" />
        {segments}
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
