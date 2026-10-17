import catalogue from "../data/aircraft-silhouettes/catalogue.json";
import rotors from "../data/aircraft-silhouettes/rotors.json";
import type { AircraftIconKind } from "./utils";

export interface AircraftSilhouette {
  id: string;
  name: string;
  kind: AircraftIconKind;
  match: "type" | "family";
  /** Fragment of the 64×64 nose-east SVG sprite embedded in the page. */
  symbol: string;
  rotor?: { symbol: string; cx: number; cy: number };
}

const silhouettes = new Map<string, AircraftSilhouette>();
for (const [code, mapping] of Object.entries(catalogue.types)) {
  const id = mapping.id as keyof typeof catalogue.models;
  const model = catalogue.models[id];
  const rotor = (rotors as Record<string, { path: string; cx: number; cy: number }>)[id];
  silhouettes.set(code, {
    id, name: model.name, kind: model.kind as AircraftIconKind,
    match: mapping.match as AircraftSilhouette["match"], symbol: `#aircraft-model-${id}`,
    rotor: rotor ? { symbol: `#aircraft-model-${id}-rotor`, cx: rotor.cx, cy: rotor.cy } : undefined,
  });
}

/** Only explicit ICAO matches; airline or callsign never guesses a model. */
export function aircraftSilhouette(type?: string | null): AircraftSilhouette | null {
  return silhouettes.get(type?.trim().toUpperCase() ?? "") ?? null;
}
