import os
import time
from api_client import OpenSkyClient
from dotenv import load_dotenv

load_dotenv()

def verify_track():
    client = OpenSkyClient()
    
    # 1. Get live states to find a valid icao24
    print("Fetching live states...")
    # Bounding box for Europe roughly
    bbox = (40.0, -5.0, 50.0, 20.0)
    states = client.get_states(bbox=bbox)
    
    if not states or not states.get('states'):
        print("No live flights found.")
        return

    # Pick the first one
    first_flight = states['states'][0]
    icao24 = first_flight[0]
    callsign = first_flight[1].strip()
    print(f"Found flight: {callsign} ({icao24})")
    
    # 2. Fetch track
    print(f"Fetching track for {icao24}...")
    # Use current time
    track = client.get_track(icao24, time.time())
    
    if track:
        print("Track data received:")
        print(track.keys())
        if 'path' in track:
            print(f"Path length: {len(track['path'])}")
            if len(track['path']) > 0:
                print("First point sample:", track['path'][0])
                # Expected: [time, lat, lon, baro_altitude, true_track, on_ground]
                # Let's verify the structure
                print("Structure: [time, lat, lon, baro_altitude, true_track, on_ground]")
    else:
        print("No track data found.")

if __name__ == "__main__":
    verify_track()
