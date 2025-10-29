#!/usr/bin/env python3
"""
Airport Departures Web Server - Optimized Version
- No CSV files created during normal fetch
- Direct JSON communication
- Clean file organization
- Support for ALL airports worldwide (7895+ airports)

Run with: python3 server.py
Then open: http://localhost:8000
"""
import http.server
import socketserver
import json
import os
import subprocess
from datetime import datetime
from urllib.parse import urlparse, parse_qs
from dotenv import load_dotenv
from data_loader import load_airports, search_airports

load_dotenv()

PORT = 8000

# Load all airports from CSV
print("🔄 Loading airports database...")
ALL_AIRPORTS = load_airports()
print(f"✅ {len(ALL_AIRPORTS)} airports loaded")

class FlightServerHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urlparse(self.path)
        query_params = parse_qs(parsed_path.query)
        
        # API endpoint to search airports
        if parsed_path.path == '/api/search-airports':
            query = query_params.get('q', [''])[0]
            limit = int(query_params.get('limit', ['100'])[0])
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            if query:
                results = search_airports(query, limit=limit)
                airports_list = [{"icao": icao, "name": name} for icao, name in results]
            else:
                # Return popular airports if no search query
                popular = ['LFPG', 'EGLL', 'EHAM', 'EDDF', 'LEMD', 'LIRF', 'LSZH', 'LFPO', 
                          'KJFK', 'KLAX', 'OMDB', 'RJTT', 'VHHH', 'YSSY']
                airports_list = [
                    {"icao": icao, "name": ALL_AIRPORTS[icao]['display_name']} 
                    for icao in popular if icao in ALL_AIRPORTS
                ]
            
            self.wfile.write(json.dumps(airports_list).encode())
            return
        
        # API endpoint to get airports list (legacy - returns popular airports)
        elif parsed_path.path == '/api/airports':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            # Return popular European airports
            popular = ['LFPG', 'LFPO', 'EGLL', 'EHAM', 'EDDF', 'LEMD', 'LIRF', 'LSZH', 'LOWW', 'EDDM']
            airports_list = [
                {"icao": icao, "name": ALL_AIRPORTS[icao]['display_name']} 
                for icao in popular if icao in ALL_AIRPORTS
            ]
            self.wfile.write(json.dumps(airports_list).encode())
            return
        
        # API endpoint to fetch flights (no CSV created)
        elif parsed_path.path == '/api/fetch-flights':
            airport = query_params.get('airport', ['LFPG'])[0].upper()
            date = query_params.get('date', [datetime.now().strftime('%Y-%m-%d')])[0]
            
            try:
                # Run the optimized API script that returns JSON directly
                result = subprocess.run(
                    ['python3', 'fetch_flights_api.py', '--airport', airport, '--date', date],
                    capture_output=True,
                    text=True,
                    timeout=120
                )
                
                if result.returncode != 0:
                    raise Exception(f"Script failed: {result.stderr}")
                
                # Parse JSON output from script
                flight_data = json.loads(result.stdout)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                self.wfile.write(json.dumps(flight_data).encode())
                
            except json.JSONDecodeError as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                error_response = {
                    "success": False,
                    "error": f"Invalid JSON from script: {str(e)}",
                    "raw_output": result.stdout if 'result' in locals() else ""
                }
                self.wfile.write(json.dumps(error_response).encode())
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                error_response = {
                    "success": False,
                    "error": str(e)
                }
                self.wfile.write(json.dumps(error_response).encode())
            return
        
        # API endpoint to get flight track
        elif parsed_path.path == '/api/track':
            icao24 = query_params.get('icao24', [''])[0]
            time = query_params.get('time', [''])[0]
            
            if not icao24 or not time:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Missing icao24 or time parameter"}).encode())
                return
            
            try:
                # Get OpenSky credentials
                client_id = os.getenv('OPEN_SKY_CLIENT_ID')
                client_secret = os.getenv('OPEN_SKY_CLIENT_SECRET')
                
                if not client_id or not client_secret:
                    raise Exception("OpenSky credentials not configured")
                
                # First, get OAuth2 token
                import requests
                token_url = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
                token_data = {
                    "grant_type": "client_credentials",
                    "client_id": client_id,
                    "client_secret": client_secret
                }
                token_response = requests.post(token_url, data=token_data)
                token_response.raise_for_status()
                access_token = token_response.json()['access_token']
                
                # Get track data
                track_url = f"https://opensky-network.org/api/tracks/all?icao24={icao24}&time={time}"
                headers = {"Authorization": f"Bearer {access_token}"}
                track_response = requests.get(track_url, headers=headers)
                track_response.raise_for_status()
                
                track_data = track_response.json()
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "track": track_data}).encode())
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                error_response = {"success": False, "error": str(e)}
                self.wfile.write(json.dumps(error_response).encode())
            return
        
        # Main page
        elif parsed_path.path == '/' or parsed_path.path == '/index.html':
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(self.get_html_page().encode('utf-8'))
            return
        
        # Serve aircraft SVG icon
        elif parsed_path.path == '/aircraft.svg':
            try:
                # Serve from static/ directory relative to this file
                svg_path = os.path.join(os.path.dirname(__file__), 'static', 'Antonov_An-124_Ruslan_silhouette.svg')
                with open(svg_path, 'rb') as f:
                    self.send_response(200)
                    self.send_header('Content-type', 'image/svg+xml')
                    self.send_header('Cache-Control', 'public, max-age=86400')
                    self.end_headers()
                    self.wfile.write(f.read())
            except FileNotFoundError:
                self.send_response(404)
                self.end_headers()
            return
        
        # Default behavior for other paths
        else:
            super().do_GET()
    
    def get_html_page(self):
        """Returns the HTML page with embedded JavaScript"""
        return '''<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>✈️ Airport Departures Viewer</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        
        header {
            text-align: center;
            color: white;
            margin-bottom: 30px;
        }
        
        h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
        }
        
        .subtitle {
            font-size: 1.1em;
            opacity: 0.9;
        }
        
        .controls {
            background: white;
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 20px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            display: grid;
            grid-template-columns: 2fr 2fr 1fr;
            gap: 15px;
            align-items: end;
        }
        
        .control-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        label {
            font-weight: 600;
            color: #333;
            font-size: 0.9em;
        }
        
        select, input[type="date"], button {
            padding: 12px 15px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 1em;
            transition: all 0.3s;
        }
        
        select:focus, input[type="date"]:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            cursor: pointer;
            font-weight: 600;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .airport-dropdown {
            position: absolute;
            background: white;
            border: 2px solid #667eea;
            border-radius: 8px;
            max-height: 300px;
            overflow-y: auto;
            z-index: 1000;
            width: calc(100% - 4px);
            margin-top: 5px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        }
        
        .airport-option {
            padding: 12px 15px;
            cursor: pointer;
            border-bottom: 1px solid #f0f0f0;
            transition: background 0.2s;
        }
        
        .airport-option:hover {
            background: #f8f9ff;
        }
        
        .airport-option:last-child {
            border-bottom: none;
        }
        
        .airport-option-icao {
            font-weight: 600;
            color: #667eea;
            font-size: 0.9em;
        }
        
        .airport-option-name {
            color: #333;
            font-size: 0.85em;
            margin-top: 2px;
        }
        
        .selected-airport {
            margin-top: 10px;
            background: #e8f5e9;
            border: 2px solid #4caf50;
            border-radius: 8px;
            padding: 12px 15px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .selected-airport span {
            color: #2e7d32;
            font-weight: 500;
        }
        
        .clear-btn {
            background: #f44336;
            color: white;
            border: none;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            cursor: pointer;
            font-size: 0.9em;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
        }
        
        .clear-btn:hover {
            background: #d32f2f;
            transform: none;
            box-shadow: none;
        }
        
        .control-group {
            position: relative;
        }
        
        .status {
            background: white;
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 20px;
            text-align: center;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        
        .status.loading {
            background: #fff3cd;
            color: #856404;
        }
        
        .status.success {
            background: #d4edda;
            color: #155724;
        }
        
        .status.error {
            background: #f8d7da;
            color: #721c24;
        }
        
        .card {
            background: white;
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 20px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
        }
        
        .search-box {
            margin-bottom: 20px;
        }
        
        .search-box input {
            width: 100%;
            padding: 15px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 1em;
            transition: all 0.3s;
        }
        
        .search-box input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        
        .stat-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
        }
        
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .stat-label {
            font-size: 0.9em;
            opacity: 0.9;
        }
        
        .table-container {
            overflow-x: auto;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            min-width: 600px;
        }
        
        th {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px;
            text-align: left;
            font-weight: 600;
            cursor: pointer;
            user-select: none;
            position: relative;
        }
        
        th:hover {
            background: linear-gradient(135deg, #5568d3 0%, #653a8b 100%);
        }
        
        th::after {
            content: ' ↕';
            opacity: 0.5;
            font-size: 0.8em;
        }
        
        th.sorted-asc::after {
            content: ' ↑';
            opacity: 1;
        }
        
        th.sorted-desc::after {
            content: ' ↓';
            opacity: 1;
        }
        
        td {
            padding: 15px;
            border-bottom: 1px solid #f0f0f0;
        }
        
        tr:hover {
            background: #f8f9ff;
        }
        
        .airline-badge {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 4px 10px;
            border-radius: 5px;
            font-size: 0.85em;
            font-weight: 600;
        }
        
        .time {
            font-family: 'Monaco', 'Courier New', monospace;
            color: #666;
        }
        
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #999;
        }
        
        .empty-state-icon {
            font-size: 4em;
            margin-bottom: 20px;
        }
        
        /* Map styles */
        /* Map modal/backdrop */
        #map-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.45);
            z-index: 998;
            display: none;
        }
        
        #map-container {
            position: fixed;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: min(95vw, 1200px);
            height: min(80vh, 800px);
            background: white;
            border-radius: 15px;
            padding: 20px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.25);
            z-index: 999;
            display: none;
        }
        
        #map-container.visible {
            display: block;
        }
        
        #map-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 2px solid #f0f0f0;
        }
        
        #map-title {
            font-size: 1.3em;
            font-weight: 600;
            color: #333;
        }
        
        #map-close {
            background: #f44336;
            color: white;
            border: none;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            cursor: pointer;
            font-size: 1.2em;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
        }
        
        #map-close:hover {
            background: #d32f2f;
        }
        
        #map {
            height: calc(100% - 70px);
            border-radius: 10px;
            z-index: 1;
        }
        
        .flight-selected {
            background: #e3f2fd !important;
            font-weight: 600;
        }
        
        .plane-icon-svg {
            background: transparent !important;
            border: none !important;
        }
        
        @media (max-width: 768px) {
            .controls {
                grid-template-columns: 1fr;
            }
            
            h1 {
                font-size: 1.8em;
            }
            
            .stats {
                grid-template-columns: 1fr;
            }
            
            #map {
                height: calc(100% - 60px);
            }
        }

        /* Altitude legend control */
        .leaflet-control.altitude-legend {
            background: rgba(0,0,0,0.55);
            color: #fff;
            padding: 10px 12px;
            border-radius: 8px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.25);
            backdrop-filter: blur(4px);
        }
        .alt-legend-title {
            font-weight: 700;
            letter-spacing: 0.5px;
            font-size: 12px;
            margin-bottom: 8px;
        }
        .alt-legend-bar {
            position: relative;
            height: 14px;
            width: min(70vw, 520px);
            background: linear-gradient(90deg,
                #ff7f2a 0%,  /* 0 */
                #ff9933 6%,  /* 500 */
                #ffb347 10%, /* 1k */
                #ffd166 18%, /* 2k */
                #fff176 30%, /* 4k */
                #b2ff59 42%, /* 6k */
                #66ff99 50%, /* 8k */
                #33ffc9 56%, /* 10k */
                #33b0ff 74%, /* 20k */
                #5f66ff 86%, /* 30k */
                #c44dff 100% /* 40k+ */
            );
            border-radius: 4px;
            margin-bottom: 6px;
        }
        .alt-legend-ticks {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 11px;
            opacity: 0.95;
        }
        .alt-legend-ticks span {
            transform: translateX(-50%);
            display: inline-block;
            width: 0;
            white-space: nowrap;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>✈️ Airport Departures Viewer</h1>
            <p class="subtitle">Real-time flight departure data • No CSV files created</p>
        </header>
        
        <div class="controls">
            <div class="control-group">
                <label for="airportSearch">Search Airport (by name, ICAO, IATA, or country)</label>
                <input 
                    type="text" 
                    id="airportSearch" 
                    placeholder="e.g., Paris, LFPG, CDG, London..."
                    oninput="searchAirports()"
                    autocomplete="off"
                >
                <div id="airportDropdown" class="airport-dropdown" style="display: none;"></div>
                <div id="selectedAirport" class="selected-airport" style="display: none;">
                    <span id="selectedAirportText"></span>
                    <button onclick="clearAirportSelection()" class="clear-btn">✕</button>
                </div>
            </div>
            
            <div class="control-group">
                <label for="dateInput">Date</label>
                <input type="date" id="dateInput">
            </div>
            
            <div class="control-group">
                <label>&nbsp;</label>
                <button id="fetchButton" onclick="fetchFlights()">🔄 Fetch Flights</button>
            </div>
        </div>
        
        <div id="statusBar" class="status" style="display: none;">
            <span id="statusText"></span>
        </div>
        
        <div class="card">
            <div class="search-box">
                <input 
                    type="text" 
                    id="searchInput" 
                    placeholder="🔍 Search by callsign, ICAO24, or destination..."
                    oninput="filterFlights()"
                >
            </div>
            
            <div class="stats" id="statsContainer" style="display: none;">
                <div class="stat-card">
                    <div class="stat-value" id="totalFlights">0</div>
                    <div class="stat-label">Total Flights</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="uniqueAirlines">0</div>
                    <div class="stat-label">Unique Airlines</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="selectedDate">-</div>
                    <div class="stat-label">Date</div>
                </div>
            </div>
            
            <div class="table-container">
                <table id="flightsTable">
                    <thead>
                        <tr>
                            <th onclick="sortTable('airline_name')">Airline</th>
                            <th onclick="sortTable('callsign')">Callsign</th>
                            <th onclick="sortTable('icao24')">ICAO24</th>
                            <th onclick="sortTable('dep_time_local')">Departure Time</th>
                            <th onclick="sortTable('arr_airport')">Destination</th>
                        </tr>
                    </thead>
                    <tbody id="tableBody">
                        <tr>
                            <td colspan="5" class="empty-state">
                                <div class="empty-state-icon">🛫</div>
                                <div>Search and select an airport, then click "Fetch Flights"</div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        
        <!-- Map Modal & Backdrop -->
        <div id="map-backdrop"></div>
        <div id="map-container">
            <div id="map-header">
                <h2 id="map-title">Flight Track</h2>
                <button id="map-close" onclick="closeMap()">×</button>
            </div>
            <div id="map"></div>
        </div>
    </div>
    
    <script>
        let flightsData = [];
        let currentSort = { column: '', direction: 'asc' };
        let selectedAirportICAO = '';
        let searchTimeout = null;
        let map = null;
        let currentPolyline = null;
        let currentMarkers = [];
        let osmBaseLayer = null;
        let esriSatLayer = null;
        let layerControl = null;
        let altitudeLegendControl = null;
        let autoRefreshInterval = null;
        let currentFlightData = null;
        
        function setDefaultDate() {
            const today = new Date();
            document.getElementById('dateInput').value = today.toISOString().split('T')[0];
        }
        
        // Airport search with debounce
        async function searchAirports() {
            const query = document.getElementById('airportSearch').value.trim();
            const dropdown = document.getElementById('airportDropdown');
            
            // Clear previous timeout
            if (searchTimeout) clearTimeout(searchTimeout);
            
            if (query.length < 2) {
                dropdown.style.display = 'none';
                return;
            }
            
            // Debounce: wait 300ms after user stops typing
            searchTimeout = setTimeout(async () => {
                try {
                    const response = await fetch(`/api/search-airports?q=${encodeURIComponent(query)}&limit=50`);
                    const airports = await response.json();
                    
                    if (airports.length > 0) {
                        dropdown.innerHTML = airports.map(a => 
                            `<div class="airport-option" onclick="selectAirport('${a.icao}', '${a.name.replace(/'/g, "\\'")}')">
                                <div class="airport-option-icao">${a.icao}</div>
                                <div class="airport-option-name">${a.name}</div>
                            </div>`
                        ).join('');
                        dropdown.style.display = 'block';
                    } else {
                        dropdown.innerHTML = '<div class="airport-option" style="text-align:center;color:#999;">No airports found</div>';
                        dropdown.style.display = 'block';
                    }
                } catch (error) {
                    console.error('Error searching airports:', error);
                }
            }, 300);
        }
        
        function selectAirport(icao, name) {
            selectedAirportICAO = icao;
            document.getElementById('airportSearch').value = '';
            document.getElementById('airportDropdown').style.display = 'none';
            document.getElementById('selectedAirport').style.display = 'flex';
            document.getElementById('selectedAirportText').textContent = `${icao} - ${name}`;
        }
        
        function clearAirportSelection() {
            selectedAirportICAO = '';
            document.getElementById('selectedAirport').style.display = 'none';
            document.getElementById('airportSearch').value = '';
        }
        
        // Hide dropdown when clicking outside
        document.addEventListener('click', function(e) {
            const searchBox = document.getElementById('airportSearch');
            const dropdown = document.getElementById('airportDropdown');
            if (e.target !== searchBox && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
        
        async function fetchFlights() {
            const airport = selectedAirportICAO;
            const date = document.getElementById('dateInput').value;
            
            if (!airport || !date) {
                showStatus('Please select airport and date', 'error');
                return;
            }
            
            const button = document.getElementById('fetchButton');
            button.disabled = true;
            showStatus('Fetching flights from OpenSky Network...', 'loading');
            
            try {
                const response = await fetch(`/api/fetch-flights?airport=${airport}&date=${date}`);
                const data = await response.json();
                
                if (data.success) {
                    flightsData = data.flights || [];
                    renderTable(flightsData);
                    updateStats(data);
                    showStatus(`✅ Loaded ${flightsData.length} flights successfully`, 'success');
                    setTimeout(() => {
                        document.getElementById('statusBar').style.display = 'none';
                    }, 3000);
                } else {
                    showStatus(`Error: ${data.error}`, 'error');
                }
            } catch (error) {
                console.error('Error fetching flights:', error);
                showStatus(`Error loading data: ${error.message}`, 'error');
            } finally {
                button.disabled = false;
            }
        }
        
        function showStatus(message, type) {
            const statusBar = document.getElementById('statusBar');
            const statusText = document.getElementById('statusText');
            statusBar.className = 'status ' + type;
            statusText.textContent = message;
            statusBar.style.display = 'block';
        }
        
        function updateStats(data) {
            const statsContainer = document.getElementById('statsContainer');
            statsContainer.style.display = 'grid';
            document.getElementById('totalFlights').textContent = data.count || 0;
            document.getElementById('selectedDate').textContent = data.date || '-';
            const airlines = new Set(
                flightsData.filter(f => f.airline_name).map(f => f.airline_name)
            );
            document.getElementById('uniqueAirlines').textContent = airlines.size;
        }
        
        function renderTable(flights) {
            const tbody = document.getElementById('tableBody');
            if (flights.length === 0) {
                tbody.innerHTML = `
                    <tr><td colspan="5" class="empty-state">
                        <div class="empty-state-icon">📭</div>
                        <div>No flights found for this date</div>
                    </td></tr>`;
                return;
            }
            tbody.innerHTML = flights.map((flight, index) => {
                const airlineName = flight.airline_name || flight.airline_code || '-';
                const icao24 = flight.icao24 || '';
                const depTime = flight.dep_time_local || '';
                const depTimestamp = depTime ? Math.floor(new Date(depTime).getTime() / 1000) : '';
                return `
                    <tr onclick="showFlightTrack('${icao24}', ${depTimestamp}, '${flight.callsign || ''}', '${flight.arr_airport || ''}', ${index})" style="cursor: pointer;" id="flight-row-${index}">
                        <td><span class="airline-badge">${airlineName}</span></td>
                        <td>${flight.callsign || '-'}</td>
                        <td><code>${icao24 || '-'}</code></td>
                        <td class="time">${formatDateTime(depTime)}</td>
                        <td>${flight.arr_airport || '-'}</td>
                    </tr>`;
            }).join('');
        }
        
        function formatDateTime(isoString) {
            if (!isoString) return '-';
            const date = new Date(isoString);
            return date.toLocaleString('fr-FR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        }
        
        function filterFlights() {
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();
            if (!searchTerm) {
                renderTable(flightsData);
                return;
            }
            const filtered = flightsData.filter(flight => {
                return (flight.callsign || '').toLowerCase().includes(searchTerm) ||
                       (flight.icao24 || '').toLowerCase().includes(searchTerm) ||
                       (flight.arr_airport || '').toLowerCase().includes(searchTerm) ||
                       (flight.airline_name || '').toLowerCase().includes(searchTerm);
            });
            renderTable(filtered);
        }
        
        function sortTable(column) {
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }
            document.querySelectorAll('th').forEach(th => {
                th.classList.remove('sorted-asc', 'sorted-desc');
            });
            const clickedHeader = Array.from(document.querySelectorAll('th')).find(
                th => th.textContent.toLowerCase().includes(column.split('_')[0])
            );
            if (clickedHeader) {
                clickedHeader.classList.add(`sorted-${currentSort.direction}`);
            }
            const sorted = [...flightsData].sort((a, b) => {
                let valA = a[column] || '';
                let valB = b[column] || '';
                if (column === 'dep_time_local') {
                    valA = new Date(valA);
                    valB = new Date(valB);
                }
                if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
                if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
                return 0;
            });
            renderTable(sorted);
        }
        
        // Map functions
        function initMap() {
            if (!map) {
                map = L.map('map').setView([48.8566, 2.3522], 5); // Center on Paris

                // Base layers
                osmBaseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© OpenStreetMap contributors',
                    maxZoom: 19
                });
                esriSatLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
                    maxZoom: 19
                });

                osmBaseLayer.addTo(map);

                // Layer control (Map vs Satellite)
                layerControl = L.control.layers(
                    { 'Map': osmBaseLayer, 'Satellite': esriSatLayer },
                    {},
                    { position: 'topleft', collapsed: true }
                ).addTo(map);
            }
        }
        
        function closeMap() {
            document.getElementById('map-container').classList.remove('visible');
            document.getElementById('map-backdrop').style.display = 'none';
            // Clear selection highlight
            document.querySelectorAll('.flight-selected').forEach(row => {
                row.classList.remove('flight-selected');
            });
            // Clear map layers
            if (currentPolyline) {
                map.removeLayer(currentPolyline);
                currentPolyline = null;
            }
            currentMarkers.forEach(marker => map.removeLayer(marker));
            currentMarkers = [];
            // Stop auto-refresh
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
            }
            currentFlightData = null;
        }
        
        function metersToFeet(m) { return m == null ? null : m * 3.28084; }

        function toRad(d) { return d * Math.PI / 180; }
        function toDeg(r) { return r * 180 / Math.PI; }
        function computeBearing(lat1, lon1, lat2, lon2) {
            const φ1 = toRad(lat1), φ2 = toRad(lat2);
            const Δλ = toRad(lon2 - lon1);
            const y = Math.sin(Δλ) * Math.cos(φ2);
            const x = Math.cos(φ1) * Math.cos(φ2) * Math.cos(Δλ) - Math.sin(φ1) * Math.sin(φ2);
            const θ = Math.atan2(y, x);
            return (toDeg(θ) + 360) % 360; // degrees 0..360
        }

        function getAltitudeColor(altitudeMeters) {
            // Convert to feet for legend coloring
            const alt = metersToFeet(altitudeMeters);
            if (alt == null || alt < 0) return '#808080';
            if (alt < 500) return '#ff7f2a';      // orange
            if (alt < 1000) return '#ff9933';
            if (alt < 2000) return '#ffb347';
            if (alt < 4000) return '#ffd166';
            if (alt < 6000) return '#fff176';
            if (alt < 8000) return '#b2ff59';
            if (alt < 10000) return '#66ff99';
            if (alt < 20000) return '#33ffc9';
            if (alt < 30000) return '#33b0ff';
            if (alt < 40000) return '#5f66ff';
            return '#c44dff'; // 40k+
        }
        
        async function showFlightTrack(icao24, timestamp, callsign, destination, rowIndex) {
            if (!icao24 || !timestamp) {
                alert('Missing flight information');
                return;
            }
            
            // Store current flight data for refresh
            currentFlightData = { icao24, timestamp, callsign, destination, rowIndex };
            
            // Highlight selected row
            document.querySelectorAll('.flight-selected').forEach(row => {
                row.classList.remove('flight-selected');
            });
            document.getElementById('flight-row-' + rowIndex).classList.add('flight-selected');
            
            // Show loading status
            showStatus(`Loading track for ${callsign}...`, 'loading');
            
            // Stop any existing auto-refresh
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
            }
            
            try {
                await updateFlightTrack(icao24, timestamp, callsign, destination, false);
                
                // Check if flight is recent (within last 12 hours) - likely still in air
                const flightTime = new Date(timestamp * 1000);
                const now = new Date();
                const hoursSinceDeparture = (now - flightTime) / (1000 * 60 * 60);
                
                // If flight departed within last 12 hours, enable auto-refresh every 30 seconds
                if (hoursSinceDeparture < 12) {
                    showStatus(`Track loaded - Auto-refreshing every 30s (live flight)`, 'success');
                    autoRefreshInterval = setInterval(async () => {
                        try {
                            await updateFlightTrack(icao24, timestamp, callsign, destination, true);
                        } catch (error) {
                            console.error('Auto-refresh error:', error);
                        }
                    }, 30000); // 30 seconds
                } else {
                    showStatus(`Track loaded (historical flight)`, 'success');
                }
                
            } catch (error) {
                console.error('Error fetching track:', error);
                showStatus(`Error: ${error.message}`, 'error');
            }
        }
        
        async function updateFlightTrack(icao24, timestamp, callsign, destination, isRefresh) {
                const response = await fetch(`/api/track?icao24=${icao24}&time=${timestamp}`);
                const data = await response.json();
                
                if (!data.success) {
                    throw new Error(data.error || 'Failed to fetch track');
                }
                
                const track = data.track;
                
                if (!track || !track.path || track.path.length === 0) {
                    if (!isRefresh) {
                        showStatus('No track data available for this flight', 'error');
                    }
                    return;
                }
                
                // Initialize map if not already done
                initMap();
                
                // Clear previous track
                if (currentPolyline) {
                    map.removeLayer(currentPolyline);
                }
                currentMarkers.forEach(marker => map.removeLayer(marker));
                currentMarkers = [];
                
                // Extract waypoints
                const waypoints = track.path.map(point => {
                    // Format: [time, latitude, longitude, baro_altitude, true_track, on_ground]
                    return {
                        lat: point[1],
                        lng: point[2],
                        altitude: point[3],
                        time: point[0],
                        track: point[4],
                        onGround: point[5]
                    };
                }).filter(wp => wp.lat && wp.lng); // Filter out invalid points
                
                if (waypoints.length === 0) {
                    if (!isRefresh) {
                        showStatus('No valid waypoints found', 'error');
                    }
                    return;
                }
                
                // Create colored polyline segments based on altitude
                waypoints.forEach((waypoint, i) => {
                    if (i < waypoints.length - 1) {
                        const nextWaypoint = waypoints[i + 1];
                        const color = getAltitudeColor(waypoint.altitude);
                        const segment = L.polyline(
                            [[waypoint.lat, waypoint.lng], [nextWaypoint.lat, nextWaypoint.lng]],
                            { color: color, weight: 3, opacity: 0.8 }
                        ).addTo(map);
                        currentMarkers.push(segment);
                    }
                });
                
                // Add only latest position as plane icon (rotated to heading)
                const endPoint = waypoints[waypoints.length - 1];

                // Determine heading (degrees). Use true_track if present, otherwise compute from last segment.
                let heading = typeof endPoint.track === 'number' ? endPoint.track : null;
                if (heading == null && waypoints.length >= 2) {
                    const prev = waypoints[waypoints.length - 2];
                    heading = computeBearing(prev.lat, prev.lng, endPoint.lat, endPoint.lng);
                }
                if (heading == null) heading = 0;

                const planeIcon = L.divIcon({
                    className: 'plane-icon-svg',
                    html: `<div style="transform: rotate(${heading}deg); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
                        <img src="/aircraft.svg" style="width: 28px; height: 28px; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.6)) brightness(0) saturate(100%) invert(27%) sepia(95%) saturate(6842%) hue-rotate(290deg) brightness(102%) contrast(106%);" />
                    </div>`,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                });

                const lastUpdateTime = new Date(endPoint.time * 1000).toLocaleTimeString();
                const endMarker = L.marker([endPoint.lat, endPoint.lng], {icon: planeIcon})
                    .addTo(map)
                    .bindPopup(`<b>Latest position</b><br>Altitude: ${Math.round(metersToFeet(endPoint.altitude || 0)).toLocaleString()} ft<br>Time: ${new Date(endPoint.time * 1000).toLocaleString()}<br>Heading: ${Math.round(heading)}°`);
                currentMarkers.push(endMarker);
                
                // Only fit bounds on initial load, not on refresh
                if (!isRefresh) {
                    const bounds = L.latLngBounds(waypoints.map(wp => [wp.lat, wp.lng]));
                    map.fitBounds(bounds, { padding: [50, 50] });
                    
                    // Show modal & backdrop and ensure legend exists
                    document.getElementById('map-backdrop').style.display = 'block';
                    document.getElementById('map-container').classList.add('visible');
                    document.getElementById('map-title').textContent = `Flight Track: ${callsign} → ${destination}`;
                    ensureAltitudeLegend(map);
                    
                    // Refresh map size (fixes display issues)
                    setTimeout(() => map.invalidateSize(), 100);
                } else {
                    // On refresh, update the title with last update time
                    document.getElementById('map-title').textContent = `Flight Track: ${callsign} → ${destination} (Updated: ${lastUpdateTime})`;
                    console.log(`Track refreshed: ${waypoints.length} waypoints, latest at ${lastUpdateTime}`);
                }
        }

        // Add altitude legend as Leaflet control
        function ensureAltitudeLegend(map) {
            if (altitudeLegendControl) return;
            altitudeLegendControl = L.control({position: 'bottomleft'});
            altitudeLegendControl.onAdd = function() {
                const div = L.DomUtil.create('div', 'leaflet-control altitude-legend');
                div.innerHTML = `
                    <div class="alt-legend-title">ALTITUDE (ft)</div>
                    <div class="alt-legend-bar"></div>
                    <div class="alt-legend-ticks">
                        <span>0</span>
                        <span>500</span>
                        <span>1 000</span>
                        <span>2 000</span>
                        <span>4 000</span>
                        <span>6 000</span>
                        <span>8 000</span>
                        <span>10 000</span>
                        <span>20 000</span>
                        <span>30 000</span>
                        <span>40 000+</span>
                    </div>`;
                return div;
            };
            altitudeLegendControl.addTo(map);
        }
        
        window.addEventListener('DOMContentLoaded', () => {
            setDefaultDate();
            const backdrop = document.getElementById('map-backdrop');
            if (backdrop) backdrop.addEventListener('click', closeMap);
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeMap();
            });
        });
    </script>
</body>
</html>'''

def run_server():
    """Start the HTTP server"""
    with socketserver.TCPServer(("", PORT), FlightServerHandler) as httpd:
        print("\n" + "="*63)
        print("✈️  Airport Departures Web Server - OPTIMIZED VERSION")
        print("="*63)
        print(f"🌐 Server:       http://localhost:{PORT}")
        print(f"📊 API Airports: http://localhost:{PORT}/api/airports")
        print(f"✈️  API Fetch:    http://localhost:{PORT}/api/fetch-flights")
        print("="*63)
        print("💡 NO CSV FILES CREATED - Direct JSON communication!")
        print("   Old CSV files can be safely deleted")
        print("="*63)
        print("Press Ctrl+C to stop\n")
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n👋 Server stopped. Goodbye!")

if __name__ == "__main__":
    run_server()
