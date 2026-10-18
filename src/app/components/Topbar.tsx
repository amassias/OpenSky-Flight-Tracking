import { useEffect, useState, type ReactNode } from "react";
import { useNow } from "../../shared/hooks/useNow";
import { Moon, Plane, Sun } from "../../shared/components/icons";
import { CircleHelp, KeyboardIcon } from "../../shared/components/customIcons";
import type { HealthResponse, MapTheme } from "../../shared/types";
import type { LiveCause } from "../../features/map/liveStatus";

interface TopbarProps {
  health?: HealthResponse;
  healthPending: boolean;
  liveCause?: LiveCause | null;
  theme: MapTheme;
  /** Global search, rendered in the centre of the bar. */
  search?: ReactNode;
  onToggleTheme: (origin?: { x: number; y: number }) => void;
  onToggleControls?: () => void;
  onShowTour?: () => void;
  onShowShortcuts?: () => void;
}

function UtcClock() {
  const now = useNow(1000);
  return <span className="mono">{new Date(now).toISOString().slice(11, 19)} UTC</span>;
}

function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function Topbar({ health, healthPending, liveCause, theme, search, onToggleTheme, onShowTour, onShowShortcuts }: TopbarProps) {
  const online = useOnline();
  const liveAvailable = online && (health?.live_available ?? health?.credentials_configured);
  const channel = !online ? "Offline" : healthPending ? "Connecting" : liveCause ? "Delayed" : liveAvailable ? "Live" : "History only";
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark"><Plane size={16} aria-hidden="true" /></span>
        <strong>SkyTrace</strong>
      </div>

      <div className="topbar-search">{search}</div>

      <div className="topbar-actions">
        <div className="topbar-status" aria-label="Connection status">
          <span className={`system-dot ${liveAvailable && !liveCause ? "online" : "warning"}`} />
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
