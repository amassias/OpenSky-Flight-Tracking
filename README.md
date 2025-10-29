# ✈️ Flight Tracker & Departures Viewer

A modern, real-time web application for tracking flights and visualizing departure data from airports worldwide using the OpenSky Network API.

![Python](https://img.shields.io/badge/python-3.8+-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

---

## ⚠️ SECURITY NOTICE

**Before publishing to GitHub:**
- ✅ `.gitignore` is configured to exclude `.env` (your credentials)
- ✅ Use `.env.example` as a template (safe to commit)
- ❌ **NEVER commit your `.env` file** with real API credentials
- 🔒 Keep your `OPEN_SKY_CLIENT_ID` and `OPEN_SKY_CLIENT_SECRET` private

---

## 🌟 Features

### 🗺️ Interactive Flight Tracking
- **Real-time trajectory visualization** on interactive maps
- **Satellite and standard map views** (OpenStreetMap & Esri World Imagery)
- **Live aircraft positioning** with automatic 30-second updates for in-flight aircraft
- **Altitude color-coding** with visual legend (0-40,000+ ft)
- **Rotated aircraft icons** showing actual heading direction
- **Custom aircraft silhouette** rendering

### 🛫 Flight Departures
- **7,895+ airports worldwide** with intelligent search
- **Autocomplete search** by airport name, ICAO code, IATA code, or country
- **5,765 airlines database** with full names displayed
- **Date selection** for historical and current flight data
- **Real-time filtering** by callsign, ICAO24, destination, or airline
- **Sortable columns** (click to sort by any field)
- **Live statistics** showing total flights and unique airlines

### 🎨 Modern Interface
- **Modal map viewer** with dark backdrop
- **Responsive design** optimized for desktop and mobile
- **Gradient purple theme** with smooth animations
- **Zero CSV files** - pure JSON API communication
- **Keyboard shortcuts** (ESC to close map)

## 🚀 Quick Start

### Prerequisites
- Python 3.8 or higher
- OpenSky Network account ([register here](https://opensky-network.org/))

### Installation

1. **Clone or download the repository**
   ```bash
   cd /path/to/ddd
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure OpenSky credentials**
   
   ⚠️ **IMPORTANT: Never commit your `.env` file to Git!**
   
   Copy the example file and add your credentials:
   ```bash
   cp .env.example .env
   ```
   
   Then edit `.env` with your actual credentials:
   ```bash
   OPEN_SKY_CLIENT_ID=your_actual_client_id
   OPEN_SKY_CLIENT_SECRET=your_actual_client_secret
   ```
   
   Get your credentials from the [OpenSky Network API portal](https://opensky-network.org/apidoc/rest.html).

4. **Launch the server**
   ```bash
   python3 server.py
   ```

5. **Open in your browser**
   ```
   http://localhost:8000
   ```

## 📖 Usage Guide

### Viewing Flight Departures

1. **Search for an airport**
   - Type airport name (e.g., "Paris", "Kennedy")
   - Or use ICAO code (e.g., "LFPG", "KJFK")
   - Or use IATA code (e.g., "CDG", "JFK")
   - Select from the dropdown

2. **Choose a date**
   - Current date is auto-selected
   - Pick any historical date for past flights

3. **Fetch flights**
   - Click "🔄 Fetch Flights"
   - View comprehensive departure list with airline names

4. **Filter & sort**
   - Use the search box to filter results
   - Click column headers to sort

### Tracking Flights on Map

1. **Click any flight** in the table
2. **Interactive map opens** showing:
   - Complete flight trajectory with altitude-colored path
   - Aircraft icon at latest position (rotated to heading)
   - Altitude legend (0-40,000+ ft)
   - Start/end times and positions

3. **Live tracking** (for flights departed <12 hours ago):
   - Auto-refreshes every 30 seconds
   - Aircraft position updates automatically
   - Map title shows last update time

4. **Map controls**:
   - Switch between **Map** and **Satellite** views (top-left)
   - Zoom and pan to explore
   - Click aircraft icon for position details
   - Close with **×** button or **ESC** key

## 🏗️ Project Structure

```
ddd/
├── server.py                  # Main HTTP server with embedded HTML/CSS/JS
├── fetch_flights_api.py       # OpenSky API flight fetcher with OAuth2
├── data_loader.py             # Airport & airline data loader with caching
├── requirements.txt          # Python dependencies
├── .env                      # OpenSky API credentials (create this)
├── README.md                 # Main documentation
│
├── data/                     # Databases (kept in repo)
│   ├── iata-icao.csv         # 7,895 airports worldwide
│   └── Airlines data         # 5,765 airlines (ICAO → name)
│
├── static/                   # Static web assets
│   └── Antonov_An-124_Ruslan_silhouette.svg  # Custom aircraft icon
│
└── docs/                     # Additional docs
   ├── PROJECT_INFO.md       # Technical architecture & stats
   ├── QUICKSTART.md         # One-minute setup
   └── STRUCTURE.txt         # Visual tree overview
```

## 🔧 Technical Stack

### Backend
- **Python 3.8+** - Core language
- **http.server** - Built-in HTTP server
- **requests** - HTTP client for OpenSky API
- **python-dotenv** - Environment variable management

### Frontend
- **Vanilla JavaScript** - No frameworks, pure JS
- **Leaflet.js** - Interactive maps
- **OpenStreetMap** - Standard map tiles
- **Esri World Imagery** - Satellite imagery

### APIs
- **OpenSky Network REST API** - Flight data
  - `/flights/departure` - Departure data
  - `/tracks/all` - Flight trajectories
  - OAuth2 authentication

## 📊 Data Sources

- **Airport Database**: 7,895 airports with coordinates from IATA/ICAO data
- **Airline Database**: 5,765 airlines with names and codes
- **Flight Data**: Real-time from OpenSky Network (crowdsourced ADS-B receivers)
- **Maps**: 
  - OpenStreetMap contributors
  - Esri World Imagery (i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP)

## 🎯 Key Features Explained

### Auto-Refresh for Live Flights
- Detects flights departed within last 12 hours
- Automatically refreshes trajectory every 30 seconds
- Updates aircraft position and heading in real-time
- Stops when map is closed

### Altitude Color Coding
- **Orange/Red** (0-1,000 ft): Takeoff/landing
- **Yellow** (1,000-4,000 ft): Low altitude
- **Green** (4,000-8,000 ft): Medium altitude
- **Cyan** (8,000-10,000 ft): Climbing/descending
- **Blue** (10,000-30,000 ft): Cruise altitude
- **Purple** (30,000-40,000+ ft): High cruise

### Intelligent Aircraft Icon
- Uses custom SVG silhouette
- Rotates to match actual heading (from ADS-B true_track)
- Fallback: calculates bearing from last two waypoints
- Magenta color for high visibility on satellite imagery
- Drop shadow for contrast

## 🌐 API Endpoints

The server exposes these endpoints:

- `GET /` - Main web interface
- `GET /api/search-airports?q=query&limit=50` - Airport search
- `GET /api/airports` - Popular airports list
- `GET /api/fetch-flights?airport=ICAO&date=YYYY-MM-DD` - Fetch departures
- `GET /api/track?icao24=XXX&time=timestamp` - Fetch flight trajectory
- `GET /aircraft.svg` - Custom aircraft icon

## 🚦 Performance

- **Zero CSV files created** during operation
- **Direct JSON communication** between components
- **Efficient caching** of airport/airline data
- **Lazy map initialization** (loads on first use)
- **Optimized SVG rendering** for aircraft icons
- **30-second refresh interval** balances freshness vs. API limits

## 🔐 Security Notes

- OpenSky credentials stored in `.env` (not committed to git)
- OAuth2 token authentication for API requests
- CORS enabled for local development
- No user data stored or transmitted

## 📝 Requirements

```
requests>=2.31.0
python-dotenv>=1.0.0
```

## 🐛 Troubleshooting

### "No track data available"
- Some flights don't have trajectory data in OpenSky
- Historical flights (>7 days old) may have incomplete data
- Try a different flight

### "Error 500" on track requests
- OpenSky API rate limits (max ~400 requests/day for free tier)
- Some aircraft don't transmit position data
- Network connectivity issues

### Map doesn't display
- Check browser console for errors
- Ensure internet connection (fetches Leaflet.js from CDN)
- Clear browser cache

### Date shows yesterday
- Fixed in latest version - now shows current date
- Refresh the page if issue persists

## 🤝 Contributing

This is a personal project, but suggestions and improvements are welcome!

## 📄 License

MIT License - feel free to use and modify for your own projects.

## 🙏 Acknowledgments

- **OpenSky Network** - Free flight data API
- **Leaflet.js** - Excellent mapping library
- **OpenStreetMap** - Community-driven maps
- **Esri** - High-quality satellite imagery
- **Airport/Airline data contributors** - Comprehensive databases

## 📧 Support

For issues or questions:
1. Check the troubleshooting section above
2. Verify your OpenSky credentials are correct
3. Check the browser console for error messages
4. Ensure Python 3.8+ is installed

---

**Built with ❤️ for aviation enthusiasts**

*Last updated: October 2025*
