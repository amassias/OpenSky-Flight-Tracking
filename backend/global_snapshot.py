"""Global snapshot: every aircraft in the world from one shared OpenSky call.

See ADR 0008. One `/states/all` request without a bounding box costs 4 OpenSky
credits. All visitors share it: the CDN caches the response and this module
holds the last snapshot so a cold CDN edge or a second function instance in the
same process never triggers another upstream call within the cadence.

Calls happen only when a visitor asks, so the cadence slows to nothing when
nobody is connected. A hard daily credit budget stops the calls even if the
cadence is misconfigured; the last snapshot is served, labelled with its age,
and never erased.
"""

import math
import os
import threading
import time
from typing import Any, Callable, Dict, List, Literal, Optional

from backend.api_client import OpenSkyAPIError

# Why a Global snapshot is stale: the credit budget or an upstream rate limit ("quota"),
# or OpenSky failing ("provider"). The browser reads the same two words.
DegradedReason = Literal["quota", "provider"]

GLOBAL_CALL_CREDITS = 4
ANONYMOUS_DAILY_BUDGET = 400
DEFAULT_DAILY_BUDGET = 3000
SECONDS_PER_DAY = 86_400
# After a failed OpenSky call, wait this long before the next visitor triggers another.
FAILURE_COOLDOWN_SECONDS = 60
PUBLISHED_REFRESH_SECONDS = 60

# Compact row layout; `fields` is sent with every payload so clients never
# depend on positions.
FIELDS = [
    "icao24", "callsign", "latitude", "longitude", "baro_altitude", "geo_altitude",
    "velocity", "true_track", "vertical_rate", "on_ground", "squawk", "category",
    "source", "fix_age",
]
# OpenSky position_source codes (state vector index 16).
POSITION_SOURCES = {0: "adsb", 1: "asterix", 2: "mlat", 3: "flarm"}


def _daily_budget() -> int:
    try:
        value = int(float(os.getenv("SKYTRACE_OPENSKY_DAILY_BUDGET", str(DEFAULT_DAILY_BUDGET))))
    except (TypeError, ValueError):
        value = DEFAULT_DAILY_BUDGET
    return max(GLOBAL_CALL_CREDITS, min(4000, value))


def _round(value: Any, digits: int) -> Optional[float]:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    rounded = round(float(value), digits)
    return int(rounded) if digits == 0 else rounded


def _compact_row(state: List[Any], snapshot_time: int) -> Optional[list]:
    def at(position: int):
        return state[position] if len(state) > position else None

    longitude, latitude = at(5), at(6)
    if not isinstance(longitude, (int, float)) or not isinstance(latitude, (int, float)):
        return None
    time_position = at(3)
    # An unknown fix time stays unknown; the client must never project it.
    fix_age = max(0, int(snapshot_time - time_position)) if isinstance(time_position, (int, float)) else None
    return [
        at(0),
        (at(1) or "").strip(),
        _round(latitude, 3),
        _round(longitude, 3),
        _round(at(7), 0),
        _round(at(13), 0),
        _round(at(9), 1),
        _round(at(10), 0),
        _round(at(11), 1),
        1 if at(8) else 0,
        at(14),
        at(17),
        POSITION_SOURCES.get(at(16), "opensky"),
        fix_age,
    ]


class GlobalSnapshot:
    def __init__(
        self,
        fetch: Callable[[], Dict[str, Any]],
        *,
        clock: Callable[[], float] = time.time,
        daily_budget: Optional[int] = None,
        refresh_seconds: Optional[int] = None,
    ):
        self._fetch = fetch
        self._clock = clock
        self._daily_budget = daily_budget if daily_budget is not None else _daily_budget()
        self._refresh_override = refresh_seconds
        self._anonymous = False
        self._snapshot: Optional[Dict[str, Any]] = None
        self._fetched_at = 0.0
        self._spend_day = -1
        self._spent = 0
        self._next_call_cost = GLOBAL_CALL_CREDITS
        self._retry_after = 0.0
        self._last_error: Optional[OpenSkyAPIError] = None
        self._lock = threading.Lock()

    @property
    def refresh_seconds(self) -> int:
        """Seconds between upstream calls that keep the daily credit budget."""
        budget = min(self._daily_budget, ANONYMOUS_DAILY_BUDGET) if self._anonymous else self._daily_budget
        interval = math.ceil(SECONDS_PER_DAY * GLOBAL_CALL_CREDITS / budget)
        if self._next_call_cost == 0:
            # Reading the published snapshot is free; only its own cadence limits us.
            return self._refresh_override or PUBLISHED_REFRESH_SECONDS
        if self._refresh_override and not self._anonymous:
            return self._refresh_override
        return interval

    def _spent_today(self, now: float) -> int:
        day = int(now // SECONDS_PER_DAY)
        if day != self._spend_day:
            self._spend_day, self._spent = day, 0
        return self._spent

    def _payload(self, now: float, *, degraded_notice: Optional[str] = None, reason: Optional[DegradedReason] = None) -> Dict[str, Any]:
        assert self._snapshot is not None
        # `age_seconds` is true when the answer is built only; `time` is the absolute snapshot time.
        age = max(0, int(now - self._fetched_at))
        payload = {**self._snapshot, "age_seconds": age, "refresh_after_seconds": self.refresh_seconds}
        if degraded_notice:
            payload["degraded"] = True
            payload["degraded_reason"] = reason
            # No relative age in the text: a CDN may serve this answer later. Clients age the snapshot from `time`.
            payload["notice"] = degraded_notice
        return payload

    def get(self) -> Dict[str, Any]:
        """Return the current snapshot, refreshing it when the cadence allows."""
        with self._lock:
            now = self._clock()
            if self._snapshot is not None and now - self._fetched_at < self.refresh_seconds:
                return self._payload(now)

            if self._spent_today(now) + self._next_call_cost > self._daily_budget:
                if self._snapshot is None:
                    raise OpenSkyAPIError("OpenSky daily credit budget used up.", status_code=429)
                return self._payload(now, degraded_notice="Daily OpenSky credit budget reached. Showing the last snapshot.", reason="quota")

            if now < self._retry_after and self._last_error is not None:
                # OpenSky just failed. Do not make every visitor wait out the
                # same timeout while holding the lock.
                if self._snapshot is None:
                    raise self._last_error
                return self._payload(now, degraded_notice="Live refresh delayed. Showing the last snapshot.", reason="provider")

            try:
                result = self._fetch()
            except OpenSkyAPIError as exc:
                if exc.status_code != 429:
                    self._retry_after = now + FAILURE_COOLDOWN_SECONDS
                    self._last_error = exc
                if self._snapshot is None:
                    raise
                if exc.status_code == 429:
                    return self._payload(now, degraded_notice="OpenSky rate limit reached. Showing the last snapshot.", reason="quota")
                return self._payload(now, degraded_notice="Live refresh delayed. Showing the last snapshot.", reason="provider")

            self._retry_after = 0.0
            self._last_error = None
            self._next_call_cost = result.get("credit_cost", GLOBAL_CALL_CREDITS)
            self._spent += result.get("credit_cost", GLOBAL_CALL_CREDITS)
            self._anonymous = result.get("provider") == "opensky-anonymous"
            snapshot_time = result.get("time") or int(now)
            rows = (_compact_row(state, snapshot_time) for state in result.get("states") or [] if isinstance(state, list))
            aircraft = [row for row in rows if row is not None]
            self._snapshot = {
                "success": True,
                "provider": result.get("provider") or "opensky",
                "credit_cost": result.get("credit_cost", GLOBAL_CALL_CREDITS),
                "time": snapshot_time,
                "count": len(aircraft),
                "fields": FIELDS,
                "aircraft": aircraft,
            }
            self._fetched_at = now
            return self._payload(now)
