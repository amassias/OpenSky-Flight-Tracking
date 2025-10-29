# 🚀 Quick Start Guide

## Installation (1 minute)

```bash
# 1. Navigate to project
cd /Users/arthur/Downloads/ddd

# 2. Install dependencies (if not done)
pip install requests python-dotenv

# 3. Configure .env file (if not done)
echo "OPEN_SKY_CLIENT_ID=your_client_id" > .env
echo "OPEN_SKY_CLIENT_SECRET=your_client_secret" >> .env

# 4. Run server
python3 server.py
```

## Usage (30 seconds)

1. Open: **http://localhost:8000**
2. Search airport: Type "Paris" or "CDG"
3. Click "Fetch Flights"
4. Click any flight to see trajectory on map

## Commands

### Start Server
```bash
python3 server.py
```

### Stop Server
```bash
Ctrl+C
# or
lsof -ti:8000 | xargs kill -9
```

### Restart Server
```bash
lsof -ti:8000 | xargs kill -9 && python3 server.py
```

## Features Checklist

- ✅ Search 7,895 airports worldwide
- ✅ View departure flights for any date
- ✅ Click flight to see trajectory on map
- ✅ Toggle Map/Satellite view
- ✅ Auto-refresh for live flights (30s)
- ✅ Altitude-colored flight paths
- ✅ Rotated aircraft icons
- ✅ Filter by airline/callsign/destination

## Keyboard Shortcuts

- **ESC** - Close map
- **Click outside map** - Close map
- **Click column header** - Sort table

## Tips

💡 **Best airports to try**: LFPG (Paris), KJFK (New York), OMDB (Dubai), EGLL (London)

💡 **Live tracking**: Search today's date for real-time aircraft positions

💡 **Historical data**: Go back several days to see past flight patterns

💡 **Satellite view**: Click "Satellite" in top-left of map for imagery

💡 **Filter flights**: Use search box to quickly find specific flights

## Troubleshooting

❌ **Port already in use**: Run `lsof -ti:8000 | xargs kill -9`

❌ **No flights found**: Try different date or airport

❌ **Map doesn't load**: Check internet connection (needs Leaflet.js CDN)

❌ **API errors**: Verify .env credentials from OpenSky

## URLs

- **Website**: http://localhost:8000
- **API Docs**: https://opensky-network.org/apidoc/rest.html
- **Register**: https://opensky-network.org/

---

**Ready to fly? Start the server! ✈️**
