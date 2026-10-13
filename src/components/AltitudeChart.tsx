import { useId, useMemo, useState, type PointerEvent } from "react";
import type { TrackPoint } from "../types";
import { altitudeColor, formatAltitude } from "../utils";
import { useUnits } from "../units";
import { altitudeProfile, nearestProfileTime, PROFILE_WIDTH as width, PROFILE_HEIGHT as height, PROFILE_PAD as pad } from "../altitudeProfile";
import { AltitudeLegend } from "./AltitudeLegend";

const utcDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short" });
const utcTime = (seconds: number) => new Date(seconds * 1000).toISOString().slice(11, 19);
export function AltitudeChart({ points }: { points: TrackPoint[] }) {
  useUnits();
  const fillId = useId();
  const [inspectedIndex, setInspectedIndex] = useState<number | null>(null);
  const chart = useMemo(() => altitudeProfile(points), [points]);
  const times = useMemo(() => chart?.points.map(point => point[0]) ?? [], [chart]);
  if (!chart) return <div className="chart-empty">No altitude profile available</div>;
  const index = Math.min(inspectedIndex ?? chart.points.length - 1, chart.points.length - 1);
  const point = chart.coordinates[index];
  const label = point.altitude == null ? "No altitude" : formatAltitude(point.altitude);
  const readout = `${utcDay.format(point.time*1000)} ${utcTime(point.time)} UTC · Altitude ${label}`;
  const tooltipX = Math.min(Math.max(point.x - 50, pad), width - pad - 100);
  const tooltipY = Math.max(point.y - 32, pad);
  function inspectPointer(event: PointerEvent<SVGRectElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    setInspectedIndex(nearestProfileTime(times, chart!.start + ratio * (chart!.end - chart!.start)));
  }
  return <div className="altitude-profile">
    <div className="chart-scale"><span>{formatAltitude(chart.min)} – {formatAltitude(chart.max)}</span><span>Time · UTC</span></div>
    <svg className="altitude-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Altitude from ${formatAltitude(chart.min)} to ${formatAltitude(chart.max)}`}>
      <title>Altitude observations over time. Use the point slider or touch the path to inspect.</title>
      <defs><linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".18" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
      <path d={chart.area} fill={`url(#${fillId})`} />
      {chart.paths.map(path => <path key={path.color} d={path.d} fill="none" stroke={path.color} strokeWidth="3" strokeLinecap="round" />)}
      {inspectedIndex != null && <g className="altitude-hover" pointerEvents="none">
        <line className="altitude-hover-line" x1={point.x} x2={point.x} y1={pad} y2={height - pad} />
        {point.altitude != null && <circle className="altitude-hover-dot" cx={point.x} cy={point.y} r="4" fill={altitudeColor(point.altitude)} />}
        <g className="altitude-tooltip" transform={`translate(${tooltipX} ${tooltipY})`}><rect width="100" height="22" rx="5" /><text x="50" y="14" textAnchor="middle">{label}</text></g>
      </g>}
      <rect className="altitude-hover-target" x={pad} y="0" width={width-pad*2} height={height} fill="transparent" onPointerMove={inspectPointer} onPointerDown={inspectPointer} />
    </svg>
    <div className="chart-time-axis"><time dateTime={new Date(chart.start*1000).toISOString()}>{utcDay.format(chart.start*1000)} {utcTime(chart.start)}</time><time dateTime={new Date(chart.end*1000).toISOString()}>{utcDay.format(chart.end*1000)} {utcTime(chart.end)}</time></div>
    <label className="chart-inspector"><span>Inspect track point</span><input type="range" min="0" max={chart.points.length-1} value={index} aria-label="Inspect altitude point" aria-valuetext={readout} onChange={event => setInspectedIndex(Number(event.target.value))} /></label>
    <output className="altitude-hover-readout" aria-live="off" aria-label="Selected altitude observation">{readout}</output>
    <AltitudeLegend className="chart-altitude-legend" />
  </div>;
}
