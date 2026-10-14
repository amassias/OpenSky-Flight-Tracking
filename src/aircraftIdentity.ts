import models from "../data/aircraft-types.json";
import type { Flight } from "./types";
import { AIRLINE_ICAO_BY_IATA } from "./airlineCodes";

// Explicit ICAO operator mappings, never a marketing codeshare or the owner.
const OVERRIDES: Record<string, string> = {
  ASL: "JU", APG: "Z2", TLM: "SL",
  AFR: "AF", BAW: "BA", KLM: "KL", DLH: "LH", SWR: "LX", AUA: "OS",
  IBE: "IB", VLG: "VY", RYR: "FR", EZY: "U2", EJU: "U2", EZS: "U2",
  UAE: "EK", QTR: "QR", ETD: "EY", THY: "TK", AAL: "AA", UAL: "UA",
  DAL: "DL", SWA: "WN", JBU: "B6", ACA: "AC", SIA: "SQ", QFA: "QF",
};

// OpenFlights' free operator codes cover more airlines than the hand-picked
// overrides. Keep only currently recognisable designators with a logo asset;
// ambiguous/legacy mappings are handled by the overrides above.
const LOGO_IATA = new Set(`AK D7 FD QZ Z2 SL DD PG OD FY 6E SG IX 5J ZH SC 3U MF 9C UO HX NX MM GK BC 7C LJ TW ZE BX JT IW QG SJ PD WG KU XY NP W5 IR PK HY KC J2 U6 S7 UT B2 A9 WK EN LG JU 3O WB TC PW DT MK HM UU A3 AC AD AF AH AI AM AR AS AT AV AY AZ B6 B7 BA BG BI BR BT BY CA CI CM CX CZ DE DL DY EI EK ET EW EY F9 FI FJ FR FZ G3 G4 GA GF HA HO HU HV IB JL JQ KE KL KQ LA LH LO LX LY ME MH MS MU NH NK NZ OS OU OZ PC PR QF QR RJ RO SK SN SQ SU SV TG TK TN TO TP TR TS TU UA UL UX VA VN VS VY W6 WN WS WY XQ Y4`.split(" "));
const LOGOS: Record<string, string> = { ...OVERRIDES };
for (const [iata, operators] of Object.entries(AIRLINE_ICAO_BY_IATA)) {
  if (!LOGO_IATA.has(iata) || operators.length !== 1) continue;
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
  return iata ? `https://images.kiwi.com/airlines/64/${iata}.png` : null;
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
  return model?.match(/^(De Havilland Canada|Airbus|Boeing|Embraer|Bombardier|Cessna|ATR|Pilatus|Piper|Cirrus|Diamond|Beechcraft|Robinson|Bell|Sikorsky|Leonardo)\b/i)?.[1] ?? null;
}
