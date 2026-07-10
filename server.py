#!/usr/bin/env python3
"""
OpenSky Flight Intelligence Server

Run with: python3 server.py
Open: http://localhost:8000
"""

import http.server
import json
import mimetypes
import os
import socketserver
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

from dotenv import load_dotenv

from api_client import OpenSkyAPIError, OpenSkyClient
from data_loader import get_airline_name, load_airports, search_airports

load_dotenv()

BASE_DIR = os.path.dirname(__file__)
FRONTEND_DIST_DIR = os.path.join(BASE_DIR, "dist")
PORT = int(os.getenv("PORT", "8000"))

print("Loading airports database...")
ALL_AIRPORTS = load_airports()
print(f"Loaded {len(ALL_AIRPORTS)} airports")

api_client = OpenSkyClient()

POPULAR_AIRPORTS = [
    "LFPG",
    "LFPO",
    "EGLL",
    "EHAM",
    "EDDF",
    "LEMD",
    "LIRF",
    "LSZH",
    "KJFK",
    "KLAX",
    "OMDB",
    "RJTT",
]


def _safe_int(value, default=None):
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _safe_float(value, default=None):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _iso_from_timestamp(timestamp):
    if timestamp is None:
        return None
    ts = _safe_int(timestamp)
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _chunked(items, chunk_size):
    for i in range(0, len(items), chunk_size):
        yield items[i : i + chunk_size]


def _parse_utc_date(date_str: str) -> date:
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError("Invalid date format. Use YYYY-MM-DD.") from exc


def _validate_airport_icao(icao: str) -> str:
    airport = (icao or "").strip().upper()
    if len(airport) != 4 or not airport.isalnum():
        raise ValueError("Airport ICAO must be a 4-character code.")
    if airport not in ALL_AIRPORTS:
        raise ValueError(f"Airport {airport} was not found in the local airport database.")
    return airport


def _validate_icao24(icao24: str) -> str:
    code = (icao24 or "").strip().lower()
    if len(code) != 6:
        raise ValueError("icao24 must contain exactly 6 hexadecimal characters.")
    try:
        int(code, 16)
    except ValueError as exc:
        raise ValueError("icao24 must be a valid hexadecimal string.") from exc
    return code


class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True


class FlightServerHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urlparse(self.path)
        query_params = parse_qs(parsed_path.query)

        if parsed_path.path.startswith("/api/"):
            self._handle_api_request(parsed_path.path, query_params)
            return

        if parsed_path.path in ("/", "/index.html"):
            if os.path.exists(os.path.join(FRONTEND_DIST_DIR, "index.html")):
                self._serve_frontend_file("index.html", cache_seconds=0)
            else:
                self._serve_static_file("index.html", cache_seconds=0)
            return

        if parsed_path.path.startswith("/assets/"):
            self._serve_frontend_file(parsed_path.path.lstrip("/"), cache_seconds=31536000)
            return

        if parsed_path.path.startswith("/static/"):
            # Prevent stale JS/CSS during active development; keep other assets cacheable.
            ext = os.path.splitext(parsed_path.path)[1].lower()
            if ext in (".js", ".css", ".map"):
                cache_seconds = 0
            else:
                cache_seconds = 86400
            self._serve_static_file(parsed_path.path.lstrip("/"), cache_seconds=cache_seconds)
            return

        if parsed_path.path == "/aircraft.svg":
            self._serve_static_file("static/aircraft.svg", cache_seconds=86400)
            return

        # The React client owns navigation. Serve its shell for unknown routes
        # whenever a production build is available.
        if os.path.exists(os.path.join(FRONTEND_DIST_DIR, "index.html")):
            self._serve_frontend_file("index.html", cache_seconds=0)
            return

        super().do_GET()

    def _handle_api_request(self, path, query_params):
        try:
            if path == "/api/health":
                self.send_json_response(200, self.handle_health())
                return

            if path == "/api/search-airports":
                query = query_params.get("q", [""])[0].strip()
                limit = _safe_int(query_params.get("limit", ["15"])[0], default=15)
                limit = max(1, min(limit, 100))
                self.send_json_response(200, self.handle_search_airports(query, limit))
                return

            if path == "/api/airports":
                self.send_json_response(200, self.handle_get_popular_airports())
                return

            if path in ("/api/flights", "/api/fetch-flights"):
                airport = query_params.get("airport", ["LFPG"])[0]
                date_str = query_params.get("date", [datetime.now(timezone.utc).strftime("%Y-%m-%d")])[0]
                mode = query_params.get("mode", ["departure"])[0]
                payload = self.handle_flights(airport, date_str, mode)
                self.send_json_response(200, payload)
                return

            if path == "/api/live-flights":
                lamin = query_params.get("lamin", [None])[0]
                lomin = query_params.get("lomin", [None])[0]
                lamax = query_params.get("lamax", [None])[0]
                lomax = query_params.get("lomax", [None])[0]
                time_param = query_params.get("time", [None])[0]

                if None in (lamin, lomin, lamax, lomax):
                    raise ValueError("Missing bounding box parameters: lamin, lomin, lamax, lomax")

                payload = self.handle_live_flights(lamin, lomin, lamax, lomax, time_param)
                self.send_json_response(200, payload)
                return

            if path == "/api/flight-info":
                icao24 = query_params.get("icao24", [""])[0]
                payload = self.handle_flight_info(icao24)
                self.send_json_response(200, payload)
                return

            if path == "/api/track":
                icao24 = query_params.get("icao24", [""])[0]
                time_param = query_params.get("time", ["0"])[0]
                payload = self.handle_track(icao24, time_param)
                self.send_json_response(200, payload)
                return

            self.send_error_response(404, f"Unknown API endpoint: {path}")

        except ValueError as exc:
            self.send_error_response(400, str(exc))
        except OpenSkyAPIError as exc:
            status = exc.status_code if exc.status_code in (400, 401, 403, 404, 429) else 502
            self.send_error_response(status, str(exc), details=exc.payload)
        except Exception as exc:
            self.send_error_response(500, str(exc))

    def send_json_response(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def send_error_response(self, status_code, message, details=None):
        payload = {"success": False, "error": message}
        if details:
            payload["details"] = details
        self.send_json_response(status_code, payload)

    def _serve_static_file(self, relative_path, cache_seconds=0):
        target = os.path.join(BASE_DIR, relative_path)
        target = os.path.abspath(target)

        # Prevent path traversal
        if not target.startswith(os.path.abspath(BASE_DIR)):
            self.send_error_response(403, "Forbidden")
            return

        if not os.path.exists(target) or not os.path.isfile(target):
            self.send_error_response(404, f"File not found: {relative_path}")
            return

        mime_type = mimetypes.guess_type(target)[0] or "application/octet-stream"

        with open(target, "rb") as fh:
            self.send_response(200)
            self.send_header("Content-type", mime_type)
            if cache_seconds > 0:
                self.send_header("Cache-Control", f"public, max-age={cache_seconds}")
            else:
                self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(fh.read())

    def _serve_frontend_file(self, relative_path, cache_seconds=0):
        target = os.path.abspath(os.path.join(FRONTEND_DIST_DIR, relative_path))
        dist_root = os.path.abspath(FRONTEND_DIST_DIR)

        if not target.startswith(dist_root + os.sep) and target != dist_root:
            self.send_error_response(403, "Forbidden")
            return

        if not os.path.isfile(target):
            self.send_error_response(404, f"Frontend file not found: {relative_path}")
            return

        mime_type = mimetypes.guess_type(target)[0] or "application/octet-stream"
        with open(target, "rb") as fh:
            self.send_response(200)
            self.send_header("Content-type", mime_type)
            self.send_header("Cache-Control", f"public, max-age={cache_seconds}" if cache_seconds else "no-store")
            self.end_headers()
            self.wfile.write(fh.read())

    def handle_health(self):
        return {
            "success": True,
            "airports_loaded": len(ALL_AIRPORTS),
            "credentials_configured": api_client.credentials_available(),
            "server_time_utc": datetime.now(timezone.utc).isoformat(),
        }

    def _airport_payload(self, icao):
        record = ALL_AIRPORTS.get(icao)
        if not record:
            return {
                "icao": icao,
                "iata": "",
                "name": icao,
                "display_name": icao,
                "country": "",
                "region": "",
                "latitude": None,
                "longitude": None,
            }

        return {
            "icao": icao,
            "iata": record.get("iata", ""),
            "name": record.get("name") or icao,
            "display_name": record.get("display_name") or icao,
            "country": record.get("country", ""),
            "region": record.get("region", ""),
            "latitude": _safe_float(record.get("latitude")),
            "longitude": _safe_float(record.get("longitude")),
        }

    def handle_search_airports(self, query, limit):
        if not query:
            return self.handle_get_popular_airports()[: min(limit, 12)]

        results = search_airports(query, limit=limit)
        return [self._airport_payload(icao) for icao, _ in results]

    def handle_get_popular_airports(self):
        return [self._airport_payload(icao) for icao in POPULAR_AIRPORTS if icao in ALL_AIRPORTS]

    def _state_row_to_object(self, row):
        def idx(i):
            return row[i] if len(row) > i else None

        return {
            "icao24": idx(0),
            "callsign": (idx(1) or "").strip(),
            "origin_country": idx(2),
            "time_position": idx(3),
            "last_contact": idx(4),
            "longitude": idx(5),
            "latitude": idx(6),
            "baro_altitude": idx(7),
            "on_ground": idx(8),
            "velocity": idx(9),
            "true_track": idx(10),
            "vertical_rate": idx(11),
            "sensors": idx(12),
            "geo_altitude": idx(13),
            "squawk": idx(14),
            "spi": idx(15),
            "position_source": idx(16),
            "category": idx(17),
        }

    def _parse_states(self, states_list):
        parsed = []
        for state in states_list or []:
            if len(state) > 6 and state[5] is not None and state[6] is not None:
                parsed.append(self._state_row_to_object(state))
        return parsed

    def _airport_name(self, icao):
        if not icao:
            return None
        entry = ALL_AIRPORTS.get(str(icao).upper())
        return entry.get("display_name") if entry else str(icao).upper()

    def _normalize_flight(self, flight, mode):
        callsign = (flight.get("callsign") or "").strip()
        airline_code = ""
        if len(callsign) >= 3:
            code = "".join(ch for ch in callsign[:3] if ch.isalpha())
            airline_code = code.upper()

        departure_airport = (flight.get("estDepartureAirport") or "").strip().upper() or None
        arrival_airport = (flight.get("estArrivalAirport") or "").strip().upper() or None
        first_seen = _safe_int(flight.get("firstSeen"))
        last_seen = _safe_int(flight.get("lastSeen"))
        primary_time = first_seen if mode == "departure" else last_seen
        if primary_time is None:
            primary_time = first_seen or last_seen

        normalized = {
            "icao24": (flight.get("icao24") or "").strip().lower(),
            "callsign": callsign,
            "airline_code": airline_code,
            "airline_name": get_airline_name(airline_code) if airline_code else "",
            "first_seen": first_seen,
            "last_seen": last_seen,
            "first_seen_iso": _iso_from_timestamp(first_seen),
            "last_seen_iso": _iso_from_timestamp(last_seen),
            "primary_time": primary_time,
            "primary_time_iso": _iso_from_timestamp(primary_time),
            "departure_airport": departure_airport,
            "departure_airport_name": self._airport_name(departure_airport),
            "arrival_airport": arrival_airport,
            "arrival_airport_name": self._airport_name(arrival_airport),
            "status": "unknown",
            "latitude": None,
            "longitude": None,
            "baro_altitude": None,
            "geo_altitude": None,
            "velocity": None,
            "true_track": None,
            "vertical_rate": None,
            "on_ground": None,
            "category": None,
            # Backward compatibility for previous frontend fields
            "dep_timestamp": first_seen,
            "dep_time_local": _iso_from_timestamp(first_seen),
            "arr_airport": arrival_airport,
        }

        return normalized

    def _enrich_live_states(self, flights):
        if not flights:
            return

        now_ts = int(time.time())

        candidates = []
        for flight in flights:
            icao24 = flight.get("icao24")
            anchor_time = flight.get("last_seen") or flight.get("first_seen")
            if not icao24 or anchor_time is None:
                continue

            # Live state vectors are useful mostly for recent movements.
            if now_ts - anchor_time <= 36 * 3600:
                candidates.append(icao24)

        if not candidates:
            return

        unique_candidates = sorted(set(candidates))
        state_by_icao = {}

        for chunk in _chunked(unique_candidates, 50):
            states_payload = api_client.get_states(icao24_list=chunk, extended=True)
            for state_row in states_payload.get("states", []) or []:
                state = self._state_row_to_object(state_row)
                if state.get("icao24"):
                    state_by_icao[state["icao24"].lower()] = state

        for flight in flights:
            icao = flight.get("icao24")
            if not icao:
                continue

            state = state_by_icao.get(icao)
            if not state:
                # If no live state now, infer a broad status from timestamps.
                if flight.get("last_seen") and now_ts - flight["last_seen"] > 3600:
                    flight["status"] = "completed"
                continue

            flight.update(
                {
                    "latitude": state.get("latitude"),
                    "longitude": state.get("longitude"),
                    "baro_altitude": state.get("baro_altitude"),
                    "geo_altitude": state.get("geo_altitude"),
                    "velocity": state.get("velocity"),
                    "true_track": state.get("true_track"),
                    "vertical_rate": state.get("vertical_rate"),
                    "on_ground": state.get("on_ground"),
                    "category": state.get("category"),
                    "last_contact": state.get("last_contact"),
                }
            )

            if state.get("on_ground") is True:
                flight["status"] = "on_ground"
            elif state.get("on_ground") is False:
                flight["status"] = "airborne"
            else:
                flight["status"] = "unknown"

    def handle_flights(self, airport_icao, date_str, mode):
        airport = _validate_airport_icao(airport_icao)
        target_date = _parse_utc_date(date_str)

        mode_normalized = (mode or "departure").strip().lower()
        if mode_normalized not in ("departure", "arrival"):
            raise ValueError("mode must be either 'departure' or 'arrival'.")

        start_utc = datetime.combine(target_date, datetime.min.time(), tzinfo=timezone.utc)
        end_utc = start_utc + timedelta(days=1)

        begin_ts = int(start_utc.timestamp())
        end_ts = int(end_utc.timestamp())

        if mode_normalized == "arrival":
            records = api_client.get_arrivals(airport, begin_ts, end_ts)
        else:
            records = api_client.get_departures(airport, begin_ts, end_ts)

        flights = [self._normalize_flight(flight, mode_normalized) for flight in (records or [])]

        # Remove malformed records without icao24.
        flights = [f for f in flights if f.get("icao24")]

        self._enrich_live_states(flights)

        sort_key = "first_seen" if mode_normalized == "departure" else "last_seen"
        flights.sort(key=lambda item: item.get(sort_key) or 0, reverse=True)

        unique_airlines = {
            flight.get("airline_code")
            for flight in flights
            if flight.get("airline_code") and flight.get("airline_code") != ""
        }
        summary = {
            "total": len(flights),
            "live_airborne": sum(1 for f in flights if f.get("status") == "airborne"),
            "live_on_ground": sum(1 for f in flights if f.get("status") == "on_ground"),
            "unique_airlines": len(unique_airlines),
        }

        return {
            "success": True,
            "airport": airport,
            "airport_meta": self._airport_payload(airport),
            "airport_name": self._airport_name(airport),
            "mode": mode_normalized,
            "date": target_date.isoformat(),
            "date_basis": "UTC",
            "count": len(flights),
            "summary": summary,
            "flights": flights,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    def handle_live_flights(self, lamin, lomin, lamax, lomax, time_param=None):
        bbox = (
            _safe_float(lamin),
            _safe_float(lomin),
            _safe_float(lamax),
            _safe_float(lomax),
        )

        if None in bbox:
            raise ValueError("Bounding box values must be valid numbers.")

        lat_min, lon_min, lat_max, lon_max = bbox
        if lat_min < -90 or lat_max > 90 or lon_min < -180 or lon_max > 180:
            raise ValueError("Bounding box is outside valid latitude/longitude ranges.")
        if lat_min >= lat_max or lon_min >= lon_max:
            raise ValueError("Invalid bounding box ordering.")

        time_sec = _safe_int(time_param) if time_param else None
        states = api_client.get_states(bbox=bbox, extended=True, time_sec=time_sec)
        parsed_states = self._parse_states(states.get("states", []) if isinstance(states, dict) else [])

        return {
            "success": True,
            "time": states.get("time") if isinstance(states, dict) else None,
            "time_iso": _iso_from_timestamp(states.get("time") if isinstance(states, dict) else None),
            "count": len(parsed_states),
            "states": parsed_states,
        }

    def handle_flight_info(self, icao24):
        code = _validate_icao24(icao24)

        current_state = None
        states = api_client.get_states(icao24_list=[code], extended=True)
        if states and states.get("states"):
            current_state = self._state_row_to_object(states["states"][0])

        end_time = int(time.time())
        # Keep the interval to 24h to avoid spilling over >2 day partitions.
        begin_time = end_time - 24 * 3600
        flights = api_client.get_flights_by_aircraft(code, begin_time, end_time)

        most_recent = None
        if flights:
            flights_sorted = sorted(flights, key=lambda f: _safe_int(f.get("lastSeen"), 0))
            most_recent = flights_sorted[-1]

        departure_airport = (most_recent.get("estDepartureAirport") if most_recent else None) or None
        arrival_airport = (most_recent.get("estArrivalAirport") if most_recent else None) or None

        payload = {
            "success": True,
            "icao24": code,
            "callsign": ((most_recent or {}).get("callsign") or "").strip() or (current_state or {}).get("callsign", ""),
            "departure_airport": departure_airport,
            "departure_airport_name": self._airport_name(departure_airport),
            "arrival_airport": arrival_airport,
            "arrival_airport_name": self._airport_name(arrival_airport),
            "first_seen": _safe_int((most_recent or {}).get("firstSeen")),
            "last_seen": _safe_int((most_recent or {}).get("lastSeen")),
            "first_seen_iso": _iso_from_timestamp((most_recent or {}).get("firstSeen")),
            "last_seen_iso": _iso_from_timestamp((most_recent or {}).get("lastSeen")),
            "live_state": current_state,
        }

        if current_state:
            payload.update(
                {
                    "latitude": current_state.get("latitude"),
                    "longitude": current_state.get("longitude"),
                    "baro_altitude": current_state.get("baro_altitude"),
                    "geo_altitude": current_state.get("geo_altitude"),
                    "velocity": current_state.get("velocity"),
                    "true_track": current_state.get("true_track"),
                    "vertical_rate": current_state.get("vertical_rate"),
                    "on_ground": current_state.get("on_ground"),
                    "status": "on_ground" if current_state.get("on_ground") else "airborne",
                }
            )

        return payload

    def _track_for_candidate_times(self, icao24, candidate_times):
        seen = set()
        attempted = []
        best_empty = {}

        for raw_time in candidate_times:
            t = _safe_int(raw_time, default=None)
            if t is None or t < 0:
                continue
            if t in seen:
                continue
            seen.add(t)
            attempted.append(t)

            try:
                track = api_client.get_track(icao24, t) or {}
            except OpenSkyAPIError:
                # Don't let a single failed timestamp abort all attempts
                continue
            except Exception:
                # Unexpected error (e.g. non-dict response) — skip this timestamp
                continue

            # Guard against non-dict responses (e.g. plain-text error pages)
            if not isinstance(track, dict):
                continue

            if track.get("path"):
                return track, attempted, t
            if not best_empty:
                best_empty = track

        return best_empty, attempted, None

    def handle_track(self, icao24, time_param):
        code = _validate_icao24(icao24)
        track_time = _safe_int(time_param, default=0)
        if track_time is None:
            raise ValueError("time must be an integer Unix timestamp")

        if os.getenv("VERCEL"):
            return {
                "success": True,
                "track": {},
                "path_count": 0,
                "message": "Historical tracks are unavailable from the serverless deployment.",
                "attempted_times": [],
            }

        # Try the requested timestamp first, then fall back to live track (time=0).
        first_candidates = [track_time]
        if track_time != 0:
            first_candidates.append(0)

        track_data, attempted_times, resolved_time = self._track_for_candidate_times(code, first_candidates)

        # If still empty, use recent aircraft flights to infer better timestamps.
        if not track_data or not track_data.get("path"):
            try:
                end_time = int(time.time())
                begin_time = end_time - 24 * 3600
                flights = api_client.get_flights_by_aircraft(code, begin_time, end_time)

                if flights:
                    recent = sorted(flights, key=lambda f: _safe_int(f.get("lastSeen"), 0), reverse=True)[:3]
                    inferred_candidates = []
                    for flight in recent:
                        first_seen = _safe_int(flight.get("firstSeen"), default=None)
                        last_seen = _safe_int(flight.get("lastSeen"), default=None)
                        if first_seen is not None:
                            inferred_candidates.extend([first_seen, first_seen + 60])
                        if last_seen is not None:
                            inferred_candidates.extend([last_seen, max(0, last_seen - 60)])

                    inferred_track, inferred_attempts, inferred_resolved = self._track_for_candidate_times(code, inferred_candidates)
                    attempted_times.extend(inferred_attempts)
                    if inferred_track and inferred_track.get("path"):
                        track_data = inferred_track
                        resolved_time = inferred_resolved
            except OpenSkyAPIError:
                # Secondary flight lookup failed; continue with what we have
                pass

        if not track_data or not track_data.get("path"):
            return {
                "success": True,
                "track": track_data or {},
                "path_count": 0,
                "message": "No track data available for this request.",
                "attempted_times": attempted_times,
            }

        path = track_data.get("path", [])
        altitudes = [p[3] for p in path if len(p) > 3 and p[3] is not None]

        summary = {
            "path_count": len(path),
            "start_time": track_data.get("startTime"),
            "end_time": track_data.get("endTime"),
            "start_time_iso": _iso_from_timestamp(track_data.get("startTime")),
            "end_time_iso": _iso_from_timestamp(track_data.get("endTime")),
            "duration_seconds": (
                _safe_int(track_data.get("endTime"), 0) - _safe_int(track_data.get("startTime"), 0)
                if track_data.get("startTime") is not None and track_data.get("endTime") is not None
                else None
            ),
            "max_altitude_m": max(altitudes) if altitudes else None,
            "min_altitude_m": min(altitudes) if altitudes else None,
        }

        return {
            "success": True,
            "track": track_data,
            "summary": summary,
            "path_count": len(path),
            "resolved_time": resolved_time,
            "attempted_times": attempted_times,
        }



def run_server():
    with ThreadingTCPServer(("", PORT), FlightServerHandler) as httpd:
        print("\n" + "=" * 64)
        print("OpenSky Flight Intelligence Server")
        print("=" * 64)
        print(f"Server URL: http://localhost:{PORT}")
        print(f"Credentials configured: {'yes' if api_client.credentials_available() else 'no'}")
        print("Press Ctrl+C to stop")
        print("=" * 64 + "\n")

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    run_server()
