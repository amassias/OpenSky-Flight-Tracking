from backend import flightaware
from backend.api_client import OpenSkyClient


def test_ident_strips_punctuation_and_caps_length():
    assert flightaware._flightaware_ident("af-1234 ") == "AF1234"
    assert flightaware._flightaware_ident(None) == ""
    assert len(flightaware._flightaware_ident("A" * 40)) == 16


def test_provider_timestamp_accepts_iso_and_milliseconds():
    assert flightaware._provider_timestamp("2026-10-14T10:00:00Z") == 1_791_972_000
    assert flightaware._provider_timestamp(1_791_972_000_000) == 1_791_972_000
    assert flightaware._provider_timestamp("garbage") is None


def test_client_keeps_the_historical_names():
    assert OpenSkyClient._flightaware_ident("a b") == "AB"
