"""The scheduled workflow must never publish a broken or empty world."""
import importlib.util
import pathlib

import pytest

spec = importlib.util.spec_from_file_location(
    "publish_global_snapshot", pathlib.Path(__file__).parent.parent / "scripts" / "publish_global_snapshot.py"
)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

NOW = 1_750_000_000


def world(count=5_000, taken_at=NOW):
    return {"time": taken_at, "states": [[f"{i:06x}", "CALL", "FR", taken_at, taken_at, 2.0, 48.0] for i in range(count)]}


def test_a_complete_recent_world_is_accepted():
    assert publisher.validate(world(), now=NOW + 30) is None


@pytest.mark.parametrize("payload", [None, [], {"states": []}, {"time": NOW}, {"time": "x", "states": []}])
def test_a_malformed_response_is_rejected(payload):
    assert publisher.validate(payload, now=NOW) is not None


def test_a_suspiciously_small_world_is_rejected_so_it_cannot_overwrite_a_good_one():
    assert "too few" in publisher.validate(world(count=50), now=NOW)


def test_an_old_response_is_rejected():
    assert "old" in publisher.validate(world(taken_at=NOW - 3600), now=NOW)
