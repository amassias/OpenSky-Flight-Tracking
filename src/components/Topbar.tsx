import { useEffect, useState } from "react";
import { Clock3, Moon, Radio, Search, Sun } from "./icons";
import type { HealthResponse, MapTheme } from "../types";

interface TopbarProps {
  health?: HealthResponse;
  healthPending: boolean;
  theme: MapTheme;
  onToggleTheme: (origin?: { x: number; y: number }) => void;
  onToggleControls: () => void;
}

function UtcClock() {
  const [time, setTime] = useState(() => new Date().toISOString().slice(11, 19));
  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date().toISOString().slice(11, 19)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="mono">{time} UTC</span>;
}

export function Topbar({
  health,
  healthPending,
  theme,
  onToggleTheme,
  onToggleControls,
}: TopbarProps) {
  const liveAvailable = health?.live_available ?? health?.credentials_configured;
  const apiState = healthPending ? "Checking feeds" : liveAvailable ? "ADS-B" : "Setup required";
  const channel = healthPending ? "Connecting" : liveAvailable ? "Live" : "History only";
  return (
    <header className="topbar">
      <div className="brand" aria-label="SkyTrace home">
        <span className="brand-mark"><Radio size={18} aria-hidden="true" /></span>
        <span>
          <strong>SkyTrace</strong>
          <small>Flight intelligence</small>
        </span>
      </div>

      <div className="topbar-actions">
        <div className="topbar-status">
          <span className="topbar-channel">{channel}</span>
          <span className={`system-dot ${liveAvailable ? "online" : "warning"}`} />
          <span role="status">{apiState}</span>
          <span className="separator" />
          <Clock3 size={14} aria-hidden="true" />
          <UtcClock />
        </div>
        <button className="icon-button" type="button" onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onToggleTheme({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
        }} aria-label={`Use ${theme === "dark" ? "light" : "dark"} map`}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="icon-button mobile-only" type="button" onClick={onToggleControls} aria-label="Search airports and flights">
          <Search size={19} />
        </button>
      </div>
    </header>
  );
}
