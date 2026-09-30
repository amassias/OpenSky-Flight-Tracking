import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Clock3, Moon, Radio, Search, Sun } from "./icons";
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
  const channel = healthPending ? "AIRSPACE / LINKING" : liveAvailable ? "AIRSPACE / LIVE" : "AIRSPACE / HISTORY";
  const inputRef = useRef<HTMLInputElement>(null);
  const [shortcut] = useState(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K");

  // The shortcut hint is a promise: ⌘K / Ctrl+K and "/" jump to the command
  // search from anywhere except another text field.
  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      const typing = event.target instanceof Element
        && event.target.closest("input, textarea, select, [contenteditable='true']");
      const commandK = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (!commandK && (event.key !== "/" || typing)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onCommandChange("");
    event.currentTarget.blur();
  }
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
          ref={inputRef}
          onKeyDown={handleInputKeyDown}
          aria-keyshortcuts="Meta+K Control+K /"
        />
        <kbd className="command-shortcut mono">{commandPending ? "…" : shortcut}</kbd>
      </form>

      <div className="topbar-actions">
        <div className="topbar-status">
          <span className="topbar-channel">{channel}</span>
          <span className={`system-dot ${liveAvailable ? "online" : "warning"}`} />
          <span role="status">{apiState}</span>
          <span className="separator" />
          <Clock3 size={14} aria-hidden="true" />
          <UtcClock />
        </div>
        <button className="icon-button" type="button" onClick={onToggleTheme} aria-label={`Use ${theme === "dark" ? "light" : "dark"} map`}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="icon-button mobile-only" type="button" onClick={onToggleControls} aria-label="Search airports and flights">
          <Search size={19} />
        </button>
      </div>
    </header>
  );
}
