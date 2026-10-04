import type { ReactNode } from "react";
import { motion } from "motion/react";
import { ChevronDown } from "./icons";

export type TrafficTab = "live" | "airport";

interface TrafficPanelProps {
  tab: TrafficTab;
  onTabChange: (tab: TrafficTab) => void;
  onClose: () => void;
  liveCount: number;
  airportLabel: string | null;
  live: ReactNode;
  airport: ReactNode;
}

export function TrafficPanel({ tab, onTabChange, onClose, liveCount, airportLabel, live, airport }: TrafficPanelProps) {
  return (
    <aside className="traffic-panel" id="flight-results" aria-label="Traffic">
      <header className="traffic-header">
        <div className="tabs" role="tablist" aria-label="Traffic views">
          {([["live", "In view", liveCount ? String(liveCount) : null], ["airport", "Airport", airportLabel]] as const).map(([id, label, count]) => (
            <button key={id} type="button" role="tab" id={`traffic-tab-${id}`} aria-selected={tab === id} aria-controls={`traffic-pane-${id}`} className={tab === id ? "active" : ""} onClick={() => onTabChange(id)}>
              {tab === id && <motion.span layoutId="traffic-tab-thumb" className="tab-thumb" transition={{ type: "spring", stiffness: 520, damping: 42 }} />}
              <span>{label}</span>
              {count && <small className="mono">{count}</small>}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Collapse traffic panel" title="Collapse panel"><ChevronDown size={16} className="collapse-chevron" /></button>
      </header>
      <div className="traffic-pane" role="tabpanel" id={`traffic-pane-${tab}`} aria-labelledby={`traffic-tab-${tab}`}>
        {tab === "live" ? live : airport}
      </div>
    </aside>
  );
}
