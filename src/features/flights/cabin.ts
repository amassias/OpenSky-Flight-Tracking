import type { CabinConfiguration } from "../../shared/types";

export type CabinTone = "first" | "business" | "premium" | "economy" | "flexible" | "other";

/** Map a published class name onto a fixed palette, so unknown names still render. */
export function cabinTone(name: string): CabinTone {
  const n = name.toLowerCase();
  if (/(flexible|convertible)/.test(n)) return "flexible";
  if (/premium/.test(n)) return "premium";
  if (/(first|suite)/.test(n)) return "first";
  if (/(business|club|upper)/.test(n)) return "business";
  if (/(economy|coach|main|standard)/.test(n)) return "economy";
  return "other";
}

/** Short label for the schematic; the full name stays in the legend. */
export function cabinShortLabel(name: string): string {
  const tone = cabinTone(name);
  return ({ first: "First", business: "Business", premium: "Premium", economy: "Economy", flexible: "Flex", other: name })[tone];
}

/** Age of a source check, relative to `now`; the ISO date stays available as a title. */
export function checkedAgo(checkedAt: string, now: Date = new Date()): string {
  const checked = new Date(`${checkedAt}T00:00:00Z`);
  if (Number.isNaN(checked.getTime())) return `Checked ${checkedAt}`;
  const days = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - checked.getTime()) / 86_400_000);
  if (days <= 0) return "Checked today";
  if (days === 1) return "Checked yesterday";
  if (days < 60) return `Checked ${days} days ago`;
  const months = Math.floor(days / 30.44);
  return months < 24 ? `Checked ${months} months ago` : `Checked ${Math.floor(months / 12)} years ago`;
}

/** The seat-map link only earns its place when it is not the source page itself. */
export function distinctSeatMapUrl(config: Pick<CabinConfiguration, "seat_map_url" | "source">): string | null {
  const url = config.seat_map_url?.trim();
  return url && url !== config.source.url ? url : null;
}

export function cabinSummary(config: Pick<CabinConfiguration, "classes">): string {
  return config.classes.length === 1 ? config.classes[0].name : `${config.classes.length} cabins`;
}
