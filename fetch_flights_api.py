#!/usr/bin/env python3
"""
API pour récupérer les vols sans créer de fichiers CSV
Usage: python3 fetch_flights_api.py --airport LFPG --date 2025-10-29
Retourne: JSON sur stdout
"""
import os
import json
import argparse
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import requests
from dotenv import load_dotenv
from data_loader import load_airports, get_airline_name

# Configuration
load_dotenv()

CLIENT_ID = os.getenv("OPEN_SKY_CLIENT_ID")
CLIENT_SECRET = os.getenv("OPEN_SKY_CLIENT_SECRET")

if not CLIENT_ID or not CLIENT_SECRET:
    print(json.dumps({"error": "OpenSky credentials missing in .env"}), flush=True)
    exit(1)

OPENSKY_TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
)
OPENSKY_API = "https://opensky-network.org/api"

# Load all airports from CSV
ALL_AIRPORTS = load_airports()

PARIS_TZ = ZoneInfo("Europe/Paris")


def get_token():
    """Obtient un access token OAuth2."""
    data = {
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
    }
    response = requests.post(OPENSKY_TOKEN_URL, data=data, timeout=15)
    response.raise_for_status()
    return response.json()["access_token"]


def fetch_departures(airport_icao, begin_utc, end_utc, token):
    """Appelle l'API OpenSky pour obtenir les départs."""
    headers = {"Authorization": f"Bearer {token}"}
    params = {
        "airport": airport_icao,
        "begin": int(begin_utc.timestamp()),
        "end": int(end_utc.timestamp()),
    }
    url = f"{OPENSKY_API}/flights/departure"
    response = requests.get(url, headers=headers, params=params, timeout=30)
    response.raise_for_status()
    return response.json()


def fetch_departures_with_refresh(airport_icao, begin_utc, end_utc):
    """Fetch avec refresh automatique du token en cas d'expiration."""
    token = get_token()
    try:
        return fetch_departures(airport_icao, begin_utc, end_utc, token)
    except requests.HTTPError as e:
        if e.response.status_code == 401:
            token = get_token()
            return fetch_departures(airport_icao, begin_utc, end_utc, token)
        raise


def build_query_window_utc(target_date):
    """Construit une fenêtre de 24h en UTC pour couvrir la date locale."""
    start_local = datetime.combine(target_date, datetime.min.time()).replace(tzinfo=PARIS_TZ)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def filter_to_paris_date(flights, target_date):
    """Filtre les vols pour ne garder que ceux de la date locale."""
    filtered = []
    for flight in flights:
        if not flight.get("firstSeen"):
            continue
        
        dt_utc = datetime.fromtimestamp(flight["firstSeen"], tz=timezone.utc)
        dt_paris = dt_utc.astimezone(PARIS_TZ)
        
        if dt_paris.date() == target_date:
            # Extract airline code (first 3 characters of callsign)
            callsign = (flight.get("callsign") or "").strip()
            airline_code = callsign[:3] if len(callsign) >= 3 else ""
            airline_name = get_airline_name(airline_code) if airline_code else ""
            
            filtered.append({
                "callsign": callsign,
                "icao24": flight.get("icao24", ""),
                "dep_time_local": dt_paris.isoformat(),
                "arr_airport": flight.get("estArrivalAirport", ""),
                "airline_code": airline_code,
                "airline_name": airline_name,
            })
    
    return sorted(filtered, key=lambda x: x["dep_time_local"], reverse=True)


def main():
    parser = argparse.ArgumentParser(
        description="Récupère les vols au départ d'un aéroport (JSON output)"
    )
    parser.add_argument(
        "--airport",
        type=str,
        default="LFPG",
        help="Code ICAO de l'aéroport (défaut: LFPG)"
    )
    parser.add_argument(
        "--date",
        type=str,
        help="Date au format YYYY-MM-DD (défaut: hier)"
    )
    
    args = parser.parse_args()
    
    airport_icao = args.airport.upper()
    
    # Validation de l'aéroport (check if exists in loaded airports)
    if airport_icao not in ALL_AIRPORTS:
        print(json.dumps({
            "error": f"Airport {airport_icao} not found in database",
            "message": "Please use a valid ICAO code"
        }), flush=True)
        exit(1)
    
    # Parse date
    if args.date:
        try:
            target_date = datetime.strptime(args.date, "%Y-%m-%d").date()
        except ValueError:
            print(json.dumps({"error": "Invalid date format. Use YYYY-MM-DD"}), flush=True)
            exit(1)
    else:
        target_date = (datetime.now(PARIS_TZ) - timedelta(days=1)).date()
    
    # Fetch data
    try:
        begin_utc, end_utc = build_query_window_utc(target_date)
        raw_flights = fetch_departures_with_refresh(airport_icao, begin_utc, end_utc)
        filtered_flights = filter_to_paris_date(raw_flights, target_date)
        
        # Get airport display name
        airport_info = ALL_AIRPORTS.get(airport_icao, {})
        airport_display = airport_info.get('display_name', airport_icao)
        
        # Output JSON
        result = {
            "success": True,
            "airport": airport_icao,
            "airport_name": airport_display,
            "date": target_date.isoformat(),
            "flights": filtered_flights,
            "count": len(filtered_flights)
        }
        print(json.dumps(result, ensure_ascii=False), flush=True)
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }), flush=True)
        exit(1)


if __name__ == "__main__":
    main()
