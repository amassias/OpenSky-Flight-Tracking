import sys
import os
import time
from datetime import datetime, timedelta, timezone

# Add current directory to path
sys.path.append(os.getcwd())

from api_client import OpenSkyClient

def verify_arrivals():
    print("Verifying Departures...")
    client = OpenSkyClient()
    
    # Test with LFPG (Paris CDG) for yesterday
    yesterday = datetime.now() - timedelta(days=1)
    begin = int(yesterday.replace(hour=12, minute=0, second=0).timestamp())
    end = begin + 3600
    
    print(f"Querying departures for {yesterday.date()} from {datetime.fromtimestamp(begin)} to {datetime.fromtimestamp(end)}")
    
    try:
        departures = client.get_departures("LFPG", begin, end)
        if departures:
            print(f"✅ Successfully fetched {len(departures)} departures for LFPG")
            print(f"Sample departure: {departures[0]}")
        else:
            print("⚠️ No departures found (might be normal depending on time/traffic)")
    except Exception as e:
        print(f"❌ Error fetching departures: {e}")

def verify_categories():
    print("\nVerifying Categories (Extended States)...")
    client = OpenSkyClient()
    
    # Test with a bounding box around Paris
    bbox = (48.0, 2.0, 49.0, 3.0)
    
    try:
        states = client.get_states(bbox=bbox, extended=True)
        if states and 'states' in states and states['states']:
            print(f"✅ Successfully fetched {len(states['states'])} states")
            
            # Check for category field (index 17)
            has_category = False
            for s in states['states']:
                if len(s) > 17 and s[17] is not None:
                    has_category = True
                    print(f"Found aircraft with category: {s[17]} (ICAO: {s[0]})")
                    break
            
            if has_category:
                print("✅ Category field is present and populated")
            else:
                print("⚠️ Category field not found or empty in returned states")
        else:
            print("⚠️ No states found in Paris area")
    except Exception as e:
        print(f"❌ Error fetching states: {e}")

if __name__ == "__main__":
    verify_arrivals()
    verify_categories()
