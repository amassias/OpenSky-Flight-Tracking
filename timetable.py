"""Free Avinor airport timetables. Source terms: https://partner.avinor.no/tjenester/flydata/"""
import json
import os
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import requests

# Verified against the operator's airport selector, 2026-10-08. Private Torp is excluded.
AVINOR_AIRPORTS = frozenset('AES ALF ANX BDU BJF BGO BVG BOO BNN FRO FDE HFT EVE HAA HVG KKN KRS KSU LKL LKN MEH MQN MOL MJF OSY HOV OSL RRS RVK RET SDN SSJ SOG SOJ SVG SKN LYR SVJ TOS TRD VDS VRY VAW'.split())
FEED_URL = 'https://asrv.avinor.no/XmlFeed/v1.0'
CACHE_SECONDS = 180
MAX_STALE_SECONDS = 900
_cache = {}
_failures = {}
_locks = {code: threading.Lock() for code in AVINOR_AIRPORTS}
with open(os.path.join(os.path.dirname(__file__), 'data', 'avinor-airlines.json'), encoding='utf-8') as stream:
    AIRLINES = json.load(stream)


def utc_time(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)  # Feed documentation declares UTC.
        return parsed.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
    except (TypeError, ValueError):
        return None


def parse_feed(content, iata, airport_names):
    if len(content) > 4_000_000 or b'<!DOCTYPE' in content.upper() or b'<!ENTITY' in content.upper():
        raise ValueError('Invalid timetable XML')
    root = ET.fromstring(content)
    flights_element = root.find('flights')
    if root.tag != 'airport' or root.get('name') != iata or flights_element is None:
        raise ValueError('Unexpected timetable airport')
    flights = []
    seen = set()
    for node in flights_element.findall('flight'):
        scheduled = utc_time(node.findtext('schedule_time'))
        flight_number = node.findtext('flight_id') or node.findtext('flightId')
        direction = node.findtext('arr_dep')
        if not scheduled or not flight_number or direction not in ('A', 'D'):
            continue
        status_node = node.find('status')
        code = status_node.get('code', '') if status_node is not None else ''
        status_time = utc_time(status_node.get('time')) if status_node is not None else None
        estimated = utc_time(node.findtext('est_time')) or (status_time if code == 'E' else None)
        if code == 'C':
            estimated = None
        actual = status_time if code in ('A', 'D') else None
        reference = actual or estimated
        delay = max(0, round((datetime.fromisoformat(reference.replace('Z', '+00:00')) - datetime.fromisoformat(scheduled.replace('Z', '+00:00'))).total_seconds() / 60)) if reference and code != 'C' else None
        destination = node.findtext('airport') or ''
        airline = node.findtext('airline') or ''
        identity = node.get('uniqueID') or node.get('uniqueId') or f'{flight_number}-{scheduled}-{direction}'
        if identity in seen:
            continue
        seen.add(identity)
        flights.append({
            'id': identity,
            'flight_number': flight_number, 'airline_code': airline, 'airline_name': AIRLINES.get(airline, airline),
            'direction': direction, 'other_airport': destination, 'other_airport_name': airport_names.get(destination, destination),
            'scheduled': scheduled, 'estimated': estimated, 'actual': actual,
            'actual_event': 'off-block' if code == 'D' else 'arrival' if code == 'A' else None,
            'status': {'A': 'arrived', 'D': 'departed', 'C': 'cancelled', 'E': 'estimated', 'N': 'next-info'}.get(code, 'scheduled' if not code else 'unknown'),
            'status_code': code or None, 'next_information': status_time if code == 'N' else None,
            'delay_minutes': delay, 'delayed': code != 'C' and (node.findtext('delayed') == 'Y' or bool(delay)),
            'gate': node.findtext('gate') or None, 'terminal': node.findtext('terminal') or None,
            'check_in': node.findtext('check_in') or None, 'baggage_belt': node.findtext('belt_number') or None,
        })
    return {'flights': flights, 'updated_at': utc_time(flights_element.get('lastUpdate'))}


def get_timetable(airport, day, mode, airport_names, now=None):
    if mode not in ('arrival', 'departure'):
        raise ValueError('Invalid timetable mode')
    now = now or datetime.now(timezone.utc)
    target = datetime.strptime(day, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    end = target + timedelta(days=1)
    iata = airport.get('iata', '')
    base = {'success': True, 'airport': airport['icao'], 'date': day, 'mode': mode,
            'date_basis': 'UTC', 'provider': None, 'coverage': 'unsupported', 'flights': [],
            'updated_at': None, 'fetched_at': None, 'stale': False, 'refresh_after_seconds': CACHE_SECONDS}
    if iata not in AVINOR_AIRPORTS:
        return {**base, 'notice': 'No free timetable source is connected for this airport. Observed traffic is available separately.'}
    base['provider'] = 'Avinor'
    if target < now - timedelta(hours=96) or end > now + timedelta(hours=144):
        return {**base, 'coverage': 'out-of-range', 'notice': 'This date is outside Avinor’s rolling timetable window (up to 96 hours back and 144 hours ahead).'}
    key = iata
    stale = False
    with _locks[iata]:
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
            payload = cached[1]
        elif time.monotonic() - _failures.get(key, float("-inf")) < CACHE_SECONDS:
            if cached and time.monotonic() - cached[0] < MAX_STALE_SECONDS:
                payload = cached[1]
                stale = True
            else:
                return {**base, "coverage": "unavailable", "notice": "Avinor timetable temporarily unavailable. Try again later or switch to observed traffic."}
        else:
            try:
                response = requests.get(FEED_URL, params={'airport': iata,
                    'TimeFrom': 96, 'TimeTo': 144},
                    timeout=(3, 12), headers={'User-Agent': 'SkyTrace/2.0 (airport timetable; cached 180s)'})
                response.raise_for_status()
                payload = parse_feed(response.content, iata, airport_names)
                payload['fetched_at'] = now.isoformat().replace('+00:00', 'Z')
                _cache[key] = (time.monotonic(), payload)
                _failures.pop(key, None)
                if len(_cache) > 256:
                    oldest = min(_cache, key=lambda item: _cache[item][0])
                    del _cache[oldest]
            except (requests.RequestException, ET.ParseError, ValueError):
                _failures[key] = time.monotonic()
                if cached and time.monotonic() - cached[0] < MAX_STALE_SECONDS:
                    payload = cached[1]
                    stale = True
                else:
                    return {**base, 'coverage': 'unavailable', 'notice': 'Avinor timetable temporarily unavailable. Try again later or switch to observed traffic.'}
    direction = 'D' if mode == 'departure' else 'A'
    flights = sorted((item for item in payload['flights'] if item['direction'] == direction and target <= datetime.fromisoformat(item['scheduled'].replace('Z', '+00:00')) < end), key=lambda item: (item['scheduled'], item['flight_number']))
    return {**base, 'coverage': 'available', 'flights': flights, 'updated_at': payload['updated_at'],
            'fetched_at': payload['fetched_at'], 'stale': stale,
            'notice': 'Refresh failed: showing the last timetable received. Check the airport for updates.' if stale else None}
