import { useEffect, useState, type ReactNode } from "react";
import { Moon, Plane, Sun } from "./icons";
import { CircleHelp, KeyboardIcon } from "./customIcons";
import type { HealthResponse, MapTheme } from "../types";

interface TopbarProps {
  health?: HealthResponse;
  healthPending: boolean;
  theme: MapTheme;
  /** Global search, rendered in the centre of the bar. */
  search?: ReactNode;
  onToggleTheme: (origin?: { x: number; y: number }) => void;
  onToggleControls?: () => void;
  onShowTour?: () => void;
  onShowShortcuts?: () => void;
}

function UtcClock() {
  const [time, setTime] = useState(() => new Date().toISOString().slice(11, 19));
  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date().toISOString().slice(11, 19)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="mono">{time} UTC</span>;
}

export function Topbar({ health, healthPending, theme, search, onToggleTheme, onShowTour, onShowShortcuts }: TopbarProps) {
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
        {onShowShortcuts && <button className="icon-button topbar-shortcuts" type="button" onClick={onShowShortcuts} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" aria-keyshortcuts="?"><KeyboardIcon size={17} /></button>}
        {onShowTour && <button className="icon-button" type="button" onClick={onShowTour} aria-label="Show the tour" title="Show the tour"><CircleHelp size={17} /></button>}
        <button className="icon-button" type="button" onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onToggleTheme({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
        }} aria-label={`Use ${theme === "dark" ? "light" : "dark"} map`} title={`Use ${theme === "dark" ? "light" : "dark"} map (T)`}>
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
}
