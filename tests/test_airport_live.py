from unittest.mock import Mock, patch

import pytest

import airport_live
import server


AIRPORT = {"icao": "LFPG", "latitude": 49.0097, "longitude": 2.5478, "elevation_ft": 392}


def state(icao24, callsign, lat, lon, *, alt=None, speed_kt=0.0, track=None, on_ground=False, vertical_rate=0.0):
    return {
        "icao24": icao24, "callsign": callsign, "latitude": lat, "longitude": lon,
        "baro_altitude": alt, "velocity": speed_kt * 0.514444, "true_track": track,
        "on_ground": on_ground, "vertical_rate": vertical_rate,
    }


ROUTES = {
    "AFR1234": [{"icao": "LFPG", "iata": "CDG"}, {"icao": "EDDB", "iata": "BER", "city": "Berlin"}],
    "EZY37": [{"icao": "LFMN", "iata": "NCE", "city": "Nice"}, {"icao": "LFPG", "iata": "CDG"}],
    "BAW303": [{"icao": "EGLL"}, {"icao": "LFPG"}],
    "DLH1": [{"icao": "EDDF"}, {"icao": "LEMD"}],
    "AFR6": [{"icao": "LFPG"}, {"icao": "KJFK"}],
}


def lookup(callsign):
    return ROUTES.get(callsign)


def test_board_classifies_ground_inbound_and_departed_traffic():
    states = [
        # Taxiing at the airport for Berlin.
        state("a1", "AFR1234", 49.012, 2.55, alt=0, speed_kt=12, on_ground=True),
        # 60 km south, pointing at the field: an arrival from Nice.
        state("a2", "EZY37", 48.47, 2.5478, alt=3000, speed_kt=250, track=0, vertical_rate=-5),
        # Landed: on the ground here with a route that ends here.
        state("a3", "BAW303", 49.005, 2.54, alt=0, speed_kt=3, on_ground=True),
        # Overflight with an unrelated route.
        state("a4", "DLH1", 49.2, 2.6, alt=11000, speed_kt=450, track=200),
        # Climbing out towards New York, 40 km west.
        state("a5", "AFR6", 49.0, 2.0, alt=4000, speed_kt=280, track=280, vertical_rate=10),
    ]
    board = airport_live.build_board(AIRPORT, states, now=1_000_000, lookup=lookup)
    departures = {row["callsign"]: row for row in board["departures"]}
    arrivals = {row["callsign"]: row for row in board["arrivals"]}

    assert departures["AFR1234"]["phase"] == "taxiing"
    assert departures["AFR1234"]["destination"]["icao"] == "EDDB"
    assert departures["AFR6"]["phase"] == "departed"
    assert arrivals["EZY37"]["phase"] == "approach"
    assert arrivals["EZY37"]["origin"]["icao"] == "LFMN"
    # 60 km at 250 kt (463 km/h) is roughly 7.8 minutes.
    assert 7 * 60 <= arrivals["EZY37"]["eta"] - 1_000_000 <= 9 * 60
    assert arrivals["BAW303"]["phase"] == "landed"
    assert "DLH1" not in departures and "DLH1" not in arrivals
    # Taxiing traffic leads the departures; landed traffic leads the arrivals.
    assert board["departures"][0]["callsign"] == "AFR1234"
    assert board["arrivals"][0]["callsign"] == "BAW303"


def test_board_keeps_ground_traffic_without_a_known_route():
    board = airport_live.build_board(AIRPORT, [state("b1", "XYZ999", 49.01, 2.55, alt=0, speed_kt=0, on_ground=True)], now=0, lookup=lambda _: None)
    assert board["departures"][0]["phase"] == "parked"
    assert board["departures"][0]["route_known"] is False


def test_multi_leg_routes_use_the_leg_touching_the_airport():
    route = [{"icao": "LEVT"}, {"icao": "LFPG"}, {"icao": "EBLG"}]
    legs = airport_live._legs_for(route, "LFPG")
    assert legs["from"]["icao"] == "LEVT"
    assert legs["to"]["icao"] == "EBLG"


def test_wind_favours_the_runway_ends_facing_it():
    runways = [
        {"ends": [{"ident": "09R", "heading": 86.0}, {"ident": "27L", "heading": 266.0}], "length_ft": 13780, "surface": "ASP"},
        {"ends": [{"ident": "09L", "heading": 85.3}, {"ident": "27R", "heading": 265.3}], "length_ft": 8858, "surface": "ASP"},
        {"ends": [{"ident": "08H", "heading": 85.0}, {"ident": "26H", "heading": 265.0}], "length_ft": 1444, "surface": "GRASS"},
    ]
    result = airport_live.runway_wind_components(runways, 250, 12)
    assert result["basis"] == "wind"
    assert set(result["favoured"]) == {"27L", "27R"}
    end = result["runways"][0]["ends"][1]
    assert 11 < end["headwind_kt"] < 12
    assert 3 < end["crosswind_kt"] < 4
    assert airport_live.runway_wind_components(runways, 250, 2)["basis"] == "calm"
    assert airport_live.runway_wind_components(runways, None, None)["favoured"] == []


def test_metar_normalisation_reads_ceiling_visibility_and_station_distance():
    report = {
        "icaoId": "LFPB", "obsTime": 1, "rawOb": "METAR LFPB", "fltCat": "MVFR", "wdir": "VRB", "wspd": 3,
        "visib": "6+", "clouds": [{"cover": "FEW", "base": 800}, {"cover": "BKN", "base": 2500}],
        "temp": 9, "dewp": 3, "altim": 1024.6, "lat": 48.969, "lon": 2.441,
    }
    weather = airport_live._normalise_metar(report, "LFPG", 49.0097, 2.5478)
    assert weather["ceiling_ft"] == 2500
    assert weather["visibility"] == {"meters": 10000, "at_least": True}
    assert weather["wind_variable"] is True and weather["wind_dir"] is None
    assert weather["qnh_hpa"] == 1025
    assert 8 < weather["station_distance_km"] < 10


FAA_XML = b"""<AIRPORT_STATUS_INFORMATION><Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List>
<Ground_Delay><ARPT>JFK</ARPT><Reason>wind</Reason><Avg>34 minutes</Avg><Max>1 hour</Max></Ground_Delay></Ground_Delay_List></Delay_type>
<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List><Delay><ARPT>MIA</ARPT><Reason>WX</Reason>
<Arrival_Departure Type="Departure"><Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay></Arrival_Departure_Delay_List></Delay_type>
</AIRPORT_STATUS_INFORMATION>"""


def test_faa_status_is_matched_by_iata_and_k_prefixed_icao():
    airport_live._cache.pop("faa", None)
    response = Mock(status_code=200, content=FAA_XML)
    with patch.object(airport_live._session, "get", return_value=response):
        jfk = airport_live.faa_delays("KJFK", "JFK")
        mia = airport_live.faa_delays("KMIA", "")
    airport_live._cache.pop("faa", None)
    assert jfk == [{"category": "Ground Delay Programs", "reason": "wind", "avg": "34 minutes", "max": "1 hour"}]
    assert mia[0]["direction"] == "Departure" and mia[0]["trend"] == "Increasing"
    assert airport_live.faa_covers("KJFK", "US") and not airport_live.faa_covers("LFPG", "FR")


def test_airport_details_include_runways_and_frequencies():
    details = airport_live.airport_details("LFPG")
    idents = {end["ident"] for runway in details["runways"] for end in runway["ends"]}
    assert {"09R", "27L"} <= idents
    assert any(frequency["type"] == "ATIS" for frequency in details["frequencies"])
    assert details["elevation_ft"] == 392


def handler():
    return object.__new__(server.FlightServerHandler)


def test_conditions_survive_a_weather_outage():
    with patch.object(airport_live, "fetch_weather", side_effect=RuntimeError("down")):
        payload = handler().handle_airport_conditions("LFPG")
    assert payload["weather"] is None
    assert payload["unavailable"] == ["weather"]
    assert payload["runways"] and payload["delays"] is None


def test_airport_board_uses_one_point_request_around_the_airport():
    rows = [["a1b2c3", "AFR1234 ", "France", 100, 100, 2.55, 49.012, 0.0, True, 6.0, 90.0, 0.0, None, None, None, False, 0, None, {}]]
    with patch.object(server.api_client, "get_live_point_states", return_value={"time": 100, "states": rows, "provider": "adsb.lol"}) as fetch, \
         patch.object(airport_live, "callsign_route", side_effect=lookup):
        payload = handler().handle_airport_board("lfpg")
    fetch.assert_called_once()
    assert fetch.call_args.args[2] == airport_live.BOARD_RADIUS_NM
    assert payload["departures"][0]["callsign"] == "AFR1234"
    assert payload["departures"][0]["airline_name"] == "Air France"


def test_airport_board_falls_back_when_the_public_provider_is_rate_limited():
    from api_client import OpenSkyAPIError

    server.BOARD_RESPONSE_CACHE.clear()
    rows = [["a1b2c3", "AFR1234 ", "France", 100, 100, 2.55, 49.012, 0.0, True, 6.0, 90.0, 0.0, None, None, None, False, 0, None, {}]]
    limited = OpenSkyAPIError("Live aircraft providers are rate limited.", status_code=429)
    with patch.object(server.api_client, "get_live_point_states", side_effect=limited), \
         patch.object(server.api_client, "get_states", return_value={"time": 100, "states": rows}), \
         patch.object(airport_live, "callsign_route", side_effect=lookup):
        payload = handler().handle_airport_board("LFPG")
    assert payload["degraded"] is True
    assert payload["departures"][0]["callsign"] == "AFR1234"

    # With every source down, the last board is served, still marked degraded.
    with patch.object(server.api_client, "get_live_point_states", side_effect=limited), \
         patch.object(server.api_client, "get_states", side_effect=limited), \
         patch.object(server.FlightServerHandler, "_cached_live_states_for_bbox", return_value=None):
        stale = handler().handle_airport_board("LFPG")
    assert stale["degraded"] is True and stale["departures"][0]["callsign"] == "AFR1234"

    server.BOARD_RESPONSE_CACHE.clear()
    with patch.object(server.api_client, "get_live_point_states", side_effect=limited), \
         patch.object(server.api_client, "get_states", side_effect=limited), \
         patch.object(server.FlightServerHandler, "_cached_live_states_for_bbox", return_value=None):
        with pytest.raises(OpenSkyAPIError):
            handler().handle_airport_board("LFPG")
