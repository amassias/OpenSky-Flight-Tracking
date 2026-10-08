"""Real-time airport information from free, keyless public sources.

Everything here is observed or reported *now*; nothing is a timetable:

* Weather: the latest METAR and TAF from the NOAA Aviation Weather Center
  (https://aviationweather.gov/data/api/), public domain, no key.
* US delay programmes, ground stops and closures from the FAA NAS Status feed
  (https://nasstatus.faa.gov/), public domain, no key.
* Runways and frequencies from the bundled OurAirports snapshot
  (data/airport-details.json, public domain).
* Departures and arrivals observed by ADS-B around the airport, with each
  callsign's usual route from the adsb.lol / VRS standing-data route files
  (https://github.com/adsblol/vrs-standing-data, CORS-enabled static files).

Upstream calls are cached per process so a panel refresh cannot turn into a
burst of provider requests, and every section fails independently.
"""

import json
import math
import os
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional

import requests

USER_AGENT = "SkyTrace/2.0 (+https://github.com/amassias/OpenSky-Flight-Tracking; airport live board)"
DETAILS_PATH = os.path.join(os.path.dirname(__file__), "data", "airport-details.json")

WEATHER_TTL_SECONDS = 300
FAA_TTL_SECONDS = 120
ROUTE_TTL_SECONDS = 6 * 3600
ROUTE_MISS_TTL_SECONDS = 1800
# The public ADS-B point API caps a circle at 250 NM; 150 NM keeps one request
# per board while giving inbound flights roughly half an hour of warning.
BOARD_RADIUS_NM = 150
AIRPORT_RADIUS_KM = 5.0
MAX_ROUTE_LOOKUPS = 60
# Climb-out turns can point a departure anywhere; within this radius any
# airborne aircraft whose route starts here, and is not coming back, counts.
DEPARTED_RADIUS_KM = 120

_session = requests.Session()
_cache: Dict[str, tuple] = {}
_cache_lock = threading.Lock()
_details: Optional[Dict[str, Any]] = None
_details_lock = threading.Lock()


def _cached(key: str, ttl: float, loader: Callable[[], Any]) -> Any:
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    value = loader()
    with _cache_lock:
        if len(_cache) > 4096:
            for stale in [item for item, entry in _cache.items() if entry[0] <= now][:2048]:
                _cache.pop(stale, None)
        _cache[key] = (now + ttl, value)
    return value


def _get(url: str, *, params=None, timeout: float = 6.0) -> requests.Response:
    return _session.get(url, params=params, timeout=timeout, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)
    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def angle_between(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


# ---------------------------------------------------------------------------
# Static details (runways, frequencies)
# ---------------------------------------------------------------------------

def airport_details(icao: str) -> Dict[str, Any]:
    global _details
    if _details is None:
        with _details_lock:
            if _details is None:
                try:
                    with open(DETAILS_PATH, encoding="utf-8") as handle:
                        _details = json.load(handle).get("airports", {})
                except (OSError, ValueError):
                    _details = {}
    entry = _details.get(icao) or {}
    runways = []
    for le, he, length, width, surface, lighted, le_heading, he_heading in entry.get("runways", []):
        runways.append({
            "ends": [
                {"ident": le, "heading": le_heading if le_heading is not None else _heading_from_ident(le)},
                *([{"ident": he, "heading": he_heading if he_heading is not None else _heading_from_ident(he)}] if he else []),
            ],
            "length_ft": length,
            "width_ft": width,
            "surface": surface,
            "lighted": bool(lighted),
        })
    return {
        "elevation_ft": entry.get("elevation_ft"),
        "wikipedia": entry.get("wikipedia"),
        "runways": runways,
        "frequencies": [{"type": kind, "description": description, "mhz": mhz} for kind, description, mhz in entry.get("frequencies", [])],
    }


def _heading_from_ident(ident: Optional[str]) -> Optional[float]:
    digits = "".join(character for character in str(ident or "")[:2] if character.isdigit())
    return float(int(digits) * 10 % 360) if digits else None


HARD_SURFACES = ("ASP", "CON", "PEM", "BIT", "TAR", "ASF", "PAV", "BET", "MAC", "COP")


def runway_wind_components(runways: List[Dict[str, Any]], wind_dir: Optional[float], wind_kt: Optional[float]) -> Dict[str, Any]:
    """Headwind and crosswind for every runway end, and the ends favoured by the wind.

    This is an estimate: ATC also picks runways for noise, traffic flow and
    preferential procedures, so the UI labels it as wind-favoured, not "in use".
    """
    if wind_dir is None or wind_kt is None:
        return {"runways": runways, "favoured": [], "basis": "no-wind"}
    hard = [runway for runway in runways if any(code in (runway.get("surface") or "").upper() for code in HARD_SURFACES)]
    candidates = hard or runways
    longest = max((runway.get("length_ft") or 0 for runway in candidates), default=0)
    # Short secondary strips rarely carry the airport's main traffic.
    candidates = [runway for runway in candidates if (runway.get("length_ft") or 0) >= longest * 0.5]
    enriched = []
    for runway in runways:
        ends = []
        for end in runway["ends"]:
            heading = end.get("heading")
            if heading is None:
                ends.append(dict(end))
                continue
            radians = math.radians(wind_dir - heading)
            ends.append({**end, "headwind_kt": round(wind_kt * math.cos(radians), 1), "crosswind_kt": round(abs(wind_kt * math.sin(radians)), 1)})
        enriched.append({**runway, "ends": ends})
    if wind_kt < 3:
        return {"runways": enriched, "favoured": [], "basis": "calm"}
    best = None
    for runway in enriched:
        if not any(runway["ends"][0]["ident"] == other["ends"][0]["ident"] for other in candidates):
            continue
        for end in runway["ends"]:
            if end.get("headwind_kt") is not None and (best is None or end["headwind_kt"] > best["headwind_kt"]):
                best = end
    if not best:
        return {"runways": enriched, "favoured": [], "basis": "no-geometry"}
    # Parallel runways share the favoured direction (26L/26R/27L/27R).
    favoured = [
        end["ident"] for runway in enriched if any(runway["ends"][0]["ident"] == other["ends"][0]["ident"] for other in candidates)
        for end in runway["ends"]
        if end.get("heading") is not None and angle_between(end["heading"], best["heading"]) <= 10
    ]
    return {"runways": enriched, "favoured": favoured, "basis": "wind"}


# ---------------------------------------------------------------------------
# Weather (NOAA Aviation Weather Center)
# ---------------------------------------------------------------------------

def _visibility_m(value: Any) -> Optional[Dict[str, Any]]:
    if value is None or value == "":
        return None
    text = str(value).strip()
    plus = text.endswith("+")
    try:
        miles = float(text.rstrip("+"))
    except ValueError:
        return None
    # "6+" is the AWC's rendering of P6SM / 9999: at least 10 km.
    meters = 10_000 if plus and miles >= 6 else round(miles * 1609.34)
    return {"meters": meters, "at_least": plus}


def _normalise_metar(report: Dict[str, Any], icao: str, airport_lat: float, airport_lon: float) -> Dict[str, Any]:
    clouds = [
        {"cover": layer.get("cover"), "base_ft": layer.get("base")}
        for layer in report.get("clouds") or [] if isinstance(layer, dict) and layer.get("cover")
    ]
    ceiling = min((layer["base_ft"] for layer in clouds if layer["cover"] in ("BKN", "OVC", "OVX") and layer["base_ft"] is not None), default=None)
    wind_dir = report.get("wdir")
    station_lat, station_lon = report.get("lat"), report.get("lon")
    distance = distance_km(airport_lat, airport_lon, station_lat, station_lon) if isinstance(station_lat, (int, float)) and isinstance(station_lon, (int, float)) else None
    return {
        "station": report.get("icaoId"),
        "station_name": report.get("name"),
        "station_distance_km": round(distance, 1) if distance is not None and report.get("icaoId") != icao else None,
        "observed_at": report.get("obsTime"),
        "raw": report.get("rawOb"),
        "flight_category": report.get("fltCat"),
        "wind_dir": wind_dir if isinstance(wind_dir, (int, float)) else None,
        "wind_variable": wind_dir == "VRB",
        "wind_kt": report.get("wspd"),
        "gust_kt": report.get("wgst"),
        "visibility": _visibility_m(report.get("visib")),
        "cover": report.get("cover"),
        "clouds": clouds,
        "ceiling_ft": ceiling,
        "temperature_c": report.get("temp"),
        "dewpoint_c": report.get("dewp"),
        "qnh_hpa": round(report["altim"]) if isinstance(report.get("altim"), (int, float)) else None,
        "weather": report.get("wxString"),
        "taf": report.get("rawTaf"),
    }


def fetch_weather(icao: str, latitude: Optional[float], longitude: Optional[float]) -> Optional[Dict[str, Any]]:
    def load():
        url = "https://aviationweather.gov/api/data/metar"
        response = _get(url, params={"ids": icao, "format": "json", "taf": "true"})
        reports = response.json() if response.status_code == 200 and response.content else []
        if not reports and latitude is not None and longitude is not None:
            # Many smaller airports have no METAR: use the nearest reporting
            # station within ~50 km and say which one it is.
            box = f"{latitude - 0.5:.3f},{longitude - 0.7:.3f},{latitude + 0.5:.3f},{longitude + 0.7:.3f}"
            response = _get(url, params={"bbox": box, "format": "json", "taf": "true"})
            nearby = response.json() if response.status_code == 200 and response.content else []
            nearby = [item for item in nearby if isinstance(item.get("lat"), (int, float)) and isinstance(item.get("lon"), (int, float))]
            nearby.sort(key=lambda item: distance_km(latitude, longitude, item["lat"], item["lon"]))
            reports = [item for item in nearby[:1] if distance_km(latitude, longitude, item["lat"], item["lon"]) <= 50]
        if not reports:
            return None
        return _normalise_metar(reports[0], icao, latitude or reports[0].get("lat"), longitude or reports[0].get("lon"))

    return _cached(f"wx:{icao}", WEATHER_TTL_SECONDS, load)


# ---------------------------------------------------------------------------
# FAA National Airspace System status
# ---------------------------------------------------------------------------

def _faa_status() -> Dict[str, List[Dict[str, Any]]]:
    def load():
        response = _get("https://nasstatus.faa.gov/api/airport-status-information", timeout=5)
        response.raise_for_status()
        root = ET.fromstring(response.content)
        by_airport: Dict[str, List[Dict[str, Any]]] = {}
        for delay_type in root.findall("Delay_type"):
            category = (delay_type.findtext("Name") or "").strip()
            for item in delay_type.iter():
                code = item.findtext("ARPT")
                if not code or item.find("ARPT") is None:
                    continue
                entry: Dict[str, Any] = {"category": category}
                for child in item:
                    if child.tag == "ARPT":
                        continue
                    if len(child):
                        entry["direction"] = child.get("Type")
                        for leaf in child:
                            entry[leaf.tag.lower()] = (leaf.text or "").strip()
                    else:
                        entry[child.tag.lower()] = (child.text or "").strip()
                by_airport.setdefault(code.strip().upper(), []).append(entry)
        return by_airport

    return _cached("faa", FAA_TTL_SECONDS, load)


def faa_delays(icao: str, iata: str) -> List[Dict[str, Any]]:
    codes = {code for code in (iata, icao[1:] if icao.startswith("K") else None) if code}
    if not codes:
        return []
    status = _faa_status()
    return [entry for code in codes for entry in status.get(code.upper(), [])]


def faa_covers(icao: str, country: str) -> bool:
    return country in ("US", "PR", "GU", "VI", "AS", "MP") or icao.startswith(("K", "PH", "PA"))


# ---------------------------------------------------------------------------
# Live departures and arrivals
# ---------------------------------------------------------------------------

def callsign_route(callsign: str) -> Optional[List[Dict[str, Any]]]:
    """Ordered airports of a callsign's usual route, or None when unknown."""
    callsign = "".join(callsign.upper().split())
    if len(callsign) < 3 or not callsign.isalnum():
        return None

    def load():
        try:
            response = _get(f"https://vrs-standing-data.adsb.lol/routes/{callsign[:2]}/{callsign}.json", timeout=4)
        except requests.RequestException:
            return None
        if response.status_code != 200:
            return None
        try:
            payload = response.json()
        except ValueError:
            return None
        airports = [
            {"icao": item.get("icao"), "iata": item.get("iata"), "name": item.get("name"), "city": item.get("location"),
             "latitude": item.get("lat"), "longitude": item.get("lon")}
            for item in payload.get("_airports") or [] if isinstance(item, dict) and item.get("icao")
        ]
        return airports or None

    key = f"route:{callsign}"
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > time.time():
            return hit[1]
    value = load()
    with _cache_lock:
        _cache[key] = (time.time() + (ROUTE_TTL_SECONDS if value else ROUTE_MISS_TTL_SECONDS), value)
    return value


def _route_cached(callsign: str) -> tuple:
    key = f"route:{''.join(callsign.upper().split())}"
    with _cache_lock:
        hit = _cache.get(key)
    return (True, hit[1]) if hit and hit[0] > time.time() else (False, None)


def _legs_for(route: List[Dict[str, Any]], icao: str) -> Dict[str, Any]:
    """Origin and destination of the leg touching this airport on a multi-leg route."""
    codes = [airport["icao"] for airport in route]
    result: Dict[str, Any] = {}
    if icao in codes:
        index = codes.index(icao)
        if index + 1 < len(route):
            result["to"] = route[index + 1]
        if index > 0:
            result["from"] = route[index - 1]
    return result


def _ground_phase(speed_kt: Optional[float]) -> str:
    # Stationary ADS-B ground speed jitters by a few knots; taxiing is faster.
    return "taxiing" if speed_kt is not None and speed_kt >= 5 else "parked"


def build_board(airport: Dict[str, Any], states: List[Dict[str, Any]], now: int, *, lookup: Optional[Callable[[str], Optional[list]]] = None) -> Dict[str, Any]:
    """Classify live aircraft around an airport into departures and arrivals."""
    lookup = lookup or callsign_route
    icao = airport["icao"]
    lat, lon = airport["latitude"], airport["longitude"]
    elevation_m = (airport.get("elevation_ft") or 0) * 0.3048
    candidates = []
    for state in states:
        a_lat, a_lon = state.get("latitude"), state.get("longitude")
        if a_lat is None or a_lon is None:
            continue
        callsign = (state.get("callsign") or "").strip()
        distance = distance_km(lat, lon, a_lat, a_lon)
        speed_kt = state["velocity"] / 0.514444 if isinstance(state.get("velocity"), (int, float)) else None
        altitude = state.get("baro_altitude") if state.get("baro_altitude") is not None else state.get("geo_altitude")
        height_m = altitude - elevation_m if isinstance(altitude, (int, float)) else None
        on_ground = state.get("on_ground") is True or (height_m is not None and height_m < 60 and (speed_kt or 0) < 60)
        at_airport = distance <= AIRPORT_RADIUS_KM and on_ground
        bearing_to = bearing_deg(a_lat, a_lon, lat, lon)
        track = state.get("true_track")
        heading_in = track is not None and angle_between(track, bearing_to) <= 40
        # Vectored traffic (downwind, base) is not pointing at the field yet.
        descending_nearby = distance <= 60 and height_m is not None and height_m < 3000 and (state.get("vertical_rate") or 0) < -1
        candidates.append({
            "state": state, "callsign": callsign, "distance_km": distance, "speed_kt": speed_kt,
            "height_m": height_m, "on_ground": on_ground, "at_airport": at_airport,
            "heading_in": heading_in or descending_nearby,
        })

    # Only aircraft that could belong to this airport cost a route lookup;
    # nearest first so a busy sky still resolves the board's top rows.
    relevant = [
        item for item in candidates
        if item["callsign"] and (item["at_airport"] or (not item["on_ground"] and (item["heading_in"] or item["distance_km"] <= DEPARTED_RADIUS_KM)))
    ]
    relevant.sort(key=lambda item: item["distance_km"])
    needed = []
    routes: Dict[str, Optional[list]] = {}
    for callsign in dict.fromkeys(item["callsign"] for item in relevant):
        known, route = _route_cached(callsign) if lookup is callsign_route else (False, None)
        if known:
            routes[callsign] = route
        else:
            needed.append(callsign)
    # Lookups beyond the budget resolve on the next refresh, from the cache.
    pending = needed[:MAX_ROUTE_LOOKUPS]
    if pending:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for callsign, route in zip(pending, pool.map(lookup, pending)):
                routes[callsign] = route

    departures, arrivals = [], []
    for item in relevant:
        state = item["state"]
        route = routes.get(item["callsign"])
        legs = _legs_for(route, icao) if route else {}
        row = {
            "icao24": state.get("icao24"),
            "callsign": item["callsign"],
            "airline_code": state.get("airline_code"),
            "airline_name": state.get("airline_name"),
            "registration": state.get("registration"),
            "aircraft_type": state.get("aircraft_type"),
            "latitude": state.get("latitude"),
            "longitude": state.get("longitude"),
            "baro_altitude": state.get("baro_altitude"),
            "velocity": state.get("velocity"),
            "vertical_rate": state.get("vertical_rate"),
            "true_track": state.get("true_track"),
            "on_ground": item["on_ground"],
            "squawk": state.get("squawk"),
            "category": state.get("category"),
            "time_position": state.get("time_position"),
            "last_contact": state.get("last_contact"),
            "distance_km": round(item["distance_km"], 1),
            "route_known": route is not None,
        }
        if item["at_airport"]:
            if legs.get("to"):
                departures.append({**row, "phase": _ground_phase(item["speed_kt"]), "destination": legs["to"], "origin": None})
            elif legs.get("from"):
                arrivals.append({**row, "phase": "landed", "origin": legs["from"], "destination": None})
            else:
                departures.append({**row, "phase": _ground_phase(item["speed_kt"]), "destination": None, "origin": None})
            continue
        if item["on_ground"]:
            continue
        if legs.get("from") and item["heading_in"]:
            speed_kmh = (item["speed_kt"] or 0) * 1.852
            eta = now + int(item["distance_km"] / speed_kmh * 3600) if speed_kmh > 80 else None
            near = item["distance_km"] <= 25 and (item["height_m"] or 0) < 1500
            arrivals.append({**row, "phase": "final" if near else "approach" if item["distance_km"] <= 80 else "inbound",
                             "origin": legs["from"], "destination": None, "eta": eta})
        elif legs.get("to") and not item["heading_in"] and item["distance_km"] <= DEPARTED_RADIUS_KM:
            departures.append({**row, "phase": "departed", "destination": legs["to"], "origin": None})

    phase_order = {"taxiing": 0, "parked": 1, "departed": 2}
    departures.sort(key=lambda row: (phase_order.get(row["phase"], 3), row["distance_km"]))
    arrivals.sort(key=lambda row: (row["phase"] != "landed", row.get("eta") or now + 10**6))
    return {
        "departures": departures,
        "arrivals": arrivals,
        "radius_nm": BOARD_RADIUS_NM,
        "aircraft_scanned": len(candidates),
        "routes_pending": len(needed) - len(pending),
    }
