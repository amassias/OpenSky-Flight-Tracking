import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "./icons";

export type TrafficTab = "live" | "airport" | "alerts";

interface TrafficPanelProps {
  tab: TrafficTab;
  onTabChange: (tab: TrafficTab) => void;
  onClose: () => void;
  liveCount: number;
  airportLabel: string | null;
  live: ReactNode;
  airport: ReactNode;
  alerts: ReactNode;
}

export function TrafficPanel({ tab, onTabChange, onClose, liveCount, airportLabel, live, airport, alerts }: TrafficPanelProps) {
  const reducedMotion = useReducedMotion();
  return (
    <aside className="traffic-panel" id="flight-results" tabIndex={-1} aria-label="Traffic">
      <header className="traffic-header">
        <div className="tabs" role="tablist" aria-label="Traffic views">
          {([["live", "In view", liveCount ? String(liveCount) : null], ["airport", "Airport", airportLabel], ["alerts", "Alerts", null]] as const).map(([id, label, count]) => (
            <button key={id} type="button" role="tab" id={`traffic-tab-${id}`} tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls={`traffic-pane-${id}`} className={tab === id ? "active" : ""} onClick={() => onTabChange(id)} onKeyDown={event => {
              const ids: TrafficTab[] = ["live", "airport", "alerts"];
              const index = ids.indexOf(id);
              const next = event.key === "ArrowRight" ? ids[(index + 1) % 3] : event.key === "ArrowLeft" ? ids[(index + 2) % 3] : event.key === "Home" ? ids[0] : event.key === "End" ? ids[2] : null;
              if (next) { event.preventDefault(); onTabChange(next); document.getElementById(`traffic-tab-${next}`)?.focus(); }
            }}>
              {tab === id && <motion.span layoutId={reducedMotion ? undefined : "traffic-tab-thumb"} className="tab-thumb" transition={{ duration: 0.18, ease: "easeOut" }} />}
              <span>{label}</span>
              {count && <small className="mono">{count}</small>}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Collapse traffic panel" title="Collapse panel"><ChevronDown size={16} className="collapse-chevron" /></button>
      </header>
      <div className="traffic-pane" role="tabpanel" id={`traffic-pane-${tab}`} aria-labelledby={`traffic-tab-${tab}`}>
        {tab === "live" ? live : tab === "airport" ? airport : alerts}
      </div>
    </aside>
  );
}
