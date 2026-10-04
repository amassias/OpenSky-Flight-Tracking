import { useEffect, useState, type ReactNode } from "react";
import { Moon, Plane, Sun } from "./icons";
import type { HealthResponse, MapTheme } from "../types";

interface TopbarProps {
  health?: HealthResponse;
  healthPending: boolean;
  theme: MapTheme;
  /** Global search, rendered in the centre of the bar. */
  search?: ReactNode;
  onToggleTheme: (origin?: { x: number; y: number }) => void;
  onToggleControls?: () => void;
}

function UtcClock() {
  const [time, setTime] = useState(() => new Date().toISOString().slice(11, 19));
  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date().toISOString().slice(11, 19)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="mono">{time} UTC</span>;
}

export function Topbar({ health, healthPending, theme, search, onToggleTheme }: TopbarProps) {
  const liveAvailable = health?.live_available ?? health?.credentials_configured;
  const channel = healthPending ? "Connecting" : liveAvailable ? "Live" : "History only";
  return (
    <header className="topbar">
      <div className="brand" aria-label="SkyTrace">
        <span className="brand-mark"><Plane size={16} aria-hidden="true" /></span>
        <strong>SkyTrace</strong>
      </div>

      <div className="topbar-search">{search}</div>

      <div className="topbar-actions">
        <div className="topbar-status" role="status">
          <span className={`system-dot ${liveAvailable ? "online" : "warning"}`} />
          <span className="topbar-channel">{channel}</span>
          <span className="separator" />
          <UtcClock />
        </div>
        <button className="icon-button" type="button" onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onToggleTheme({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
        }} aria-label={`Use ${theme === "dark" ? "light" : "dark"} map`} title={`Use ${theme === "dark" ? "light" : "dark"} map`}>
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
}
