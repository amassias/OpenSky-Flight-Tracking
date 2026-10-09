import type { AirframeEntry } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2021-06" becomes "Jun 2021"; "2022-08-09" becomes "9 Aug 2022". */
export function formatHistoryDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-");
  const name = MONTHS[Number(month) - 1];
  if (!year || !name) return null;
  return day ? `${Number(day)} ${name} ${year}` : `${name} ${year}`;
}

/**
 * How long an entry applied. FAA rows carry exact days. OpenSky rows only know
 * the snapshot months in which a state was seen, so they read "seen" and the
 * open-ended one runs to the newest snapshot, not to today.
 */
export function describePeriod(entry: AirframeEntry, latestSnapshot?: string | null): string {
  const from = formatHistoryDate(entry.from);
  const to = formatHistoryDate(entry.to);
  if (entry.source === "faa") {
    if (from && to) return `${from} – ${to}`;
    if (from) return `Since ${from}`;
    return to ? `Until ${to}` : "Dates not published";
  }
  if (entry.to === null) return `Seen ${from ?? "…"} – ${formatHistoryDate(latestSnapshot) ?? "latest"}`;
  return from === to ? `Seen in ${from}` : `Seen ${from} – ${to}`;
}

export function entryTitle(entry: AirframeEntry): string {
  if (entry.owner) return entry.owner;
  if (entry.operator) return entry.operator;
  return entry.private ? "Private owner" : "Owner not listed";
}

export function airframeAge(built: string | undefined, now = new Date()): number | null {
  const year = Number(built);
  if (!Number.isInteger(year) || year < 1900 || year > now.getUTCFullYear()) return null;
  return now.getUTCFullYear() - year;
}

/** Distinct registrations an airframe has carried, newest first. */
export function registrationsOf(entries: readonly AirframeEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.registration).filter((value): value is string => Boolean(value)))];
}

export function distinctOwners(entries: readonly AirframeEntry[]): string[] {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    for (const name of [entry.owner, entry.operator]) {
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
  }
  return [...seen.values()];
}

/**
 * Typed text that can name one specific airframe: a hyphenated registration
 * (F-HBXA, G-EUUU), a US N-number (N283VA) or a 6-digit hex code. Callsigns
 * such as AFR123 are left to the aircraft in view.
 */
export function looksLikeRegistration(value: string): boolean {
  const text = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,2}-[A-Z0-9]{2,5}$/.test(text) || /^N[1-9][0-9]{0,4}[A-Z]{0,2}$/.test(text) || /^[0-9A-F]{6}$/.test(text);
}

