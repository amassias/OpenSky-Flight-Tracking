import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { X } from "./icons";

const SHORTCUTS: ReadonlyArray<{ keys: string[]; label: string }> = [
  { keys: ["⌘K", "Ctrl K", "/"], label: "Focus search" },
  { keys: ["↑", "↓", "Enter"], label: "Move through and open search or flight results" },
  { keys: ["F"], label: "Follow the selected aircraft" },
  { keys: ["R"], label: "Frame the selected route" },
  { keys: ["T"], label: "Switch between dark and light map" },
  { keys: ["?"], label: "Show these shortcuts" },
  { keys: ["Esc"], label: "Close search, menu, full map or flight detail" },
];

interface ShortcutsDialogProps {
  onClose: () => void;
}

export function ShortcutsDialog({ onClose }: ShortcutsDialogProps) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    function onKey(event: KeyboardEvent) {
      // The close button is the only control, so Tab stays on it (modal focus).
      if (event.key === "Tab") { event.preventDefault(); closeButton.current?.focus(); return; }
      if (event.key !== "Escape" && event.key !== "?") return;
      // Captured first so the flight detail behind the dialog stays open.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="shortcuts" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.div
        className="shortcuts-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        initial={{ opacity: 0, scale: 0.97, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <button ref={closeButton} type="button" className="icon-button shortcuts-close" onClick={onClose} aria-label="Close keyboard shortcuts"><X size={15} /></button>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <dl>
          {SHORTCUTS.map(({ keys, label }) => (
            <div key={label}>
              <dt>{keys.map((key) => <kbd key={key}>{key}</kbd>)}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </motion.div>
    </div>
  );
}
