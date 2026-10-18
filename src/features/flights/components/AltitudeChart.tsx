import { useId, useMemo, useState, type PointerEvent } from "react";
import type { TrackPoint } from "../../../shared/types";
import { altitudeColor, formatAltitude } from "../../../shared/utils";
import { useUnits } from "../../../shared/units";
import { altitudeProfile, nearestProfileTime, PROFILE_WIDTH as width, PROFILE_HEIGHT as height, PROFILE_PAD as pad } from "../altitudeProfile";


const utcDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short" });
const utcTime = (seconds: number) => new Date(seconds * 1000).toISOString().slice(11, 19);
export function AltitudeChart({ points }: { points: TrackPoint[] }) {
  const units = useUnits();
  const fillId = useId();
  const [inspectedIndex, setInspectedIndex] = useState<number | null>(null);
  const chart = useMemo(() => altitudeProfile(points), [points]);
  const times = useMemo(() => chart?.points.map(point => point[0]) ?? [], [chart]);
  if (!chart) return null;
  const index = Math.min(inspectedIndex ?? chart.points.length - 1, chart.points.length - 1);
  const point = chart.coordinates[index];
  const label = point.altitude == null ? "No altitude" : formatAltitude(point.altitude);
  const readout = `${utcDay.format(point.time*1000)} ${utcTime(point.time)} UTC · Altitude ${label}`;
  const spansDays = new Date(chart.start * 1000).toISOString().slice(0, 10) !== new Date(chart.end * 1000).toISOString().slice(0, 10);
  const axisLabel = (time: number) => `${spansDays ? `${utcDay.format(time * 1000)} ` : ""}${utcTime(time).slice(0, 5)}`;
  const unitFactor = units === "aviation" ? 3.28084 : 1;
  const rawStep = (chart.scaleMax - chart.scaleMin) * unitFactor / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const tickStep = ([1, 2, 5, 10].find(step => step * magnitude >= rawStep) ?? 10) * magnitude;
  const firstTick = Math.ceil(chart.scaleMin * unitFactor / tickStep) * tickStep;
  const ticks = Array.from({ length: Math.floor((chart.scaleMax * unitFactor - firstTick) / tickStep) + 1 }, (_, i) => {
    const value = firstTick + i * tickStep;
    return { value, label: Math.abs(value) >= 1000 ? `${value / 1000}k` : String(value), y: height - pad - (value / unitFactor - chart.scaleMin) / (chart.scaleMax - chart.scaleMin) * (height - pad * 2) };
  });
  function inspectPointer(event: PointerEvent<SVGRectElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    setInspectedIndex(nearestProfileTime(times, chart!.start + ratio * (chart!.end - chart!.start)));
  }
  return <div className="altitude-profile">
    <div className="chart-summary"><div><span className="chart-series-key" />Altitude ({units === "aviation" ? "ft" : "m"}) <strong>{label}</strong></div><time dateTime={new Date(point.time * 1000).toISOString()}>{utcDay.format(point.time * 1000)} · {utcTime(point.time).slice(0,5)} UTC</time></div>
    <svg className="altitude-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Altitude from ${formatAltitude(chart.min)} to ${formatAltitude(chart.max)}`}>
      <title>Altitude observations over time. Use the point slider or touch the path to inspect.</title>
      <defs><linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".18" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
      {ticks.map(tick => <g key={tick.y} className="chart-grid"><line x1={pad} x2={width-pad} y1={tick.y} y2={tick.y} /><text x={pad-10} y={tick.y+6} textAnchor="end">{tick.label}</text></g>)}
      <path d={chart.area} fill={`url(#${fillId})`} />
      {chart.paths.map(path => <path key={path.color} d={path.d} fill="none" stroke="var(--accent)" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinecap="round" />)}
      {chart.coordinates.length <= 40 && chart.coordinates.map(sample => sample.altitude != null && <circle key={sample.index} className="altitude-sample" cx={sample.x} cy={sample.y} r="3" fill="var(--accent)" pointerEvents="none" />)}
      {inspectedIndex != null && <g className="altitude-hover" pointerEvents="none">
        <line className="altitude-hover-line" x1={point.x} x2={point.x} y1={pad} y2={height - pad} />
        {point.altitude != null && <circle className="altitude-hover-dot" cx={point.x} cy={point.y} r="4" fill={altitudeColor(point.altitude)} />}
      </g>}
      <rect className="altitude-hover-target" x={pad} y="0" width={width-pad*2} height={height} fill="transparent" onPointerMove={inspectPointer} onPointerDown={inspectPointer} />
    </svg>
    <div className="chart-time-axis">{[chart.start, (chart.start + chart.end) / 2, chart.end].map((time, i) => <time key={i} dateTime={new Date(time*1000).toISOString()}>{axisLabel(time)}</time>)}</div>
    <label className="chart-inspector"><span>Inspect track point</span><input type="range" min="0" max={chart.points.length-1} value={index} aria-label="Inspect altitude point" aria-valuetext={readout} onChange={event => setInspectedIndex(Number(event.target.value))} /></label>
    {inspectedIndex != null && <output className="altitude-hover-readout" aria-live="off" aria-label="Selected altitude observation">{readout}</output>}
  </div>;
}
