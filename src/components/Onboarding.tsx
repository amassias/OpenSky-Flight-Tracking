import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { X } from "./icons";

interface TourStep {
  /** CSS selector of the area to light up; a missing target centres the card instead. */
  target?: string;
  title: string;
  body: string;
  keys?: string[];
}

const STEPS: TourStep[] = [
  {
    title: "Welcome to SkyTrace",
    body: "Live air traffic on one map. Here is a quick tour of what you can do. It takes under a minute.",
  },
  {
    target: ".map-surface",
    title: "The live map",
    body: "Every aircraft in view moves in real time. Drag to pan, scroll to zoom, and new traffic loads wherever you go.",
  },
  {
    target: ".topbar-search",
    title: "Find anything",
    body: "Search a flight number, a registration or an airport, and jump straight to it.",
    keys: ["⌘ K", "/"],
  },
  {
    target: ".traffic-slot, .traffic-reopen",
    title: "Traffic and airports",
    body: "The panel lists what is in view. Open an airport to see its departures and arrivals, scheduled flights included, and tap any flight to follow it live.",
  },
  {
    target: ".map-surface",
    title: "Open a flight",
    body: "Click any aircraft to see its route, progress, altitude profile and photo. Its path is drawn on the map, coloured by altitude.",
    keys: ["F follow", "R full route", "Esc close"],
  },
  {
    target: ".map-controls",
    title: "Make it yours",
    body: "Zoom, find your location, pause live updates or go full screen. Filters, labels and units live in the toolbar on the left, and they stay as you leave them.",
    keys: ["T theme", "? all shortcuts"],
  },
];

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 8;
const CARD_WIDTH = 340;

function measure(selector?: string): Rect | null {
  if (!selector) return null;
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const box = element.getBoundingClientRect();
    if (box.width > 8 && box.height > 8) {
      const top = Math.max(0, box.top - PAD);
      const left = Math.max(0, box.left - PAD);
      return {
        top, left,
        width: Math.min(window.innerWidth, box.right + PAD) - left,
        height: Math.min(window.innerHeight, box.bottom + PAD) - top,
      };
    }
  }
  return null;
}

/** Where the card sits: beside the lit area when there is room, otherwise centred. */
function cardPosition(rect: Rect | null, cardHeight: number): { top: number; left: number } {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const centred = { top: Math.max(16, (height - cardHeight) / 2), left: Math.max(16, (width - CARD_WIDTH) / 2) };
  if (!rect || width < 700) return width < 700 ? { top: Math.max(16, height - cardHeight - 20), left: Math.max(12, (width - CARD_WIDTH) / 2) } : centred;
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
  const below = rect.top + rect.height + 16;
  if (rect.height < height * 0.4 && below + cardHeight < height - 16) {
    return { top: below, left: clamp(rect.left + rect.width / 2 - CARD_WIDTH / 2, 16, width - CARD_WIDTH - 16) };
  }
  const spaceLeft = rect.left;
  const spaceRight = width - rect.left - rect.width;
  if (spaceLeft >= CARD_WIDTH + 32 && spaceLeft >= spaceRight) {
    return { top: clamp(rect.top + rect.height / 2 - cardHeight / 2, 64, height - cardHeight - 16), left: rect.left - CARD_WIDTH - 16 };
  }
  if (spaceRight >= CARD_WIDTH + 32) {
    return { top: clamp(rect.top + rect.height / 2 - cardHeight / 2, 64, height - cardHeight - 16), left: rect.left + rect.width + 16 };
  }
  return centred;
}

interface OnboardingProps {
  onClose: () => void;
}

/** First-visit walkthrough: a spotlight moves over the interface while a card explains each part. */
export function Onboarding({ onClose }: OnboardingProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(220);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const update = useCallback(() => setRect(measure(step.target)), [step.target]);
  useLayoutEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update]);
  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
  }, [index]);

  const next = useCallback(() => (last ? onClose() : setIndex((current) => current + 1)), [last, onClose]);
  const back = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (event.key === "ArrowRight" || event.key === "Enter") { event.preventDefault(); next(); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); back(); }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [back, next, onClose]);

  const position = cardPosition(rect, cardHeight);
  const transition = reduced ? "none" : "top .5s var(--ease-out), left .5s var(--ease-out), width .5s var(--ease-out), height .5s var(--ease-out)";

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div className="tour-spotlight" style={{ ...rect, transition }} aria-hidden="true" />
      ) : (
        <div className="tour-dim" aria-hidden="true" />
      )}
      <motion.div
        ref={cardRef}
        className="tour-card"
        style={{ top: position.top, left: position.left, width: CARD_WIDTH, transition: reduced ? "none" : "top .5s var(--ease-out), left .5s var(--ease-out)" }}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25 }}
      >
        <button type="button" className="icon-button tour-close" onClick={onClose} aria-label="Skip the tour"><X size={15} /></button>
        <div key={index} className="tour-body">
          <p className="tour-count mono">{index + 1} / {STEPS.length}</p>
          <h2 id="tour-title">{step.title}</h2>
          <p>{step.body}</p>
          {step.keys && <p className="tour-keys">{step.keys.map((key) => <kbd key={key}>{key}</kbd>)}</p>}
        </div>
        <div className="tour-footer">
          <div className="tour-dots" aria-hidden="true">
            {STEPS.map((_, dot) => <span key={dot} className={dot === index ? "active" : dot < index ? "done" : ""} />)}
          </div>
          <div className="tour-actions">
            {index === 0 ? (
              <button type="button" className="tour-skip" onClick={onClose}>Skip</button>
            ) : (
              <button type="button" className="tour-skip" onClick={back}>Back</button>
            )}
            <button type="button" className="tour-next" onClick={next} autoFocus>{last ? "Start exploring" : index === 0 ? "Take the tour" : "Next"}</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
