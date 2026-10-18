import type { MapTheme } from "../../shared/types";

export interface MapColors { aircraft: string; ground: string; accent: string; halo: string; danger: string }

const TOKENS: Record<keyof MapColors, string> = {
  aircraft: "--aircraft", ground: "--aircraft-ground", accent: "--accent", halo: "--halo", danger: "--danger",
};

const cache = new Map<MapTheme, MapColors>();

/**
 * Map layers are drawn by WebGL and cannot use CSS variables, so they read the
 * theme tokens once per theme. The stylesheet is the single source of map colours.
 * A detached probe carrying the theme class resolves the tokens whether or not
 * the app has already switched its own theme class.
 */
export function mapColors(theme: MapTheme): MapColors {
  const cached = cache.get(theme);
  if (cached) return cached;
  const probe = document.createElement("div");
  probe.className = `theme-${theme}`;
  probe.hidden = true;
  document.body.append(probe);
  const styles = getComputedStyle(probe);
  const root = getComputedStyle(document.documentElement);
  // Browsers inherit custom properties from the root; the fallback covers engines that do not.
  const read = (token: string) => styles.getPropertyValue(token).trim() || root.getPropertyValue(token).trim();
  const colors = Object.fromEntries(Object.entries(TOKENS).map(([key, token]) => [key, read(token)])) as unknown as MapColors;
  probe.remove();
  // An unstyled page (no stylesheet yet) must not poison the cache.
  if (Object.values(colors).every(Boolean)) cache.set(theme, colors);
  return colors;
}

export function resetMapColors() { cache.clear(); }
