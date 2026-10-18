#!/usr/bin/env python3
"""Fetch the whole world from OpenSky and write it to a file for publication.

Run by .github/workflows/global-snapshot.yml. Vercel cannot connect to
opensky-network.org, but GitHub runners can, so the runner fetches the snapshot
and publishes it; the app reads the published file (backend/api_client.py).
Uses OAuth2 when OPEN_SKY_CLIENT_ID/OPEN_SKY_CLIENT_SECRET are valid, and
falls back to the anonymous endpoint otherwise. Never overwrites a good file
with a broken one: on any failure it exits non-zero and writes nothing.
"""
import json
import os
import sys
import time
from typing import Any, Optional

import requests

STATES_URL = "https://opensky-network.org/api/states/all"
TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
MIN_AIRCRAFT = 1_000  # the real world is ~10,000; far fewer means a broken response
MAX_AGE_SECONDS = 600


def validate(payload: Any, now: Optional[float] = None) -> Optional[str]:
    """Return why the payload must not be published, or None when it is fine."""
    now = time.time() if now is None else now
    if not isinstance(payload, dict) or not isinstance(payload.get("states"), list):
        return "response has no states list"
    taken_at = payload.get("time")
    if not isinstance(taken_at, (int, float)):
        return "response has no time"
    if now - taken_at > MAX_AGE_SECONDS:
        return f"response is too old ({int(now - taken_at)} s)"
    if len(payload["states"]) < MIN_AIRCRAFT:
        return f"too few aircraft ({len(payload['states'])})"
    return None


def access_token() -> Optional[str]:
    client_id, client_secret = os.getenv("OPEN_SKY_CLIENT_ID"), os.getenv("OPEN_SKY_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None
    response = requests.post(
        TOKEN_URL,
        data={"grant_type": "client_credentials", "client_id": client_id, "client_secret": client_secret},
        timeout=20,
    )
    if not response.ok:
        print(f"OAuth token refused ({response.status_code}); using the anonymous endpoint", file=sys.stderr)
        return None
    return response.json().get("access_token")


def main(output_path: str) -> int:
    token = access_token()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    response = requests.get(STATES_URL, params={"extended": 1}, headers=headers, timeout=60)
    print(
        f"opensky status={response.status_code} auth={'oauth' if token else 'anonymous'} "
        f"bytes={len(response.content)} credits_left={response.headers.get('X-Rate-Limit-Remaining')}"
    )
    if not response.ok:
        return 1
    payload = response.json()
    problem = validate(payload)
    if problem:
        print(f"not publishing: {problem}", file=sys.stderr)
        return 1
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))
    print(f"wrote {len(payload['states'])} aircraft to {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "snapshot.json"))
