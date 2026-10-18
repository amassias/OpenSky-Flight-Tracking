import { X } from "../../shared/components/icons";

/** One short, non-blocking first-visit hint. It never takes focus or covers the map. */
export function MapHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="map-hint" role="status">
      <span>Tap an aircraft to see its flight.</span>
      <button type="button" className="icon-button" onClick={onDismiss} aria-label="Dismiss hint"><X size={14} /></button>
    </div>
  );
}
