import { isPositionEstimated } from "../../features/map/aircraftMotion";
import type { Flight } from "../types";
import { positionObservation } from "../../features/flights/flightTelemetry";
import { useNow } from "../hooks/useNow";

export function PositionObservation({ flight }: { flight: Flight }) {
  const now = useNow(1_000) / 1000;
  const observation = positionObservation(flight, now);
  if (!observation) return null;
  if (observation.state === "unknown") return null;
  const age = observation.age < 60 ? `${Math.floor(observation.age)} s ago` : `${Math.floor(observation.age / 60)} min ago`;
  const time = new Date(observation.time * 1000).toISOString().slice(11, 19);
  return <div className={`position-observation ${observation.state === "delayed" ? "is-delayed" : ""}`}>
    <span>{observation.state === "delayed" ? "Position delayed" : "Position"} · <time dateTime={new Date(observation.time * 1000).toISOString()}>{time} UTC</time> · {age}</span>
    {isPositionEstimated(flight, now) && <span className="position-estimate" title="Projected from the last reported speed and heading, up to 150 seconds">Estimated map position</span>}
  </div>;
}
