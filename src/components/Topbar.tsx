import { Clock3, Menu, Moon, Radio, Sun } from "lucide-react";
import type { HealthResponse, MapTheme } from "../types";

interface TopbarProps {
  health?: HealthResponse;
  healthPending: boolean;
  theme: MapTheme;
  utcTime: string;
  onToggleTheme: () => void;
  onToggleControls: () => void;
}

export function Topbar({
  health,
  healthPending,
  theme,
  utcTime,
  onToggleTheme,
  onToggleControls,
}: TopbarProps) {
  const apiState = healthPending ? "Connecting" : health?.credentials_configured ? "Live ADS-B" : "Setup required";

  return (
    <header className="topbar">
      <div className="brand" aria-label="SkyTrace home">
        <span className="brand-mark"><Radio size={18} aria-hidden="true" /></span>
        <span>
          <strong>SKYTRACE</strong>
          <small>Flight intelligence</small>
        </span>
      </div>

      <div className="topbar-center" aria-live="polite">
        <span className={`system-dot ${health?.credentials_configured ? "online" : "warning"}`} />
        <span>{apiState}</span>
        <span className="separator" />
        <Clock3 size={14} aria-hidden="true" />
        <span className="mono">{utcTime} UTC</span>
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
