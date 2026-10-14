from datetime import date

import pytest

from flight_logic import _chunked, _operations_match_current_flight, _parse_utc_date, _safe_float, _safe_int


def test_safe_conversions_fall_back_on_bad_input():
    assert _safe_int("12") == 12
    assert _safe_int("x", 7) == 7
    assert _safe_float(None, 1.5) == 1.5
    assert _safe_float("2.5") == 2.5


def test_chunked_splits_evenly_with_remainder():
    assert [list(c) for c in _chunked([1, 2, 3, 4, 5], 2)] == [[1, 2], [3, 4], [5]]


def test_parse_utc_date_rejects_garbage():
    assert _parse_utc_date("2026-10-14") == date(2026, 10, 14)
    with pytest.raises(ValueError):
        _parse_utc_date("14/10/2026")


def test_operations_must_match_callsign_and_recent_window():
    ops = {"ident": "AFR123", "actual_out": "2026-10-14T10:00:00Z"}
    start = 1_791_972_000  # 2026-10-14T10:00:00Z
    assert _operations_match_current_flight(ops, "AFR123", now=start + 3600)
    assert not _operations_match_current_flight(ops, "AFR999", now=start + 3600)
    assert not _operations_match_current_flight(ops, "AFR123", now=start + 40 * 3600)
