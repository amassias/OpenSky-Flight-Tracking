import { useEffect, useState } from "react";
import { Clock3, Menu, Moon, Radio, Sun } from "lucide-react";
import type { HealthResponse, MapTheme } from "../types";

interface TopbarProps {
  health?: HealthResponse;
  healthPending: boolean;
  theme: MapTheme;
  onToggleTheme: () => void;
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
  const apiState = healthPending ? "Connecting" : liveAvailable ? "ADS-B enabled" : "Setup required";

  return (
    <header className="topbar">
      <div className="brand" aria-label="SkyTrace home">
        <span className="brand-mark"><Radio size={18} aria-hidden="true" /></span>
        <span>
          <strong>SKYTRACE</strong>
          <small>Flight intelligence</small>
        </span>
      </div>

      <div className="topbar-center">
        <span className={`system-dot ${liveAvailable ? "online" : "warning"}`} />
        <span role="status">{apiState}</span>
        <span className="separator" />
        <Clock3 size={14} aria-hidden="true" />
        <UtcClock />
      </div>

      <div className="topbar-actions">
        <button className="icon-button" type="button" onClick={onToggleTheme} aria-label={`Use ${theme === "dark" ? "light" : "dark"} map`}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="icon-button mobile-only" type="button" onClick={onToggleControls} aria-label="Open flight search">
          <Menu size={20} />
        </button>
      </div>
    </header>
  );
}
