import time
from datetime import datetime, timedelta
from api_client import OpenSkyClient

def test_api():
    print("Testing OpenSkyClient...")
    client = OpenSkyClient()
    
    # Test 1: Authentication (implicit in other calls)
    print("\n1. Testing Authentication & State Vectors (LFPG area)...")
    try:
        # Bounding box for Paris area roughly
        bbox = (48.0, 2.0, 50.0, 3.0) 
        states = client.get_states(bbox=bbox)
        print(f"Success! Retrieved {len(states.get('states', []))} states.")
        if states.get('states'):
            print(f"Sample state: {states['states'][0]}")
    except Exception as e:
        print(f"Failed: {e}")

    # Test 2: Departures
    print("\n2. Testing Departures (LFPG, last 2 hours)...")
    try:
        end = time.time()
        begin = end - 7200 # 2 hours ago
        departures = client.get_departures("LFPG", begin, end)
        print(f"Success! Retrieved {len(departures)} departures.")
        if departures:
            print(f"Sample departure: {departures[0]}")
            
            # Test 3: Track (using a flight from departures if available)
            flight = departures[0]
            if flight.get('icao24'):
                print(f"\n3. Testing Track for icao24 {flight['icao24']}...")
                # Use a time slightly after firstSeen
                track_time = flight['firstSeen'] + 60
                try:
                    track = client.get_track(flight['icao24'], track_time)
                    print(f"Success! Track points: {len(track.get('path', []))}")
                except Exception as e:
                    print(f"Failed to get track (might be too recent or no coverage): {e}")
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    test_api()
