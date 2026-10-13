import models from "../data/aircraft-types.json";
import type { Flight } from "./types";

// Explicit ICAO operator mappings, never a marketing codeshare or the owner.
const LOGOS: Record<string, string> = {
  AFR: "AF", BAW: "BA", KLM: "KL", DLH: "LH", SWR: "LX", AUA: "OS",
  IBE: "IB", VLG: "VY", RYR: "FR", EZY: "U2", EJU: "U2", EZS: "U2",
  UAE: "EK", QTR: "QR", ETD: "EY", THY: "TK", AAL: "AA", UAL: "UA",
  DAL: "DL", SWA: "WN", JBU: "B6", ACA: "AC", SIA: "SQ", QFA: "QF",
};

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

export function aircraftModel(type?: string | null): string | null {
  return (models as Record<string, string>)[type?.trim().toUpperCase() ?? ""] ?? null;
}

export function aircraftManufacturer(model?: string | null): string | null {
  return model?.match(/^(De Havilland Canada|Airbus|Boeing|Embraer|Bombardier|Cessna|ATR|Pilatus|Piper|Cirrus|Diamond|Beechcraft|Robinson|Bell|Sikorsky|Leonardo)\b/i)?.[1] ?? null;
}
