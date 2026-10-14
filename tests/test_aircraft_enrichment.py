import re
from datetime import date
from unittest.mock import patch

import pytest
from aircraft_enrichment import CABINS, aircraft_enrichment
from server import FlightServerHandler


def test_catalogue_totals_sources_and_unknowns():
    for item in CABINS:
        assert sum(c["seats"] for c in item["classes"]) == item["total_seats"]
        assert item["source"]["url"].startswith("https://")
        assert item["source"]["checked_at"]
    assert aircraft_enrichment("ZZZ", "A320")["configurations"] == []
    assert {c["total_seats"] for c in aircraft_enrichment("AFR", "A320")["configurations"]} == {174, 178}
    assert {c["total_seats"] for c in aircraft_enrichment("SWA", "B738")["configurations"]} == {175}


def test_catalogue_is_consistent():
    ids = [item["id"] for item in CABINS]
    assert len(ids) == len(set(ids))
    variants = [(tuple(item["operators"]), item["aircraft_type"], item["total_seats"]) for item in CABINS]
    assert len(variants) == len(set(variants))
    known = {"First", "Business", "Premium Economy", "Economy", "Flexible Business / Economy"}
    for item in CABINS:
        assert item["classes"] and all(c["seats"] > 0 for c in item["classes"]), item["id"]
        assert {c["name"] for c in item["classes"]} <= known, item["id"]
        assert len({c["name"] for c in item["classes"]}) == len(item["classes"]), item["id"]
        assert re.fullmatch(r"[A-Z0-9]{3,4}", item["aircraft_type"]), item["id"]
        assert all(re.fullmatch(r"[A-Z]{3}", op) for op in item["operators"]), item["id"]
        assert date.fromisoformat(item["source"]["checked_at"]) <= date.today(), item["id"]
        assert item["seat_map_url"].startswith("https://"), item["id"]


def test_variants_are_never_presented_as_airframe_matches():
    result = aircraft_enrichment("AFR", "A359", "F-HTYA")
    assert result["match_level"] == "operator_type"
    assert {c["total_seats"] for c in result["configurations"]} == {292, 324}
    assert len(aircraft_enrichment("EJU", "A320")["configurations"]) == 2
    assert aircraft_enrichment("EJU", "A20N")["configurations"][0]["total_seats"] == 186


def test_route_is_independent_of_profile_and_operations():
    handler = object.__new__(FlightServerHandler)
    with patch("server.api_client.get_callsign_route", return_value={"route_source": "callsign", "departure_latitude": 49}), patch("server.api_client.get_aircraft_profile") as profile, patch("server.api_client.get_flightaware_details") as operations:
        assert handler.handle_flight_route("afr123")["departure_latitude"] == 49
        profile.assert_not_called()
        operations.assert_not_called()
    with pytest.raises(ValueError):
        handler.handle_flight_route("../invalid")
    with pytest.raises(ValueError):
        aircraft_enrichment("AFR", "<script>")
