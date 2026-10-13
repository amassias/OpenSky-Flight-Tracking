import { ChevronDown } from "./icons";

/** Kept apart from the airport reports so help never replaces live weather. */
export function WeatherGuide() {
  return (
    <details className="conditions-more weather-guide">
      <summary>
        <span>Weather guide · METAR & TAF</span>
        <ChevronDown size={12} className="panel-section-chevron" aria-hidden="true" />
      </summary>
      <div className="conditions-more-body">
        <h3>Observation or forecast?</h3>
        <p><strong>METAR</strong> reports the weather observed at a station. <strong>TAF</strong> forecasts conditions at an airport over a stated period. All report times use UTC, marked <code>Z</code>; the airport clock above uses local time.</p>
        <h3>Read a METAR</h3>
        <p className="conditions-note">Illustrative report, not the current weather:</p>
        <p className="raw-report"><code>METAR LFPG 131200Z 24012G22KT 8000 -RA BKN020 15/12 Q1013</code></p>
        <dl className="weather-code-list">
          <dt><code>LFPG · 131200Z</code></dt><dd>Paris CDG; day 13 at 12:00 UTC. The month and year come from the report date.</dd>
          <dt><code>24012G22KT</code></dt><dd>Wind from 240° at 12 knots, gusting to 22. <code>VRB</code> means variable direction; <code>00000KT</code> means calm.</dd>
          <dt><code>8000</code></dt><dd>Visibility of 8,000 metres. <code>9999</code> means 10 km or more; US reports often use <code>SM</code> (statute miles).</dd>
          <dt><code>-RA</code></dt><dd>Light rain. <code>RA</code> rain, <code>SN</code> snow, <code>FG</code> fog, <code>BR</code> mist, <code>SH</code> showers, <code>TS</code> thunderstorm. A minus sign means light, a plus means heavy.</dd>
          <dt><code>BKN020</code></dt><dd>Broken cloud at 2,000 ft above the station. <code>FEW</code> = 1–2 eighths of sky, <code>SCT</code> = 3–4, <code>BKN</code> = 5–7, <code>OVC</code> = overcast. The lowest BKN/OVC layer, or vertical visibility, defines the ceiling.</dd>
          <dt><code>15/12 · Q1013</code></dt><dd>Temperature 15°C, dew point 12°C; QNH (sea-level pressure used to set the altimeter) 1,013 hPa. <code>M02</code> means −2°C.</dd>
          <dt><code>CAVOK</code></dt><dd>Visibility at least 10 km, no significant weather or CB/TCU clouds, and no cloud below 5,000 ft or the highest minimum sector altitude, whichever is higher. It does not mean a cloudless sky.</dd>
        </dl>
        <h3>Read a TAF</h3>
        <p className="raw-report"><code>TAF LFPG 131100Z 1312/1412 24012KT 9999 SCT030 TEMPO 1314/1318 4000 SHRA BKN015</code></p>
        <p>This illustrative forecast is issued on day 13 at 11:00 UTC and valid from day 13 at 12:00 to day 14 at 12:00. It forecasts wind from 240° at 12 kt, visibility at least 10 km and scattered cloud at 3,000 ft. Temporarily between 14:00 and 18:00 on day 13: 4 km visibility, rain showers and a ceiling of 1,500 ft.</p>
        <dl className="weather-code-list">
          <dt><code>FM131600</code></dt><dd>New prevailing conditions from day 13 at 16:00 UTC.</dd>
          <dt><code>BECMG 1316/1318</code></dt><dd>A transition to new prevailing conditions during 16:00–18:00 UTC on day 13.</dd>
          <dt><code>TEMPO</code></dt><dd>Temporary changes, each lasting less than an hour and together less than half the stated period.</dd>
          <dt><code>PROB30 / PROB40</code></dt><dd>A 30% or 40% probability of the conditions that follow.</dd>
        </dl>
        <h3>Weather badges and runway hints</h3>
        <p>The badge uses the lower category from ceiling or visibility. <strong>VFR (visual)</strong>: above 3,000 ft and over 5 SM. <strong>MVFR (marginal)</strong>: 1,000–3,000 ft or 3–5 SM. <strong>IFR (instrument)</strong>: 500 to below 1,000 ft or 1 to below 3 SM. <strong>LIFR (low instrument)</strong>: below 500 ft or below 1 SM.</p>
        <p><strong>Head / cross</strong> shows the headwind and crosswind components in knots for the named runway end; a negative headwind is a tailwind. “Wind favours” is an estimate from surface wind, not a report of the runway in use.</p>
        <p className="conditions-note">A nearby station may supply the weather when this airport has no report; its distance and observation age appear above. These badges describe weather, not permission to fly.</p>
        <a href="https://aviationweather.gov/help/data/" target="_blank" rel="noreferrer">NOAA Aviation Weather Center · decoding reference</a>
      </div>
    </details>
  );
}
