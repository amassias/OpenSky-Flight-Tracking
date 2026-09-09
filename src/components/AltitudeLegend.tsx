import { ALTITUDE_COLOR_BANDS, ALTITUDE_UNKNOWN_COLOR } from "../utils";

interface AltitudeLegendProps {
  className?: string;
  compact?: boolean;
}

export function AltitudeLegend({ className = "", compact = false }: AltitudeLegendProps) {
  const label = `Altitude colour scale: ${ALTITUDE_COLOR_BANDS.map((band) => `${band.label}`).join(", ")}, unknown altitude in grey`;

  return (
    <div className={`altitude-legend ${compact ? "altitude-legend-compact" : ""} ${className}`.trim()} role="img" aria-label={label}>
      <span className="altitude-legend-title">Altitude</span>
      <div className="altitude-legend-items">
        {ALTITUDE_COLOR_BANDS.map((band) => (
          <span className="altitude-legend-item" key={band.label}>
            <i aria-hidden="true" style={{ backgroundColor: band.color }} />
            <span>{band.label}</span>
          </span>
        ))}
        <span className="altitude-legend-item">
          <i aria-hidden="true" style={{ backgroundColor: ALTITUDE_UNKNOWN_COLOR }} />
          <span>Unknown</span>
        </span>
      </div>
    </div>
  );
}
