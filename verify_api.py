import requests
import json
from datetime import datetime

BASE_URL = "http://localhost:8000/api"

def test_search_airports():
    print("\nTesting /api/search-airports...")
    try:
        response = requests.get(f"{BASE_URL}/search-airports?q=Paris")
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Success: Found {len(data)} airports matching 'Paris'")
        else:
            print(f"❌ Failed: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"❌ Error: {e}")

def test_fetch_flights():
    print("\nTesting /api/fetch-flights (LFPG)...")
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        response = requests.get(f"{BASE_URL}/fetch-flights?airport=LFPG&date={today}")
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                flights = data.get('flights', [])
                print(f"✅ Success: Found {len(flights)} flights departing LFPG")
                if len(flights) == 0:
                    print("⚠️ Warning: No flights found. Check time window or API limits.")
            else:
                print(f"❌ Failed: API returned success=False - {data.get('error')}")
        else:
            print(f"❌ Failed: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"❌ Error: {e}")

def test_live_flights():
    print("\nTesting /api/live-flights (Bounding Box around Paris)...")
    try:
        # Bounding box for Paris area
        lamin = 48.0
        lomin = 2.0
        lamax = 49.0
        lomax = 3.0
        
        response = requests.get(f"{BASE_URL}/live-flights?lamin={lamin}&lomin={lomin}&lamax={lamax}&lomax={lomax}")
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                states = data.get('states', [])
                print(f"✅ Success: Found {len(states)} live flights in Paris area")
            else:
                print(f"❌ Failed: API returned success=False - {data.get('error')}")
        else:
            print(f"❌ Failed: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    print("🔍 Verifying API Endpoints...")
    # We assume the server is running. If not, these will fail.
    test_search_airports()
    test_fetch_flights()
    test_live_flights()
