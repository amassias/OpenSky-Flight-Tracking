"""Vercel ASGI entry point for the existing OpenSky service layer."""

import logging
from typing import Callable, TypeVar

from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse

from api_client import OpenSkyAPIError
from server import FlightServerHandler


app = FastAPI(
    title="SkyTrace API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

service = object.__new__(FlightServerHandler)
T = TypeVar("T")


def execute(operation: Callable[[], T]):
    try:
        return operation()
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"success": False, "error": str(exc)})
    except OpenSkyAPIError as exc:
        status = exc.status_code if exc.status_code in (400, 401, 403, 404, 429) else 502
        payload = {"success": False, "error": str(exc)}
        if exc.payload:
            payload["details"] = exc.payload
        return JSONResponse(status_code=status, content=payload)
    except Exception:
        # Keep internals (paths, upstream URLs) in the function logs, not the response.
        logging.exception("Unhandled SkyTrace API error")
        return JSONResponse(status_code=500, content={"success": False, "error": "Internal server error."})


@app.get("/health")
@app.get("/api/health")
def health():
    return execute(service.handle_health)


@app.get("/search-airports")
@app.get("/api/search-airports")
def search_airports(q: str = "", limit: int = Query(default=15, ge=1, le=100)):
    return execute(lambda: service.handle_search_airports(q.strip(), limit))


@app.get("/airports")
@app.get("/api/airports")
def airports():
    return execute(service.handle_get_popular_airports)


@app.get("/api/map-airports")
def map_airports():
    result = execute(service.handle_get_map_airports)
    if isinstance(result, JSONResponse):
        return result
    return JSONResponse(content=result, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/airport-conditions")
def airport_conditions(airport: str = ""):
    result = execute(lambda: service.handle_airport_conditions(airport))
    if isinstance(result, JSONResponse):
        return result
    # Weather is cached upstream for five minutes; let the CDN share it briefly.
    return JSONResponse(content=result, headers={"Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300"})


@app.get("/api/airport-board")
def airport_board(airport: str = ""):
    result = execute(lambda: service.handle_airport_board(airport))
    if isinstance(result, JSONResponse):
        return result
    return JSONResponse(content=result, headers={"Cache-Control": "public, max-age=10, s-maxage=15, stale-while-revalidate=30"})


@app.get("/fetch-flights")
@app.get("/api/fetch-flights")
@app.get("/flights")
@app.get("/api/flights")
def flights(airport: str = "LFPG", date: str = "", mode: str = "departure"):
    from datetime import datetime, timezone

    selected_date = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return execute(lambda: service.handle_flights(airport, selected_date, mode))


@app.get("/live-flights")
@app.get("/api/live-flights")
def live_flights(
    lamin: float,
    lomin: float,
    lamax: float,
    lomax: float,
    time: int | None = None,
    fallback: bool = False,
):
    return execute(lambda: service.handle_live_flights(lamin, lomin, lamax, lomax, time, fallback))


@app.get("/flight-info")
@app.get("/api/flight-info")
def flight_info(icao24: str = "", callsign: str = ""):
    return execute(lambda: service.handle_flight_info(icao24, callsign))


@app.get("/track")
@app.get("/api/track")
def track(icao24: str = "", time: int = 0):
    return execute(lambda: service.handle_track(icao24, time))
