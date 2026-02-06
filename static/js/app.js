const state = {
    map: null,
    mapLayers: {},
    mapTheme: "dark",
    markers: new Map(),
    flights: [],
    filteredFlights: [],
    selectedFlight: null,
    selectedTrackLayer: null,
    selectedTrackBounds: null,
    selectedAirport: null,
    airportSearchTimer: null,
    liveTimer: null,
    liveEnabled: true,
    liveIntervalMs: 15000,
    liveRequestInFlight: false,
    mapMoveTimer: null,
    userLocationMarker: null,
    userLocationAccuracy: null,
    userLocationHeadingCone: null,
    userLocationWatchId: null,
    userLocationLastHeading: null,
    userLocationPermissionDenied: false,
};

const API_BASE =
    window.location.protocol === "file:" ? "http://localhost:8000" : "";

const ui = {
    airportSearch: () => document.getElementById("airportSearch"),
    airportDropdown: () => document.getElementById("airportDropdown"),
    dateInput: () => document.getElementById("dateInput"),
    modeSelect: () => document.getElementById("modeSelect"),
    fetchFlightsBtn: () => document.getElementById("fetchFlightsBtn"),
    refreshPopularBtn: () => document.getElementById("refreshPopularBtn"),
    popularAirports: () => document.getElementById("popularAirports"),
    flightFilterInput: () => document.getElementById("flightFilterInput"),
    flightSortSelect: () => document.getElementById("flightSortSelect"),
    flightsList: () => document.getElementById("flightsList"),
    liveRefreshToggle: () => document.getElementById("liveRefreshToggle"),
    liveStatusText: () => document.getElementById("liveStatusText"),
    utcNow: () => document.getElementById("utcNow"),
    apiStatus: () => document.getElementById("apiStatus"),
    mobileControlToggle: () => document.getElementById("mobileControlToggle"),
    controlsPanel: () => document.getElementById("controlsPanel"),
    toggleMapViewBtn: () => document.getElementById("toggleMapViewBtn"),
    recenterBtn: () => document.getElementById("recenterBtn"),
    fitTrackBtn: () => document.getElementById("fitTrackBtn"),
    toggleThemeBtn: () => document.getElementById("toggleThemeBtn"),
    liveAircraftCount: () => document.getElementById("liveAircraftCount"),
    liveUpdateTime: () => document.getElementById("liveUpdateTime"),
    resultsTitle: () => document.getElementById("resultsTitle"),
    resultsSubtitle: () => document.getElementById("resultsSubtitle"),
    resultCount: () => document.getElementById("resultCount"),
    statTotalFlights: () => document.getElementById("statTotalFlights"),
    statLiveFlights: () => document.getElementById("statLiveFlights"),
    statAirlines: () => document.getElementById("statAirlines"),
    mapTitle: () => document.getElementById("mapTitle"),
    flightDetailsPanel: () => document.getElementById("flightDetailsPanel"),
    detailsCallsign: () => document.getElementById("detailsCallsign"),
    detailsAirline: () => document.getElementById("detailsAirline"),
    detailsRoute: () => document.getElementById("detailsRoute"),
    detailsAltitude: () => document.getElementById("detailsAltitude"),
    detailsSpeed: () => document.getElementById("detailsSpeed"),
    detailsStatus: () => document.getElementById("detailsStatus"),
    closeDetailsBtn: () => document.getElementById("closeDetailsBtn"),
    altitudeChart: () => document.getElementById("altitudeChart"),
    trackMeta: () => document.getElementById("trackMeta"),
    toastContainer: () => document.getElementById("toastContainer"),
};

const utcDateFormatter = new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
});

const utcTimeFormatter = new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
});

const utcClockFormatter = new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
});

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatTimestampUtc(timestampSec) {
    if (!timestampSec) return "--";
    return `${utcDateFormatter.format(new Date(timestampSec * 1000))} UTC`;
}

function formatTimeUtc(timestampSec) {
    if (!timestampSec) return "--";
    return `${utcTimeFormatter.format(new Date(timestampSec * 1000))} UTC`;
}

function formatAltitudeMeters(value) {
    if (value === null || value === undefined) return "--";
    return `${Math.round(value).toLocaleString()} m`;
}

function formatSpeed(value) {
    if (value === null || value === undefined) return "--";
    const ms = Math.round(value);
    const knots = Math.round(value * 1.943844);
    return `${ms} m/s (${knots} kt)`;
}

function altitudeToColor(altitude, minAlt, maxAlt) {
    if (altitude === null || altitude === undefined || !Number.isFinite(altitude)) {
        return "#29c7b7";
    }
    const range = maxAlt - minAlt || 1;
    const ratio = Math.max(0, Math.min(1, (altitude - minAlt) / range));
    // green (120) -> yellow (60) -> red (0)
    const hue = 120 - ratio * 120;
    return `hsl(${hue}, 82%, 52%)`;
}

function formatStatus(status, onGround) {
    if (status === "airborne") return "Airborne";
    if (status === "on_ground") return "On ground";
    if (status === "completed") return "Completed";
    if (onGround === true) return "On ground";
    if (onGround === false) return "Airborne";
    return "Unknown";
}

function routeLabel(flight) {
    const dep = flight.departure_airport || "---";
    const arr = flight.arrival_airport || "---";
    return `${dep} -> ${arr}`;
}

function routeLabelLong(flight) {
    const dep = flight.departure_airport_name || flight.departure_airport || "Unknown";
    const arr = flight.arrival_airport_name || flight.arrival_airport || "Unknown";
    return `${dep} -> ${arr}`;
}

function flightKey(flight) {
    // Use ?? so that primary_time=0 (live flights) is preserved and the key stays stable
    return `${flight.icao24 || "none"}-${flight.primary_time ?? flight.first_seen ?? flight.last_seen ?? 0}-${flight.callsign || ""}`;
}

function todayUtcDateInputValue() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function setUtcClock() {
    const nowText = `UTC ${utcClockFormatter.format(new Date())}`;
    ui.utcNow().textContent = nowText;
}

function showToast(message, type = "info") {
    const container = ui.toastContainer();
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3200);
}

function apiUrl(path, params) {
    const url = new URL(path, API_BASE || window.location.origin);
    if (params && typeof params === "object") {
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== "") {
                url.searchParams.set(key, String(value));
            }
        });
    }
    return url.toString();
}

function normalizeAirportFromInput() {
    const selected = state.selectedAirport;
    const raw = ui.airportSearch().value.trim().toUpperCase();

    if (selected && raw.startsWith(selected.icao)) {
        return selected.icao;
    }

    const match = raw.match(/[A-Z0-9]{4}/);
    return match ? match[0] : null;
}

function createPlaneIcon(track, onGround) {
    const heading = Number.isFinite(Number(track)) ? Number(track) : 0;
    const color = onGround ? "#f5a23b" : "#29c7b7";
    const shadow = onGround ? "rgba(245,162,59,0.5)" : "rgba(41,199,183,0.5)";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" style="transform:rotate(${heading}deg);filter:drop-shadow(0 0 4px ${shadow})"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="${color}"/></svg>`;
    return L.divIcon({
        className: "plane-icon-wrapper",
        html: svg,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
    });
}

function createUserLocationIcon() {
    return L.divIcon({
        className: "user-location-icon-wrapper",
        html: '<span class="user-location-pulse"></span><span class="user-location-dot"></span>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
    });
}

function destinationLatLng(latDeg, lonDeg, bearingDeg, distanceMeters) {
    const earthRadius = 6371000;
    const angularDistance = distanceMeters / earthRadius;
    const bearing = (bearingDeg * Math.PI) / 180;

    const lat1 = (latDeg * Math.PI) / 180;
    const lon1 = (lonDeg * Math.PI) / 180;

    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinAngularDistance = Math.sin(angularDistance);
    const cosAngularDistance = Math.cos(angularDistance);

    const lat2 = Math.asin(sinLat1 * cosAngularDistance + cosLat1 * sinAngularDistance * Math.cos(bearing));
    const lon2 =
        lon1 +
        Math.atan2(
            Math.sin(bearing) * sinAngularDistance * cosLat1,
            cosAngularDistance - sinLat1 * Math.sin(lat2)
        );

    return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI];
}

function updateUserLocationDisplay(position) {
    if (!state.map || !position?.coords) return;

    const lat = Number(position.coords.latitude);
    const lon = Number(position.coords.longitude);
    const accuracy = Number(position.coords.accuracy);
    const heading = Number(position.coords.heading);
    const speed = Number(position.coords.speed);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    if (!state.userLocationMarker) {
        state.userLocationMarker = L.marker([lat, lon], {
            icon: createUserLocationIcon(),
            interactive: false,
            keyboard: false,
            zIndexOffset: 1500,
        }).addTo(state.map);
    } else {
        state.userLocationMarker.setLatLng([lat, lon]);
    }

    const markerElement = state.userLocationMarker.getElement();
    const hasLiveHeading =
        Number.isFinite(heading) && heading >= 0 && heading <= 360 && Number.isFinite(speed) && speed > 0.6;

    if (hasLiveHeading) {
        state.userLocationLastHeading = heading;
    }

    if (markerElement) {
        const headingDeg = Number.isFinite(state.userLocationLastHeading) ? state.userLocationLastHeading : 0;
        markerElement.style.setProperty("--heading-deg", `${headingDeg}deg`);
        markerElement.classList.toggle("has-heading", Number.isFinite(state.userLocationLastHeading));
    }

    if (Number.isFinite(accuracy) && accuracy > 0) {
        const radius = Math.max(8, Math.min(accuracy, 2500));
        if (!state.userLocationAccuracy) {
            state.userLocationAccuracy = L.circle([lat, lon], {
                radius,
                color: "rgba(45, 140, 255, 0.42)",
                fillColor: "rgba(45, 140, 255, 0.16)",
                fillOpacity: 0.45,
                weight: 1,
                interactive: false,
            }).addTo(state.map);
        } else {
            state.userLocationAccuracy.setLatLng([lat, lon]);
            state.userLocationAccuracy.setRadius(radius);
        }
    }

    const headingValue = Number.isFinite(state.userLocationLastHeading) ? state.userLocationLastHeading : null;
    if (headingValue !== null) {
        const coneDistance = Math.max(180, Math.min(900, Number.isFinite(accuracy) ? accuracy * 2.2 : 320));
        const halfAngle = 22;
        const leftPoint = destinationLatLng(lat, lon, headingValue - halfAngle, coneDistance);
        const rightPoint = destinationLatLng(lat, lon, headingValue + halfAngle, coneDistance);
        const conePoints = [[lat, lon], leftPoint, rightPoint];

        if (!state.userLocationHeadingCone) {
            state.userLocationHeadingCone = L.polygon(conePoints, {
                color: "rgba(99, 170, 255, 0.55)",
                fillColor: "rgba(99, 170, 255, 0.24)",
                fillOpacity: 0.45,
                weight: 1,
                interactive: false,
                smoothFactor: 1.2,
            }).addTo(state.map);
        } else {
            state.userLocationHeadingCone.setLatLngs(conePoints);
        }
    }

    if (state.userLocationHeadingCone) {
        state.userLocationHeadingCone.bringToBack();
    }
    if (state.userLocationAccuracy) {
        state.userLocationAccuracy.bringToBack();
    }
}

function startUserLocationWatch() {
    if (!state.map || !navigator.geolocation || state.userLocationWatchId !== null) return;

    state.userLocationWatchId = navigator.geolocation.watchPosition(
        (position) => {
            updateUserLocationDisplay(position);
            state.userLocationPermissionDenied = false;
        },
        (error) => {
            if (error?.code === error.PERMISSION_DENIED) {
                state.userLocationPermissionDenied = true;
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 5000,
        }
    );
}

function flyToSelectedAirport() {
    if (!state.selectedAirport) return false;

    const lat = Number(state.selectedAirport.latitude);
    const lon = Number(state.selectedAirport.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

    state.map.flyTo([lat, lon], 8, { duration: 0.8 });
    return true;
}

function initMap() {
    const darkLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO',
        subdomains: "abcd",
        maxZoom: 20,
    });

    const lightLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO',
        subdomains: "abcd",
        maxZoom: 20,
    });

    state.mapLayers = {
        dark: darkLayer,
        light: lightLayer,
    };

    state.map = L.map("map", {
        zoomControl: false,
        preferCanvas: true,
        worldCopyJump: true,
    }).setView([48.8566, 2.3522], 6);

    darkLayer.addTo(state.map);
    L.control.zoom({ position: "bottomright" }).addTo(state.map);

    state.map.on("moveend", () => {
        if (!state.liveEnabled) return;
        clearTimeout(state.mapMoveTimer);
        state.mapMoveTimer = setTimeout(updateLiveFlights, 400);
    });
}

function toggleMapTheme() {
    const nextTheme = state.mapTheme === "dark" ? "light" : "dark";
    state.map.removeLayer(state.mapLayers[state.mapTheme]);
    state.mapLayers[nextTheme].addTo(state.map);
    state.mapTheme = nextTheme;
    showToast(`Map theme: ${nextTheme}`, "success");
}

function updateMapFocusButton() {
    const button = ui.toggleMapViewBtn();
    if (!button) return;

    const focusEnabled = document.body.classList.contains("map-focus-mode");
    button.textContent = focusEnabled ? "Exit Full" : "Full Map";
    button.setAttribute("aria-pressed", focusEnabled ? "true" : "false");
}

function toggleMapFocusMode() {
    const enableFocus = !document.body.classList.contains("map-focus-mode");
    document.body.classList.toggle("map-focus-mode", enableFocus);
    updateMapFocusButton();

    if (state.map) {
        setTimeout(() => state.map.invalidateSize(), 220);
    }
}

function bindEvents() {
    ui.fetchFlightsBtn().addEventListener("click", fetchFlights);
    ui.refreshPopularBtn().addEventListener("click", loadPopularAirports);
    ui.flightFilterInput().addEventListener("input", renderFlightsList);
    ui.flightSortSelect().addEventListener("change", renderFlightsList);

    ui.modeSelect().addEventListener("change", () => {
        ui.resultsSubtitle().textContent = `Mode switched to ${ui.modeSelect().value}.`;
    });

    ui.liveRefreshToggle().addEventListener("change", (event) => {
        state.liveEnabled = Boolean(event.target.checked);
        configureLiveTimer();
        if (state.liveEnabled) {
            updateLiveFlights();
        }
    });

    ui.toggleMapViewBtn().addEventListener("click", toggleMapFocusMode);
    ui.recenterBtn().addEventListener("click", recenterMap);
    ui.fitTrackBtn().addEventListener("click", fitSelectedTrack);
    ui.toggleThemeBtn().addEventListener("click", toggleMapTheme);
    ui.closeDetailsBtn().addEventListener("click", closeFlightDetails);

    ui.mobileControlToggle().addEventListener("click", () => {
        ui.controlsPanel().classList.toggle("open");
    });

    ui.airportSearch().addEventListener("input", (event) => {
        const value = event.target.value.trim();

        if (state.selectedAirport && !value.startsWith(state.selectedAirport.icao)) {
            state.selectedAirport = null;
        }

        clearTimeout(state.airportSearchTimer);
        state.airportSearchTimer = setTimeout(() => {
            searchAirports(value);
        }, 260);
    });

    ui.airportSearch().addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            fetchFlights();
        }
    });

    document.addEventListener("click", (event) => {
        if (!ui.airportSearch().contains(event.target) && !ui.airportDropdown().contains(event.target)) {
            hideAirportDropdown();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            if (document.body.classList.contains("map-focus-mode")) {
                toggleMapFocusMode();
                return;
            }
            hideAirportDropdown();
            closeFlightDetails();
        }
    });

    window.addEventListener("resize", () => {
        if (state.map) {
            setTimeout(() => state.map.invalidateSize(), 150);
        }
    });
}

async function checkApiHealth() {
    try {
        const response = await fetch(apiUrl("/api/health"));
        const data = await response.json();

        if (!response.ok || !data.success) {
            ui.apiStatus().textContent = "API status: unavailable";
            ui.apiStatus().style.borderColor = "rgba(240, 102, 93, 0.6)";
            return;
        }

        if (data.credentials_configured) {
            ui.apiStatus().textContent = "API status: connected";
            ui.apiStatus().style.borderColor = "rgba(86, 209, 138, 0.6)";
        } else {
            ui.apiStatus().textContent = "API status: credentials missing";
            ui.apiStatus().style.borderColor = "rgba(240, 102, 93, 0.6)";
            showToast("OpenSky credentials are missing in .env", "error");
        }
    } catch (error) {
        ui.apiStatus().textContent = "API status: unreachable (start python3 server.py)";
        ui.apiStatus().style.borderColor = "rgba(240, 102, 93, 0.6)";
    }
}

async function searchAirports(query) {
    if (!query || query.length < 2) {
        hideAirportDropdown();
        return;
    }

    try {
        const response = await fetch(apiUrl("/api/search-airports", { q: query, limit: 12 }));
        const airports = await response.json();

        if (!Array.isArray(airports) || airports.length === 0) {
            hideAirportDropdown();
            return;
        }

        const dropdown = ui.airportDropdown();
        dropdown.innerHTML = "";

        airports.forEach((airport) => {
            const item = document.createElement("div");
            item.className = "dropdown-item";
            const label = airport.display_name || airport.name || airport.icao;
            item.innerHTML = `<strong>${escapeHtml(airport.icao)}</strong> - ${escapeHtml(label)}`;
            item.addEventListener("click", () => selectAirport(airport));
            dropdown.appendChild(item);
        });

        dropdown.classList.remove("hidden");
    } catch (error) {
        console.error("Airport search error", error);
    }
}

function hideAirportDropdown() {
    const dropdown = ui.airportDropdown();
    dropdown.classList.add("hidden");
    dropdown.innerHTML = "";
}

function selectAirport(airport) {
    state.selectedAirport = airport;
    const label = airport.display_name || airport.name || airport.icao;
    ui.airportSearch().value = `${airport.icao} - ${label}`;

    hideAirportDropdown();

    const lat = Number(airport.latitude);
    const lon = Number(airport.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon) && state.map) {
        state.map.flyTo([lat, lon], 8, { duration: 0.8 });
    }
}

async function loadPopularAirports() {
    try {
        const response = await fetch(apiUrl("/api/airports"));
        const airports = await response.json();

        const container = ui.popularAirports();
        container.innerHTML = "";

        if (!Array.isArray(airports) || airports.length === 0) {
            container.innerHTML = '<span class="muted">No airports available.</span>';
            return;
        }

        airports.forEach((airport) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "airport-chip";
            chip.textContent = `${airport.icao} ${airport.iata ? `(${airport.iata})` : ""}`.trim();
            chip.addEventListener("click", () => selectAirport(airport));
            container.appendChild(chip);
        });

        if (!state.selectedAirport) {
            selectAirport(airports[0]);
        }
    } catch (error) {
        showToast("Could not load popular airports", "error");
    }
}

function clearTrackLayer() {
    if (state.selectedTrackLayer && state.map) {
        state.map.removeLayer(state.selectedTrackLayer);
        state.selectedTrackLayer = null;
        state.selectedTrackBounds = null;
    }
}

function renderSummary(summary) {
    ui.statTotalFlights().textContent = String(summary?.total ?? 0);
    ui.statLiveFlights().textContent = String(summary?.live_airborne ?? 0);
    ui.statAirlines().textContent = String(summary?.unique_airlines ?? 0);
}

async function fetchFlights() {
    const airport = normalizeAirportFromInput();
    const date = ui.dateInput().value;
    const mode = ui.modeSelect().value;

    if (!airport) {
        showToast("Enter a valid 4-letter airport ICAO code.", "error");
        return;
    }

    if (!date) {
        showToast("Please choose a date.", "error");
        return;
    }

    const button = ui.fetchFlightsBtn();
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Loading...";

    try {
        const response = await fetch(apiUrl("/api/flights", { airport, date, mode }));
        const payload = await response.json();

        if (!response.ok || !payload.success) {
            const errorMessage = payload.error || `Request failed (${response.status})`;
            throw new Error(errorMessage);
        }

        state.flights = Array.isArray(payload.flights) ? payload.flights : [];
        state.selectedFlight = null;
        clearTrackLayer();
        closeFlightDetails();

        ui.resultsTitle().textContent = `${mode === "arrival" ? "Arrivals" : "Departures"} - ${payload.airport}`;
        ui.resultsSubtitle().textContent = `${payload.airport_name || payload.airport} - ${payload.date} (${payload.date_basis || "UTC"})`;
        ui.resultCount().textContent = String(payload.count || 0);
        ui.mapTitle().textContent = `${payload.airport} ${mode === "arrival" ? "arrivals" : "departures"}`;

        if (payload.airport_meta) {
            state.selectedAirport = payload.airport_meta;
        }

        renderSummary(payload.summary || {});
        renderFlightsList();

        if (payload.airport_meta) {
            const lat = Number(payload.airport_meta.latitude);
            const lon = Number(payload.airport_meta.longitude);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                state.map.flyTo([lat, lon], 8, { duration: 0.8 });
            }
        }

        showToast(`Loaded ${payload.count || 0} flights for ${payload.airport}`, "success");

        if (window.innerWidth <= 980) {
            ui.controlsPanel().classList.remove("open");
        }
    } catch (error) {
        console.error(error);
        showToast(error.message || "Failed to fetch flights", "error");
    } finally {
        button.textContent = originalLabel;
        button.disabled = false;
    }
}

function computeFilteredFlights() {
    const term = ui.flightFilterInput().value.trim().toLowerCase();
    const sortBy = ui.flightSortSelect().value;

    let flights = [...state.flights];

    if (term) {
        flights = flights.filter((flight) => {
            const haystack = [
                flight.callsign,
                flight.icao24,
                flight.airline_name,
                flight.airline_code,
                flight.departure_airport,
                flight.arrival_airport,
                flight.departure_airport_name,
                flight.arrival_airport_name,
            ]
                .join(" ")
                .toLowerCase();

            return haystack.includes(term);
        });
    }

    flights.sort((a, b) => {
        const timeA = a.primary_time || a.first_seen || a.last_seen || 0;
        const timeB = b.primary_time || b.first_seen || b.last_seen || 0;

        if (sortBy === "time_asc") return timeA - timeB;
        if (sortBy === "airline_asc") return (a.airline_name || "").localeCompare(b.airline_name || "");
        if (sortBy === "callsign_asc") return (a.callsign || "").localeCompare(b.callsign || "");
        return timeB - timeA;
    });

    state.filteredFlights = flights;
}

function renderFlightsList() {
    computeFilteredFlights();
    const container = ui.flightsList();
    container.innerHTML = "";

    if (state.filteredFlights.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = state.flights.length === 0 ? "No flights in this dataset." : "No flights match the filter.";
        container.appendChild(empty);
        ui.resultCount().textContent = "0";
        return;
    }

    ui.resultCount().textContent = String(state.filteredFlights.length);

    const selectedKey = state.selectedFlight ? flightKey(state.selectedFlight) : null;

    state.filteredFlights.forEach((flight, index) => {
        const card = document.createElement("article");
        card.className = "flight-card";
        card.style.setProperty("--stagger", String(index));

        const key = flightKey(flight);
        if (selectedKey && key === selectedKey) {
            card.classList.add("active");
        }

        const status = formatStatus(flight.status, flight.on_ground);
        const statusClass = `status-${(flight.status || "unknown").replace(/_/g, "-")}`;
        const timestamp = flight.primary_time || flight.first_seen || flight.last_seen;
        const callsignLabel = flight.callsign || flight.icao24?.toUpperCase() || "Unknown";

        card.innerHTML = `
            <div class="flight-header">
                <span class="callsign">${escapeHtml(callsignLabel)}</span>
                <span class="status-tag ${statusClass}">${escapeHtml(status)}</span>
            </div>
            <div class="route-line">
                <span>${escapeHtml(flight.departure_airport || "---")}</span>
                <span class="route-arrow">-></span>
                <span>${escapeHtml(flight.arrival_airport || "---")}</span>
            </div>
            <div class="flight-footer">
                <span>${escapeHtml(flight.airline_name || flight.airline_code || "Unknown airline")}</span>
                <span>${escapeHtml(formatTimeUtc(timestamp))}</span>
            </div>
        `;

        card.addEventListener("click", () => selectFlight(flight));
        container.appendChild(card);
    });
}

function highlightSelectedCard() {
    const cards = ui.flightsList().querySelectorAll(".flight-card");
    const selected = state.selectedFlight ? flightKey(state.selectedFlight) : null;

    cards.forEach((card, index) => {
        const flight = state.filteredFlights[index];
        if (!flight) return;
        card.classList.toggle("active", selected && flightKey(flight) === selected);
    });
}

function renderFlightDetails(flight) {
    ui.detailsCallsign().textContent = flight.callsign || flight.icao24?.toUpperCase() || "Unknown";
    ui.detailsAirline().textContent = flight.airline_name || flight.airline_code || "Unknown airline";
    ui.detailsRoute().textContent = routeLabelLong(flight);
    ui.detailsAltitude().textContent = formatAltitudeMeters(flight.baro_altitude ?? flight.geo_altitude);
    ui.detailsSpeed().textContent = formatSpeed(flight.velocity);
    ui.detailsStatus().textContent = formatStatus(flight.status, flight.on_ground);
}

function closeFlightDetails() {
    ui.flightDetailsPanel().classList.add("hidden");
    clearTrackLayer();
}

async function selectFlight(flight) {
    state.selectedFlight = { ...flight };
    highlightSelectedCard();

    renderFlightDetails(state.selectedFlight);
    ui.flightDetailsPanel().classList.remove("hidden");

    if (Number.isFinite(Number(flight.latitude)) && Number.isFinite(Number(flight.longitude))) {
        state.map.flyTo([Number(flight.latitude), Number(flight.longitude)], 8, { duration: 0.8 });
    }

    const selectionKey = flightKey(state.selectedFlight);
    loadTrackForSelectedFlight(selectionKey);
    loadAdditionalFlightInfo(flight.icao24, selectionKey);
}

async function loadAdditionalFlightInfo(icao24, expectedSelectionKey) {
    if (!icao24 || !state.selectedFlight || state.selectedFlight.icao24 !== icao24) return;

    try {
        const response = await fetch(apiUrl("/api/flight-info", { icao24 }));
        const payload = await response.json();

        if (!response.ok || !payload.success) return;
        if (!state.selectedFlight || state.selectedFlight.icao24 !== icao24) return;
        if (flightKey(state.selectedFlight) !== expectedSelectionKey) return;

        const hadNoRoute = state.selectedFlight.departure_airport === "---";

        state.selectedFlight = {
            ...state.selectedFlight,
            ...payload,
            departure_airport: payload.departure_airport || state.selectedFlight.departure_airport,
            arrival_airport: payload.arrival_airport || state.selectedFlight.arrival_airport,
            departure_airport_name: payload.departure_airport_name || state.selectedFlight.departure_airport_name,
            arrival_airport_name: payload.arrival_airport_name || state.selectedFlight.arrival_airport_name,
        };

        renderFlightDetails(state.selectedFlight);

        // If we now have better flight timing from flight-info and the track
        // previously failed (live pseudo-flight), retry track loading.
        if (hadNoRoute && (payload.first_seen || payload.last_seen)) {
            const updatedKey = flightKey(state.selectedFlight);
            loadTrackForSelectedFlight(updatedKey);
        }
    } catch (error) {
        console.error("flight-info error", error);
    }
}

let _trackAbortController = null;

async function loadTrackForSelectedFlight(expectedSelectionKey) {
    const flight = state.selectedFlight;
    if (!flight || !flight.icao24) return;

    // Cancel any previous in-flight track request
    if (_trackAbortController) {
        _trackAbortController.abort();
    }
    _trackAbortController = new AbortController();
    const { signal } = _trackAbortController;

    // Use ?? instead of || so that primary_time=0 (live track) is preserved
    const timeParam = flight.primary_time ?? flight.first_seen ?? flight.last_seen ?? 0;

    try {
        let response = null;
        let payload = null;

        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                response = await fetch(
                    apiUrl("/api/track", { icao24: flight.icao24, time: String(timeParam) }),
                    { signal }
                );
                payload = await response.json();
                break;
            } catch (requestError) {
                if (requestError?.name === "AbortError") {
                    throw requestError;
                }
                if (attempt === 1) {
                    throw requestError;
                }
                // Brief retry for transient network/API hiccups
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }

        if (!state.selectedFlight || flightKey(state.selectedFlight) !== expectedSelectionKey) {
            return;
        }

        clearTrackLayer();

        if (!response.ok || !payload.success || !payload.track || !Array.isArray(payload.track.path) || payload.track.path.length < 2) {
            drawAltitudeChart([]);
            ui.trackMeta().textContent = payload?.error || payload?.message || "No track available";
            return;
        }

        const validPath = payload.track.path
            .filter((row) => Array.isArray(row) && row.length >= 3 && row[1] !== null && row[2] !== null);

        const points = validPath.map((row) => [Number(row[1]), Number(row[2])]);

        const pathAltitudes = validPath.map((row) => {
            if (row.length < 4 || row[3] === null || row[3] === undefined) return null;
            const val = Number(row[3]);
            return Number.isFinite(val) ? val : null;
        });

        if (points.length < 2) {
            drawAltitudeChart(payload.track.path);
            ui.trackMeta().textContent = "Track has insufficient waypoints";
            return;
        }

        // Compute altitude range for color mapping
        const validAlts = pathAltitudes.filter((a) => a !== null);
        const trackMinAlt = validAlts.length ? Math.min(0, ...validAlts) : 0;
        const trackMaxAlt = validAlts.length ? Math.max(100, ...validAlts) : 100;

        // Build altitude-colored segments
        const layers = [];
        for (let i = 0; i < points.length - 1; i++) {
            const alt = pathAltitudes[i] ?? pathAltitudes[i + 1] ?? 0;
            const color = altitudeToColor(alt, trackMinAlt, trackMaxAlt);
            layers.push(
                L.polyline([points[i], points[i + 1]], {
                    color: color,
                    weight: 3,
                    opacity: 0.88,
                })
            );
        }

        const startMarker = L.circleMarker(points[0], {
            radius: 5,
            color: altitudeToColor(pathAltitudes[0] ?? 0, trackMinAlt, trackMaxAlt),
            fillColor: altitudeToColor(pathAltitudes[0] ?? 0, trackMinAlt, trackMaxAlt),
            fillOpacity: 0.95,
            weight: 1,
        });

        const endMarker = L.circleMarker(points[points.length - 1], {
            radius: 5,
            color: altitudeToColor(pathAltitudes[pathAltitudes.length - 1] ?? 0, trackMinAlt, trackMaxAlt),
            fillColor: altitudeToColor(pathAltitudes[pathAltitudes.length - 1] ?? 0, trackMinAlt, trackMaxAlt),
            fillOpacity: 0.95,
            weight: 1,
        });

        state.selectedTrackLayer = L.featureGroup([...layers, startMarker, endMarker]).addTo(state.map);

        // Draw the altitude chart BEFORE getBounds so the chart always renders
        drawAltitudeChart(payload.track.path);

        try {
            state.selectedTrackBounds = state.selectedTrackLayer.getBounds();
        } catch (boundsError) {
            console.warn("Could not compute track bounds", boundsError);
            state.selectedTrackBounds = null;
        }

        const duration = payload.summary?.duration_seconds;
        const durationMin = Number.isFinite(duration) ? Math.round(duration / 60) : null;
        const durationLabel = durationMin !== null ? `${durationMin} min` : "duration n/a";
        ui.trackMeta().textContent = `${payload.path_count || payload.track.path.length} points | ${durationLabel}`;
    } catch (error) {
        // Aborted requests (from selecting another flight) are expected — ignore them
        if (error.name === "AbortError") return;
        console.error("track error", error);
        drawAltitudeChart([]);
        ui.trackMeta().textContent = error.message
            ? `Track error: ${error.message}`
            : "Track request failed";
    }
}

function drawAltitudeChart(path) {
    const svg = ui.altitudeChart();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.onmousemove = null;
    svg.onmouseleave = null;
    svg.ontouchmove = null;
    svg.ontouchend = null;
    svg.ontouchcancel = null;

    if (!Array.isArray(path) || path.length < 2) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", "50%");
        text.setAttribute("y", "54%");
        text.setAttribute("fill", "#9ec1d8");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("font-size", "13");
        text.textContent = "No altitude profile available";
        svg.appendChild(text);
        return;
    }

    const width = 600;
    const height = 200;
    const padding = { top: 14, right: 14, bottom: 24, left: 46 };

    const rawAltitudes = path.map((point) => {
        if (!Array.isArray(point) || point.length < 4 || point[3] === null || point[3] === undefined) return null;
        const val = Number(point[3]);
        return Number.isFinite(val) ? val : null;
    });

    const altitudes = rawAltitudes.map((altitude, index) => {
        if (altitude !== null) return altitude;

        for (let back = index - 1; back >= 0; back -= 1) {
            if (rawAltitudes[back] !== null) return rawAltitudes[back];
        }

        return 0;
    });

    const minAlt = Math.min(0, ...altitudes);
    const maxAlt = Math.max(100, ...altitudes);
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const yForAlt = (alt) => {
        const span = maxAlt - minAlt || 1;
        return padding.top + chartHeight - ((alt - minAlt) / span) * chartHeight;
    };

    // Gridlines and labels
    for (let i = 0; i <= 4; i += 1) {
        const ratio = i / 4;
        const y = padding.top + chartHeight - ratio * chartHeight;
        const value = Math.round(minAlt + (maxAlt - minAlt) * ratio);

        const grid = document.createElementNS("http://www.w3.org/2000/svg", "line");
        grid.setAttribute("x1", String(padding.left));
        grid.setAttribute("x2", String(width - padding.right));
        grid.setAttribute("y1", String(y));
        grid.setAttribute("y2", String(y));
        grid.setAttribute("stroke", "rgba(158,193,216,0.2)");
        grid.setAttribute("stroke-width", "1");
        svg.appendChild(grid);

        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", String(padding.left - 8));
        label.setAttribute("y", String(y + 4));
        label.setAttribute("text-anchor", "end");
        label.setAttribute("fill", "#9ec1d8");
        label.setAttribute("font-size", "10");
        label.textContent = String(value);
        svg.appendChild(label);
    }

    // Compute point coordinates
    const pointCoords = altitudes.map((alt, index) => {
        const x = padding.left + (index / (altitudes.length - 1)) * chartWidth;
        const y = yForAlt(alt);
        return { x, y, alt };
    });

    // Gradient definition for the stroke and fill
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");

    const strokeGrad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    strokeGrad.setAttribute("id", "altStrokeGrad");
    strokeGrad.setAttribute("x1", "0%");
    strokeGrad.setAttribute("y1", "0%");
    strokeGrad.setAttribute("x2", "100%");
    strokeGrad.setAttribute("y2", "0%");

    const fillGrad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    fillGrad.setAttribute("id", "altFillGrad");
    fillGrad.setAttribute("x1", "0%");
    fillGrad.setAttribute("y1", "0%");
    fillGrad.setAttribute("x2", "100%");
    fillGrad.setAttribute("y2", "0%");

    altitudes.forEach((alt, index) => {
        const offset = `${(index / (altitudes.length - 1)) * 100}%`;
        const color = altitudeToColor(alt, minAlt, maxAlt);

        const stopStroke = document.createElementNS("http://www.w3.org/2000/svg", "stop");
        stopStroke.setAttribute("offset", offset);
        stopStroke.setAttribute("stop-color", color);
        strokeGrad.appendChild(stopStroke);

        const stopFill = document.createElementNS("http://www.w3.org/2000/svg", "stop");
        stopFill.setAttribute("offset", offset);
        stopFill.setAttribute("stop-color", color);
        stopFill.setAttribute("stop-opacity", "0.28");
        fillGrad.appendChild(stopFill);
    });

    defs.appendChild(strokeGrad);
    defs.appendChild(fillGrad);
    svg.appendChild(defs);

    // Area fill
    const pointsStr = pointCoords.map((p) => `${p.x},${p.y}`);
    const areaPoints = [
        `${padding.left},${padding.top + chartHeight}`,
        ...pointsStr,
        `${width - padding.right},${padding.top + chartHeight}`,
    ].join(" ");

    const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    area.setAttribute("points", areaPoints);
    area.setAttribute("fill", "url(#altFillGrad)");
    svg.appendChild(area);

    // Stroke line
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", pointsStr.join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "url(#altStrokeGrad)");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    svg.appendChild(line);

    const hoverGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    hoverGroup.setAttribute("display", "none");
    hoverGroup.setAttribute("pointer-events", "none");

    const hoverGuide = document.createElementNS("http://www.w3.org/2000/svg", "line");
    hoverGuide.setAttribute("y1", String(padding.top));
    hoverGuide.setAttribute("y2", String(padding.top + chartHeight));
    hoverGuide.setAttribute("stroke", "rgba(214, 236, 255, 0.78)");
    hoverGuide.setAttribute("stroke-width", "1");
    hoverGuide.setAttribute("stroke-dasharray", "3 3");

    const hoverDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hoverDot.setAttribute("r", "4.2");
    hoverDot.setAttribute("fill", "#e9f7ff");
    hoverDot.setAttribute("stroke", "#0e60d4");
    hoverDot.setAttribute("stroke-width", "2");

    const hoverLabelBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    hoverLabelBg.setAttribute("rx", "6");
    hoverLabelBg.setAttribute("ry", "6");
    hoverLabelBg.setAttribute("fill", "rgba(5, 24, 38, 0.9)");
    hoverLabelBg.setAttribute("stroke", "rgba(158, 193, 216, 0.55)");
    hoverLabelBg.setAttribute("stroke-width", "1");

    const hoverLabelText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    hoverLabelText.setAttribute("fill", "#dff3ff");
    hoverLabelText.setAttribute("font-size", "11");

    hoverGroup.appendChild(hoverGuide);
    hoverGroup.appendChild(hoverDot);
    hoverGroup.appendChild(hoverLabelBg);
    hoverGroup.appendChild(hoverLabelText);
    svg.appendChild(hoverGroup);

    const hideHover = () => {
        hoverGroup.setAttribute("display", "none");
    };

    const updateHoverAtClientX = (clientX) => {
        const bounds = svg.getBoundingClientRect();
        if (!bounds.width) return;

        const relativeX = ((clientX - bounds.left) / bounds.width) * width;
        const clampedX = Math.max(padding.left, Math.min(width - padding.right, relativeX));
        const ratio = (clampedX - padding.left) / chartWidth;
        const index = Math.max(0, Math.min(pointCoords.length - 1, Math.round(ratio * (pointCoords.length - 1))));
        const point = pointCoords[index];
        const altitudeValue = rawAltitudes[index];

        const altitudeLabel =
            altitudeValue === null
                ? "Altitude: n/a"
                : `Altitude: ${Math.round(altitudeValue).toLocaleString()} m`;

        hoverGuide.setAttribute("x1", String(point.x));
        hoverGuide.setAttribute("x2", String(point.x));
        hoverDot.setAttribute("cx", String(point.x));
        hoverDot.setAttribute("cy", String(point.y));

        hoverLabelText.textContent = altitudeLabel;

        const textPaddingX = 8;
        const labelHeight = 20;
        const textWidth = hoverLabelText.getComputedTextLength();
        const labelWidth = textWidth + textPaddingX * 2;

        let labelX = point.x + 12;
        if (labelX + labelWidth > width - padding.right) {
            labelX = point.x - labelWidth - 12;
        }
        labelX = Math.max(padding.left, labelX);

        let labelY = point.y - labelHeight - 10;
        if (labelY < padding.top + 2) {
            labelY = point.y + 10;
        }

        hoverLabelBg.setAttribute("x", String(labelX));
        hoverLabelBg.setAttribute("y", String(labelY));
        hoverLabelBg.setAttribute("width", String(labelWidth));
        hoverLabelBg.setAttribute("height", String(labelHeight));

        hoverLabelText.setAttribute("x", String(labelX + textPaddingX));
        hoverLabelText.setAttribute("y", String(labelY + 14));

        hoverGroup.setAttribute("display", "block");
    };

    svg.onmousemove = (event) => {
        updateHoverAtClientX(event.clientX);
    };

    svg.onmouseleave = hideHover;

    svg.ontouchmove = (event) => {
        if (event.touches && event.touches[0]) {
            updateHoverAtClientX(event.touches[0].clientX);
        }
    };

    svg.ontouchend = hideHover;
    svg.ontouchcancel = hideHover;
}

function buildLivePopup(stateVector) {
    const callsign = stateVector.callsign || stateVector.icao24?.toUpperCase() || "Unknown";
    return `
        <div style="min-width: 190px;">
            <strong>${escapeHtml(callsign)}</strong><br>
            ICAO24: ${escapeHtml(stateVector.icao24 || "--")}<br>
            Alt: ${escapeHtml(formatAltitudeMeters(stateVector.baro_altitude))}<br>
            Speed: ${escapeHtml(formatSpeed(stateVector.velocity))}
        </div>
    `;
}

function updateMarkerRecord(record, stateVector) {
    const lat = Number(stateVector.latitude);
    const lon = Number(stateVector.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    record.marker.setLatLng([lat, lon]);
    record.marker.setIcon(createPlaneIcon(stateVector.true_track, stateVector.on_ground));
    record.marker.setPopupContent(buildLivePopup(stateVector));
    record.stateVector = stateVector;
}

function createLiveMarker(stateVector) {
    const lat = Number(stateVector.latitude);
    const lon = Number(stateVector.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const marker = L.marker([lat, lon], {
        icon: createPlaneIcon(stateVector.true_track, stateVector.on_ground),
    });

    marker.bindPopup(buildLivePopup(stateVector));

    marker.on("click", () => {
        const existingFlight = state.flights.find((item) => item.icao24 === stateVector.icao24);

        if (existingFlight) {
            selectFlight(existingFlight);
            return;
        }

        const pseudoFlight = {
            icao24: stateVector.icao24,
            callsign: stateVector.callsign || stateVector.icao24?.toUpperCase(),
            airline_name: "Live traffic",
            departure_airport: "---",
            arrival_airport: "---",
            departure_airport_name: "Unknown",
            arrival_airport_name: "Unknown",
            baro_altitude: stateVector.baro_altitude,
            geo_altitude: stateVector.geo_altitude,
            velocity: stateVector.velocity,
            true_track: stateVector.true_track,
            on_ground: stateVector.on_ground,
            status: stateVector.on_ground ? "on_ground" : "airborne",
            latitude: stateVector.latitude,
            longitude: stateVector.longitude,
            first_seen: stateVector.last_contact,
            last_seen: stateVector.last_contact,
            primary_time: 0,
        };

        selectFlight(pseudoFlight);
    });

    marker.addTo(state.map);

    return {
        marker,
        stateVector,
    };
}

function syncLiveMarkers(states) {
    const liveIds = new Set(states.map((row) => row.icao24));

    for (const [icao24, record] of state.markers.entries()) {
        if (!liveIds.has(icao24)) {
            state.map.removeLayer(record.marker);
            state.markers.delete(icao24);
        }
    }

    states.forEach((stateVector) => {
        const key = stateVector.icao24;
        if (!key) return;

        const existing = state.markers.get(key);
        if (existing) {
            updateMarkerRecord(existing, stateVector);
        } else {
            const created = createLiveMarker(stateVector);
            if (created) {
                state.markers.set(key, created);
            }
        }
    });
}

async function updateLiveFlights() {
    if (!state.map || !state.liveEnabled || state.liveRequestInFlight) return;

    state.liveRequestInFlight = true;

    try {
        const bounds = state.map.getBounds();
        const latSpan = Math.abs(bounds.getNorth() - bounds.getSouth());
        const lonSpan = Math.abs(bounds.getEast() - bounds.getWest());
        const squareDegrees = latSpan * lonSpan;

        // Keep map polling inside a manageable viewport to avoid rapid API credit burn.
        if (squareDegrees > 350) {
            ui.liveStatusText().textContent = "Zoom in to refresh live traffic in this viewport.";
            ui.liveAircraftCount().textContent = "Viewport too wide";
            return;
        }

        const response = await fetch(
            apiUrl("/api/live-flights", {
                lamin: String(bounds.getSouth()),
                lomin: String(bounds.getWest()),
                lamax: String(bounds.getNorth()),
                lomax: String(bounds.getEast()),
            })
        );
        const payload = await response.json();

        if (!response.ok || !payload.success) {
            throw new Error(payload.error || `Live update failed (${response.status})`);
        }

        const states = Array.isArray(payload.states) ? payload.states : [];
        syncLiveMarkers(states);

        ui.liveAircraftCount().textContent = `${states.length} live aircraft`;
        ui.liveUpdateTime().textContent = `Last refresh: ${payload.time ? formatTimeUtc(payload.time) : "now"}`;
        ui.liveStatusText().textContent = `Tracking ${states.length} aircraft in current map viewport.`;
    } catch (error) {
        ui.liveStatusText().textContent = "Live refresh failed. Retrying...";
        console.error(error);
    } finally {
        state.liveRequestInFlight = false;
    }
}

function configureLiveTimer() {
    if (state.liveTimer) {
        clearInterval(state.liveTimer);
        state.liveTimer = null;
    }

    if (state.liveEnabled) {
        state.liveTimer = setInterval(updateLiveFlights, state.liveIntervalMs);
        ui.liveStatusText().textContent = "Auto refresh enabled.";
    } else {
        ui.liveStatusText().textContent = "Auto refresh paused.";
    }
}

function fitSelectedTrack() {
    if (state.selectedTrackBounds && state.selectedTrackBounds.isValid()) {
        state.map.fitBounds(state.selectedTrackBounds.pad(0.15));
        return;
    }

    showToast("No selected track to fit.", "error");
}

function recenterMap() {
    if (state.userLocationMarker) {
        const userLocation = state.userLocationMarker.getLatLng();
        const zoom = Math.max(state.map.getZoom(), 11);
        state.map.flyTo([userLocation.lat, userLocation.lng], zoom, { duration: 0.8 });
        return;
    }

    if (navigator.geolocation) {
        startUserLocationWatch();
        navigator.geolocation.getCurrentPosition(
            (position) => {
                updateUserLocationDisplay(position);
                const zoom = Math.max(state.map.getZoom(), 11);
                state.map.flyTo([position.coords.latitude, position.coords.longitude], zoom, { duration: 0.8 });
            },
            () => {
                if (flyToSelectedAirport()) return;
                showToast("Could not access your location.", "error");
            },
            { timeout: 6000 }
        );
        return;
    }

    if (!flyToSelectedAirport()) {
        showToast("Geolocation is not supported in this browser.", "error");
    }
}

async function bootstrap() {
    initMap();
    bindEvents();
    startUserLocationWatch();
    updateMapFocusButton();

    ui.dateInput().value = todayUtcDateInputValue();
    if (window.innerWidth <= 980) {
        ui.controlsPanel().classList.add("open");
    }

    setUtcClock();
    setInterval(setUtcClock, 1000);

    await checkApiHealth();
    await loadPopularAirports();

    // Auto-load flights for the default airport
    const airport = normalizeAirportFromInput();
    if (airport) {
        await fetchFlights();
    }

    configureLiveTimer();
    updateLiveFlights();
}

document.addEventListener("DOMContentLoaded", bootstrap);
