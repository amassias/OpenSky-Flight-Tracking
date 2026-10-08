from datetime import datetime, timezone
from unittest.mock import Mock, patch

import pytest
import requests
import timetable as t
from fastapi.testclient import TestClient
from api.index import app

NOW = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)
AIRPORT = {'icao': 'ENGM', 'iata': 'OSL'}
XML = b'''<airport name="OSL"><flights lastUpdate="2026-10-08T11:59:00Z">
<flight uniqueID="1"><flight_id>SK100</flight_id><arr_dep>D</arr_dep><airport>TRD</airport><airline>SK</airline><schedule_time>2026-10-08T13:00:00Z</schedule_time><status code="E" time="2026-10-08T13:40:00Z"/><gate>A20</gate></flight>
<flight uniqueID="2"><flight_id>SK200</flight_id><arr_dep>A</arr_dep><schedule_time>2026-10-08T10:00:00Z</schedule_time><status code="A" time="2026-10-08T10:05:00Z"/></flight>
<flight uniqueID="3"><flight_id>SK300</flight_id><arr_dep>D</arr_dep><schedule_time>2026-10-08T14:00:00Z</schedule_time><est_time>2026-10-08T14:30:00Z</est_time><status code="C"/></flight>
<flight uniqueID="4"><flight_id>SK400</flight_id><arr_dep>D</arr_dep><schedule_time>2026-10-08T15:00:00Z</schedule_time><status code="N" time="2026-10-08T16:00:00Z"/></flight>
<flight uniqueID="5"><flight_id>SK500</flight_id><arr_dep>D</arr_dep><schedule_time>2026-10-09T00:00:00Z</schedule_time><status code="D" time="2026-10-09T00:03:00Z"/></flight>
</flights></airport>'''

@pytest.fixture(autouse=True)
def clear_cache():
    t._cache.clear()
    t._failures.clear()
    yield
    t._cache.clear()
    t._failures.clear()


def test_parser_preserves_status_semantics():
    flights = t.parse_feed(XML, 'OSL', {'TRD': 'Trondheim'})['flights']
    assert flights[0]['delay_minutes'] == 40
    assert flights[0]['other_airport_name'] == 'Trondheim'
    assert flights[0]['gate'] == 'A20'
    assert flights[1]['actual'] == '2026-10-08T10:05:00Z'
    assert flights[2]['status'] == 'cancelled'
    assert flights[2]['estimated'] is None and flights[2]['delay_minutes'] is None
    assert flights[3]['estimated'] is None
    assert flights[3]['next_information'] == '2026-10-08T16:00:00Z'
    assert flights[4]['actual_event'] == 'off-block'


def test_cache_shared_between_directions_and_dates():
    with patch.object(t.requests, 'get', return_value=Mock(content=XML)) as fetch:
        dep = t.get_timetable(AIRPORT, '2026-10-08', 'departure', {}, NOW)
        arr = t.get_timetable(AIRPORT, '2026-10-08', 'arrival', {}, NOW)
        tomorrow = t.get_timetable(AIRPORT, '2026-10-09', 'departure', {}, NOW)
    assert fetch.call_count == 1
    assert len(dep['flights']) == 3 and len(arr['flights']) == 1
    assert tomorrow['flights'][0]['flight_number'] == 'SK500'
    assert fetch.call_args.kwargs['params'] == {'airport': 'OSL', 'TimeFrom': 96, 'TimeTo': 144}


def test_failure_backoff_and_stale_limit():
    payload = t.parse_feed(XML, 'OSL', {})
    payload['fetched_at'] = NOW.isoformat()
    t._cache['OSL'] = (0, payload)
    with patch.object(t.time, 'monotonic', return_value=200), patch.object(t.requests, 'get', side_effect=requests.Timeout) as fetch:
        assert t.get_timetable(AIRPORT, '2026-10-08', 'departure', {}, NOW)['stale']
        assert t.get_timetable(AIRPORT, '2026-10-08', 'arrival', {}, NOW)['stale']
        assert fetch.call_count == 1
    with patch.object(t.time, 'monotonic', return_value=1000), patch.object(t.requests, 'get', side_effect=requests.Timeout):
        result = t.get_timetable(AIRPORT, '2026-10-08', 'departure', {}, NOW)
    assert result['coverage'] == 'unavailable' and result['flights'] == []


def test_no_network_for_unsupported_or_outside_window():
    with patch.object(t.requests, 'get') as fetch:
        assert t.get_timetable({'icao': 'LFPG', 'iata': 'CDG'}, '2026-10-08', 'departure', {}, NOW)['coverage'] == 'unsupported'
        assert t.get_timetable(AIRPORT, '2026-12-01', 'departure', {}, NOW)['coverage'] == 'out-of-range'
    fetch.assert_not_called()

@pytest.mark.parametrize('xml', [b'<!DOCTYPE airport><airport/>', b'<airport name="CDG"><flights/></airport>', b'<airport name="OSL"/>'])
def test_reject_unexpected_xml(xml):
    with pytest.raises(ValueError):
        t.parse_feed(xml, 'OSL', {})


def test_timezone_normalization_and_missing_values():
    assert t.utc_time('2026-10-25T02:30:00+02:00') == '2026-10-25T00:30:00Z'
    assert t.utc_time('not-a-date') is None
    assert t.utc_time(None) is None


def test_serverless_validation_and_coverage():
    client = TestClient(app)
    for params in [{'airport': 'ZZZZ'}, {'airport': 'ENGM', 'mode': 'anything'}, {'airport': 'LFPG', 'date': 'bad'}]:
        assert client.get('/api/timetable', params=params).status_code == 400
    response = client.get('/api/timetable', params={'airport': 'LFPG', 'date': '2026-10-08'})
    assert response.json()['coverage'] == 'unsupported'
    assert 's-maxage=180' in response.headers['cache-control']
