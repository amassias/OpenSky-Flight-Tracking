# Flight Tracker & Departures Viewer - Project Info

## 📋 Project Overview

**Name**: Flight Tracker & Departures Viewer  
**Version**: 2.0  
**Last Updated**: October 29, 2025  
**Language**: Python 3.8+  
**Type**: Web Application (Single-Page Application)

## 🎯 Purpose

A real-time flight tracking and departure visualization system that combines:
1. Worldwide airport departure data
2. Interactive flight trajectory maps
3. Live aircraft position tracking
4. Comprehensive airline information

## 🗂️ Project Files (Clean & Organized)

### Core Application Files
```
server.py (48KB)
├── Main HTTP server (port 8000)
├── Embedded HTML/CSS/JavaScript
├── API endpoints for flights and tracks
└── Serves static aircraft SVG

fetch_flights_api.py (5.7KB)
├── OpenSky API integration
├── OAuth2 authentication
├── Flight departure data fetcher
└── Airline name enrichment

data_loader.py (5.7KB)
├── Airport database loader (7,895 airports)
├── Airline database loader (5,765 airlines)
├── Efficient caching mechanism
└── Search and filtering functions
```

### Data Files
```
iata-icao.csv (693KB)
├── 7,895 airports worldwide
├── ICAO codes, IATA codes, names
├── Latitude/longitude coordinates
└── Country information

Airlines data (309KB)
├── 5,765 airlines
├── ICAO airline codes
├── Full airline names
└── Mapping for flight data enrichment

Antonov_An-124_Ruslan_silhouette.svg (2.2KB)
└── Custom aircraft icon for map markers
```

### Configuration Files
```
.env (102B)
├── OPEN_SKY_CLIENT_ID
└── OPEN_SKY_CLIENT_SECRET

requirements.txt (23B)
├── requests
└── python-dotenv
```

### Documentation
```
README.md (8.1KB)
└── Comprehensive project documentation
```

## 📊 Statistics

- **Total Code Lines**: ~1,300 lines (Python + embedded JS/HTML/CSS)
- **Airports**: 7,895 worldwide
- **Airlines**: 5,765 with full names
- **API Endpoints**: 5 custom endpoints
- **Map Layers**: 2 (Standard + Satellite)
- **Auto-refresh Rate**: 30 seconds for live flights

## 🔄 Workflow

```
User Opens Website
    ↓
Select Airport (autocomplete search)
    ↓
Choose Date (auto-defaults to today)
    ↓
Fetch Flights → OpenSky API → Display Table
    ↓
Click Flight Row
    ↓
Fetch Trajectory → OpenSky /tracks/all
    ↓
Display on Interactive Map
    ↓
Auto-refresh every 30s (if recent flight)
```

## 🌐 Architecture

### Frontend Stack
- Pure JavaScript (no frameworks)
- Leaflet.js for maps
- CSS3 with gradients and animations
- Responsive grid layout

### Backend Stack
- Python http.server (built-in)
- Subprocess calls for data fetching
- JSON-only communication (no CSV writes)
- In-memory caching

### External Services
- OpenSky Network REST API
- OpenStreetMap tiles
- Esri World Imagery tiles
- Leaflet.js CDN

## 🎨 UI/UX Features

- **Purple gradient theme** (#667eea to #764ba2)
- **Modal popup maps** with dark backdrop
- **Altitude color legend** (orange→purple gradient)
- **Rotated aircraft icons** matching flight heading
- **Real-time search filtering** with debouncing
- **Sortable columns** with visual indicators
- **Keyboard shortcuts** (ESC to close)
- **Responsive design** (mobile-friendly)

## 🔐 Security

- ✅ Credentials in `.env` (not in repo)
- ✅ OAuth2 token authentication
- ✅ CORS headers for local dev
- ✅ No user data collection
- ✅ No persistent storage
- ✅ Read-only operations

## ⚡ Performance Optimizations

1. **No CSV file creation** - Direct JSON streaming
2. **Airport/airline data caching** - Load once, use many times
3. **Lazy map initialization** - Only loads when needed
4. **Debounced search** - Reduces API calls
5. **Efficient SVG rendering** - Browser-native
6. **30-second refresh rate** - Balances freshness vs API limits

## 📈 Future Enhancement Ideas

- [ ] Flight path prediction (ETA calculations)
- [ ] Multiple flight tracking simultaneously
- [ ] Flight history playback (time slider)
- [ ] Weather overlay on maps
- [ ] Airport runway diagrams
- [ ] Push notifications for tracked flights
- [ ] Export flight data (JSON/CSV)
- [ ] Flight search by route (origin → destination)
- [ ] 3D flight path visualization
- [ ] Mobile app version

## 🛠️ Development

### How to Run
```bash
python3 server.py
```

### How to Stop
```bash
Ctrl+C  # or kill the process on port 8000
```

### How to Debug
1. Check browser console (F12)
2. Monitor server terminal output
3. Verify .env credentials
4. Test API endpoints directly

### File Dependencies
```
server.py
├── Requires: data_loader.py, fetch_flights_api.py
├── Loads: iata-icao.csv, Airlines data
└── Serves: Antonov_An-124_Ruslan_silhouette.svg

fetch_flights_api.py
├── Uses: data_loader.py (for airline enrichment)
└── Requires: .env credentials

data_loader.py
├── Reads: iata-icao.csv
└── Reads: Airlines data
```

## 📝 Notes

- **No database required** - Everything runs from CSV files
- **Zero installation complexity** - Just pip install 2 packages
- **Self-contained** - All HTML/CSS/JS embedded in server.py
- **Portable** - Copy folder and run anywhere
- **Clean codebase** - Removed all legacy/test files

## 🗑️ Removed Files (Cleanup)

The following unnecessary files were removed:
- ❌ `data/` folder (old CSV exports)
- ❌ `Documentation.txt` (redundant)
- ❌ `PROJECT_INFO.txt` (replaced by this file)
- ❌ All old departure CSV files

## 🎯 Core Value Proposition

**Before**: Basic terminal script showing flight departures  
**After**: Full-featured web app with:
- Interactive maps
- Real-time tracking
- Worldwide coverage
- Beautiful UI
- Live updates

---

**Project Status**: ✅ Complete & Production Ready

**Maintenance**: Minimal - only update if OpenSky API changes

**Deployment**: Local only (no cloud hosting needed)
