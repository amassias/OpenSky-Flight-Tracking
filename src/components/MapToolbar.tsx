import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Filter, Gauge } from "./icons";
import { ALTITUDE_FILTER_MAX_FT, NO_FILTERS, activeFilterCount, type MapFilters } from "../mapFilters";
import { setUnits, useUnits, type UnitSystem } from "../units";

interface MapToolbarProps {
  filters: MapFilters;
  onFiltersChange: (filters: MapFilters) => void;
  labelsEnabled: boolean;
  onLabelsChange: (enabled: boolean) => void;
  airportsEnabled: boolean;
  onAirportsChange: (enabled: boolean) => void;
}

function Popover({ label, icon, badge, children }: { label: string; icon: ReactNode; badge?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  return (
    <div className="toolbar-popover" ref={container}>
      <button type="button" className={`toolbar-button ${open ? "open" : ""} ${badge ? "has-badge" : ""}`} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        {icon}
        <span>{label}</span>
        {badge ? <b className="toolbar-badge mono">{badge}</b> : null}
        <ChevronDown size={12} className="toolbar-chevron" aria-hidden="true" />
      </button>
      {open && <div className="popover-panel" id={panelId} role="group" aria-label={label}>{children}</div>}
    </div>
  );
}

function Switch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="switch-row">
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

function altitudeLabel(feet: number | null, fallback: string, units: UnitSystem) {
  if (feet == null) return fallback;
  return units === "metric" ? `${Math.round(feet * 0.3048).toLocaleString("en-US")} m` : `${feet.toLocaleString("en-US")} ft`;
}

export function MapToolbar({ filters, onFiltersChange, labelsEnabled, onLabelsChange, airportsEnabled, onAirportsChange }: MapToolbarProps) {
  const units = useUnits();
  const minimum = filters.minAltitudeFt ?? 0;
  const maximum = filters.maxAltitudeFt ?? ALTITUDE_FILTER_MAX_FT;
  const count = activeFilterCount(filters);
  const update = (patch: Partial<MapFilters>) => onFiltersChange({ ...filters, ...patch });

  return (
    <div className="map-toolbar" role="toolbar" aria-label="Map options">
      <Popover label="Filters" icon={<Filter size={14} aria-hidden="true" />} badge={count || undefined}>
        <label className="popover-field">
          <span>Airline, type or registration</span>
          <input type="search" value={filters.query} placeholder="e.g. Air France, A320, F-HBQE" onChange={(event) => update({ query: event.target.value })} />
        </label>
        <div className="popover-field">
          <span>Altitude <b className="mono">{altitudeLabel(filters.minAltitudeFt, "Ground", units)} – {altitudeLabel(filters.maxAltitudeFt, "Any", units)}</b></span>
          <div className="range-pair">
            <input type="range" aria-label="Minimum altitude" min={0} max={ALTITUDE_FILTER_MAX_FT} step={1000} value={minimum}
              onChange={(event) => { const value = Number(event.target.value); update({ minAltitudeFt: value <= 0 ? null : Math.min(value, maximum) }); }} />
            <input type="range" aria-label="Maximum altitude" min={0} max={ALTITUDE_FILTER_MAX_FT} step={1000} value={maximum}
              onChange={(event) => { const value = Number(event.target.value); update({ maxAltitudeFt: value >= ALTITUDE_FILTER_MAX_FT ? null : Math.max(value, minimum) }); }} />
          </div>
        </div>
        <Switch label="Hide aircraft on the ground" checked={filters.hideGround} onChange={(hideGround) => update({ hideGround })} />
        <button type="button" className="popover-reset" disabled={count === 0} onClick={() => onFiltersChange(NO_FILTERS)}>Reset filters</button>
      </Popover>

      <Popover label="Display" icon={<Gauge size={14} aria-hidden="true" />}>
        <div className="popover-field">
          <span>Units</span>
          <div className="segmented" role="group" aria-label="Units">
            {(["aviation", "metric"] as const).map((option) => (
              <button key={option} type="button" className={units === option ? "active" : ""} aria-pressed={units === option} onClick={() => setUnits(option)}>
                {option === "aviation" ? "ft · kt" : "m · km/h"}
              </button>
            ))}
          </div>
        </div>
        <Switch label="Aircraft labels" hint="Callsign and level beside each aircraft when zoomed in" checked={labelsEnabled} onChange={onLabelsChange} />
        <Switch label="Airport markers" hint="Click one to open its departures and arrivals" checked={airportsEnabled} onChange={onAirportsChange} />
      </Popover>
    </div>
  );
}
