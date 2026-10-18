import { ApiError } from "../../shared/api";

/** Why the live feed is degraded: our server, OpenSky, or the OpenSky credit budget. */
export type LiveCause = "backend" | "provider" | "quota";

const CAUSE_TEXT: Record<LiveCause, string> = {
  backend: "SkyTrace cannot be reached",
  provider: "OpenSky is not answering",
  quota: "OpenSky credit budget reached",
};

export function causeFromError(error: unknown): LiveCause {
  if (error instanceof ApiError) {
    if (error.status === 429) return "quota";
    if (error.status === 502 || error.status === 503) return "provider";
  }
  return "backend";
}

/** Reads the cause the server names on a degraded Global snapshot. */
export function causeFromReason(reason: unknown): LiveCause {
  return reason === "quota" ? "quota" : reason === "backend" ? "backend" : "provider";
}

interface LiveStatusInput {
  count: number;
  cause: LiveCause | null;
  /** Age of the snapshot kept on the map, when known. */
  ageSeconds: number | null;
  /** Only Local feed cells answered, so far fewer aircraft than the Global snapshot. */
  reducedCoverage: boolean;
}

/** Map status line. The last snapshot stays visible and is labelled with its age. */
export function describeLiveStatus({ count, cause, ageSeconds, reducedCoverage }: LiveStatusInput): string {
  if (!cause) return `${count} aircraft`;
  if (count === 0) return `Live traffic unavailable · ${CAUSE_TEXT[cause]}`;
  const parts = [`${count} aircraft`];
  if (reducedCoverage) parts.push("reduced coverage");
  if (ageSeconds != null) parts.push(`snapshot from ${Math.max(0, Math.round(ageSeconds))} s ago`);
  parts.push(CAUSE_TEXT[cause]);
  return parts.join(" · ");
}

/** What the empty "In view" list says: the real cause, or advice to move the map. */
export function listEmptyMessage(cause: LiveCause | null): string {
  if (!cause) return "Zoom out or move the map to a busier area. The list follows what the map shows.";
  return `${CAUSE_TEXT[cause]}, so live aircraft cannot be listed right now. SkyTrace retries automatically.`;
}
