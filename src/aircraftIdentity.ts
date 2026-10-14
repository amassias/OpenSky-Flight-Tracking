import models from "../data/aircraft-types.json";
import logoCatalogue from "../data/airline-logos.json";
import type { Flight } from "./types";
import { AIRLINE_ICAO_BY_IATA } from "./airlineCodes";

// Explicit ICAO operator mappings, never a marketing codeshare or the owner.
const OVERRIDES: Record<string, string> = {
  AFR: "AF", BAW: "BA", KLM: "KL", DLH: "LH", SWR: "LX", AUA: "OS",
  IBE: "IB", VLG: "VY", RYR: "FR", EZY: "U2", EJU: "U2", EZS: "U2",
  UAE: "EK", QTR: "QR", ETD: "EY", THY: "TK", AAL: "AA", UAL: "UA",
  DAL: "DL", SWA: "WN", JBU: "B6", ACA: "AC", SIA: "SQ", QFA: "QF",
};

// Image availability is dated in the catalogue; operator assignments come from
// the generated, sourced code table. Ambiguous assignments retain explicit overrides.
const LOGO_URLS = new Map(logoCatalogue.filter(asset => !("disabled_reason" in asset)).map(asset => [asset.iata, asset.url]));
const LOGOS: Record<string, string> = { ...OVERRIDES };
for (const [iata, operators] of Object.entries(AIRLINE_ICAO_BY_IATA)) {
  if (!LOGO_URLS.has(iata) || operators.length !== 1) continue;
  LOGOS[operators[0]] ??= iata;
}

export function operatorCode(flight: Pick<Flight, "callsign" | "airline_code">): string {
  const callsign = flight.callsign?.trim().toUpperCase() ?? "";
  // A transmitted operator prefix is preferable to a commercial airline code.
  const prefix = callsign.match(/^([A-Z]{3})[0-9][A-Z0-9]*$/)?.[1];
  return prefix ?? (/^[A-Z]{3}$/i.test(flight.airline_code ?? "") ? flight.airline_code!.toUpperCase() : "");
}

export function airlineLogo(flight: Pick<Flight, "callsign" | "airline_code">): string | null {
  const iata = LOGOS[operatorCode(flight)];
  return iata ? LOGO_URLS.get(iata) ?? null : null;
}

export interface AirlineBadge { text: string; color: string }

/** Stand-in for a missing logo: the operator's three letters on a colour fixed by those letters. */
export function airlineBadge(flight: Pick<Flight, "callsign" | "airline_code">): AirlineBadge | null {
  const text = operatorCode(flight);
  if (!text) return null;
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  // Fixed saturation and lightness keep white text above a 4.5:1 contrast on every hue.
  return { text, color: `hsl(${hash} 45% 30%)` };
}

export function aircraftModel(type?: string | null): string | null {
  return (models as Record<string, string>)[type?.trim().toUpperCase() ?? ""] ?? null;
}

export function aircraftManufacturer(model?: string | null): string | null {
  return model?.match(/^(De Havilland Canada|Airbus|Boeing|Embraer|Bombardier|Cessna|ATR|Pilatus|Piper|Cirrus|Diamond|Beechcraft|Robinson|Bell|Sikorsky|Leonardo|Dassault|Gulfstream|Daher|Socata|Honda|COMAC)\b/i)?.[1] ?? null;
}
