import type { Flight } from "../types";
import { positionObservation } from "../flightTelemetry";
import { useNow } from "../hooks/useNow";

export function PositionObservation({ flight }: { flight: Flight }) {
  const observation = positionObservation(flight, useNow(10_000) / 1000);
  if (!observation) return null;
  if (observation.state === "unknown") return <p className="position-observation">Position observation time unavailable. Values are last reported.</p>;
  const age = observation.age < 60 ? `${Math.floor(observation.age)} s ago` : `${Math.floor(observation.age / 60)} min ago`;
  const time = new Date(observation.time * 1000).toISOString().slice(11, 19);
  return <div className={`position-observation ${observation.state === "delayed" ? "is-delayed" : ""}`}>
    <span>{observation.state === "delayed" ? "Position updates delayed" : "Last reported position"} · <time dateTime={new Date(observation.time * 1000).toISOString()}>{time} UTC</time> · {age}</span>
    {observation.state === "delayed" && <p role="status">Showing the last observation. Altitude, speed and alerts may have changed.</p>}
  </div>;
}
