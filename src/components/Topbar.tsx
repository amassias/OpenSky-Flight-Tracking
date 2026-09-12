import { useEffect, useState, type FormEvent } from "react";
import { Clock3, Menu, Moon, Radio, Search, Sun } from "lucide-react";
import type { HealthResponse, MapTheme } from "../types";

interface TopbarProps {
  health?: HealthResponse;
  healthPending: boolean;
  theme: MapTheme;
  onToggleTheme: () => void;
  onToggleControls: () => void;
  commandValue: string;
  commandPending?: boolean;
  onCommandChange: (value: string) => void;
  onCommandSubmit: () => void;
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
  commandValue,
  commandPending = false,
  onCommandChange,
  onCommandSubmit,
}: TopbarProps) {
  const liveAvailable = health?.live_available ?? health?.credentials_configured;
  const apiState = healthPending ? "Connecting" : liveAvailable ? "ADS-B enabled" : "Setup required";
  function handleCommandSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCommandSubmit();
  }

  return (
    <header className="topbar">
      <div className="brand" aria-label="SkyTrace home">
        <span className="brand-mark"><Radio size={18} aria-hidden="true" /></span>
        <span>
          <strong>SKYTRACE</strong>
          <small>Airspace intelligence</small>
        </span>
      </div>

      <form className="command-search" onSubmit={handleCommandSubmit} role="search">
        <Search size={15} aria-hidden="true" />
        <input
          value={commandValue}
          onChange={(event) => onCommandChange(event.target.value)}
          aria-label="Search airport, flight or callsign"
          placeholder="Search airport, flight or callsign"
          autoComplete="off"
        />
        <span className="command-shortcut mono">{commandPending ? "…" : "⌘K"}</span>
      </form>

      <div className="topbar-actions">
        <div className="topbar-status">
          <span className="topbar-channel">AIRSPACE / LIVE</span>
          <span className={`system-dot ${liveAvailable ? "online" : "warning"}`} />
          <span role="status">{apiState}</span>
          <span className="separator" />
          <Clock3 size={14} aria-hidden="true" />
          <UtcClock />
        </div>
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
