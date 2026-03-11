const CONFIG = {
  mapProvider: {
    mapboxToken: "",
    mapboxStyle: "mapbox://styles/mapbox/navigation-night-v1"
  },
  riskThresholds: {
    low: 0.35,
    moderate: 0.6,
    high: 0.8
  }
};

const state = {
  beaches: [],
  gpv: null,
  spots: [],
  selectedSpot: null,
  map: null,
  markers: []
};

const colorByLevel = {
  low: "#58d68d",
  moderate: "#f4d03f",
  high: "#ff8a3d",
  extreme: "#ff4d6d"
};

const jpLabel = {
  low: "低い",
  moderate: "やや高い",
  high: "高い",
  extreme: "極めて高い"
};

const locationInput = document.getElementById("locationInput");
const searchButton = document.getElementById("searchButton");
const selectedSpotCard = document.getElementById("selectedSpotCard");
const updatedBadge = document.getElementById("updatedBadge");
const mapProviderSelect = document.getElementById("mapProvider");
const scenarioSelect = document.getElementById("scenarioSelect");

const scenarioPaths = {
  calm:   "./data/gpv-calm.json",
  normal: "./data/gpv-sample.json",
  storm:  "./data/gpv-storm.json"
};

init().catch((err) => {
  console.error(err);
  selectedSpotCard.innerHTML = "<h2>読み込みエラー</h2><p>データの取得に失敗しました。</p>";
});

async function init() {
  const [beaches, gpv] = await Promise.all([
    fetch("./data/beaches-jp.json").then((r) => r.json()),
    loadLatestGpv()
  ]);

  state.beaches = beaches;
  state.gpv = gpv;
  state.spots = beaches.map((beach) => buildSpotForecast(beach, gpv));

  updatedBadge.textContent = `更新: ${formatTimestamp(gpv.generatedAt)} JST`;

  setupMap("maplibre");
  renderMarkers();
  bindEvents();
}


async function loadLatestGpv() {
  try {
    const index = await fetch("./data/gpv-index.json").then((r) => r.json());
    const files = Array.isArray(index.files) ? index.files : [];
    if (files.length === 0) {
      return fetch("./data/gpv-sample.json").then((r) => r.json());
    }

    const gpvList = await Promise.all(
      files.map(async (path) => {
        try {
          const gpv = await fetch(path).then((r) => r.json());
          return isValidGpv(gpv) ? gpv : null;
        } catch {
          return null;
        }
      })
    );

    const validList = gpvList.filter(Boolean);
    if (validList.length === 0) {
      return fetch("./data/gpv-sample.json").then((r) => r.json());
    }

    validList.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
    return validList[0];
  } catch {
    return fetch("./data/gpv-sample.json").then((r) => r.json());
  }
}

function isValidGpv(gpv) {
  return (
    gpv &&
    typeof gpv.generatedAt === "string" &&
    Array.isArray(gpv.leadHours) &&
    Array.isArray(gpv.cells) &&
    gpv.cells.length > 0
  );
}
function bindEvents() {
  searchButton.addEventListener("click", onSearch);
  locationInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") onSearch();
  });

  mapProviderSelect.addEventListener("change", (event) => {
    setupMap(event.target.value);
    renderMarkers();
    if (state.selectedSpot) {
      flyToSpot(state.selectedSpot);
    }
  });

  scenarioSelect.addEventListener("change", async (event) => {
    const path = scenarioPaths[event.target.value];
    if (!path) return;
    const gpv = await fetch(path).then((r) => r.json());
    state.gpv = gpv;
    state.spots = state.beaches.map((beach) => buildSpotForecast(beach, gpv));
    updatedBadge.textContent = `更新: ${formatTimestamp(gpv.generatedAt)} JST`;
    renderMarkers();
    state.selectedSpot = null;
    selectedSpotCard.innerHTML = "<h2>地点を選択してください</h2><p>地図上のマーカーをクリックすると、6時間ごとの予報が表示されます。</p>";
  });
}

function setupMap(provider) {
  if (state.map) {
    state.markers.forEach((m) => m.remove());
    state.markers = [];
    state.map.remove();
  }

  const style = resolveMapStyle(provider);
  state.map = new maplibregl.Map({
    container: "map",
    style,
    center: [137.6, 36.2],
    zoom: 4.5,
    maxZoom: 16,
    attributionControl: false
  });

  state.map.addControl(new maplibregl.NavigationControl(), "top-right");
  state.map.addControl(new maplibregl.AttributionControl({ compact: true }));
}

function resolveMapStyle(provider) {
  if (provider === "mapbox") {
    if (!CONFIG.mapProvider.mapboxToken) {
      alert("Mapboxを利用するには app.js の mapboxToken を設定してください。標準地図に切り替えます。");
      mapProviderSelect.value = "maplibre";
      return baseStyle();
    }
    const style = CONFIG.mapProvider.mapboxStyle.startsWith("mapbox://")
      ? CONFIG.mapProvider.mapboxStyle.replace("mapbox://styles/", "https://api.mapbox.com/styles/v1/") + `?access_token=${CONFIG.mapProvider.mapboxToken}`
      : CONFIG.mapProvider.mapboxStyle;
    return style;
  }

  if (provider === "google") {
    alert("Google Maps連携は Places検索リンクで対応しています。地図表示は標準レイヤーを利用します。");
    mapProviderSelect.value = "maplibre";
  }

  return baseStyle();
}

function baseStyle() {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors"
      }
    },
    layers: [
      {
        id: "osm",
        type: "raster",
        source: "osm"
      }
    ]
  };
}

function renderMarkers() {
  state.markers.forEach((m) => m.remove());
  state.markers = [];

  state.spots.forEach((spot) => {
    const el = document.createElement("div");
    el.className = "marker";
    el.style.backgroundColor = colorByLevel[spot.current.level];
    el.title = `${spot.name} (${jpLabel[spot.current.level]})`;

    const popupHtml = `
      <div class="popup-body">
        <h3>${spot.name}</h3>
        <p>${spot.pref}</p>
        <p>現在リスク: <strong>${jpLabel[spot.current.level]}</strong></p>
        <p>波高 ${spot.current.waveHeightM.toFixed(1)} m / 周期 ${spot.current.wavePeriodS.toFixed(1)} s</p>
      </div>
    `;

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([spot.lon, spot.lat])
      .setPopup(new maplibregl.Popup({ offset: 20 }).setHTML(popupHtml))
      .addTo(state.map);

    el.addEventListener("click", () => selectSpot(spot.id));
    state.markers.push(marker);
  });
}

function selectSpot(spotId) {
  const spot = state.spots.find((s) => s.id === spotId);
  if (!spot) return;

  state.selectedSpot = spot;
  flyToSpot(spot);
  renderSpotCard(spot);
}

function flyToSpot(spot) {
  state.map.flyTo({
    center: [spot.lon, spot.lat],
    zoom: 10,
    speed: 0.8
  });
}

function renderSpotCard(spot) {
  const displayForecast = [...spot.forecast].sort((a, b) => new Date(b.time) - new Date(a.time));
  const rows = displayForecast
    .map((f) => {
      const tagStyle = `background:${colorByLevel[f.level]}`;
      return `
        <div class="forecast-row">
          <div>${formatTimestamp(f.time)}</div>
          <div class="value">${f.waveHeightM.toFixed(1)}m / ${f.wavePeriodS.toFixed(1)}s / ${Math.round(f.waveDirDeg)}°</div>
          <span class="forecast-tag" style="${tagStyle}">${jpLabel[f.level]}</span>
        </div>
      `;
    })
    .join("");

  selectedSpotCard.innerHTML = `
    <h2>${spot.name} <small>(${spot.pref})</small></h2>
    <p>現在の推定リスク: <strong style="color:${colorByLevel[spot.current.level]}">${jpLabel[spot.current.level]}</strong></p>
    <p>近傍GPVメッシュ: ${spot.mesh.lat.toFixed(2)}, ${spot.mesh.lon.toFixed(2)}</p>
    <p><a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" rel="noopener noreferrer">Google Mapsで開く</a></p>
    <div class="forecast-grid">${rows}</div>
  `;
}

async function onSearch() {
  const query = locationInput.value.trim();
  if (!query) return;

  const latlon = parseLatLon(query);
  if (latlon) {
    const nearest = findNearestSpot(latlon.lat, latlon.lon);
    selectSpot(nearest.id);
    return;
  }

  const local = findLocalSpot(query);
  if (local) {
    selectSpot(local.id);
    return;
  }

  const geocoded = await geocodeByNominatim(query);
  if (geocoded) {
    const nearest = findNearestSpot(geocoded.lat, geocoded.lon);
    selectSpot(nearest.id);
    return;
  }

  alert("地点を特定できませんでした。海岸名または緯度経度を確認してください。");
}

function findLocalSpot(query) {
  const normalized = query.toLowerCase();
  return state.spots.find((s) =>
    s.name.toLowerCase().includes(normalized) || s.pref.toLowerCase().includes(normalized)
  );
}

function parseLatLon(value) {
  const match = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;

  const lat = Number(match[1]);
  const lon = Number(match[2]);

  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (lat < 20 || lat > 50 || lon < 120 || lon > 155) return null;

  return { lat, lon };
}

async function geocodeByNominatim(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=jp&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { "Accept-Language": "ja" }
    });
    const result = await response.json();
    if (!Array.isArray(result) || result.length === 0) return null;
    return {
      lat: Number(result[0].lat),
      lon: Number(result[0].lon)
    };
  } catch (error) {
    console.warn("geocode error", error);
    return null;
  }
}

function buildSpotForecast(beach, gpv) {
  const mesh = findNearestMesh(beach.lat, beach.lon, gpv.cells);
  const forecast = gpv.leadHours.map((leadHour, idx) => {
    const time = addHours(gpv.generatedAt, leadHour);
    const waveHeightM = mesh.waveHeightM[idx];
    const wavePeriodS = mesh.wavePeriodS[idx];
    const waveDirDeg = mesh.waveDirDeg[idx];
    const score = calcRipScore({
      waveHeightM,
      wavePeriodS,
      waveDirDeg,
      shoreNormalDeg: beach.shoreNormalDeg
    });

    return {
      time,
      waveHeightM,
      wavePeriodS,
      waveDirDeg,
      score,
      level: scoreToLevel(score)
    };
  });

  return {
    ...beach,
    mesh,
    forecast,
    current: forecast[0]
  };
}

function calcRipScore({ waveHeightM, wavePeriodS, waveDirDeg, shoreNormalDeg }) {
  const heightNorm = clamp((waveHeightM - 0.3) / (3.0 - 0.3), 0, 1);
  const periodNorm = clamp((wavePeriodS - 4.0) / (12.0 - 4.0), 0, 1);

  const diff = angularDifferenceDeg(waveDirDeg, shoreNormalDeg);
  const approach = clamp(Math.cos((diff * Math.PI) / 180), 0, 1);

  const score = 0.45 * heightNorm + 0.30 * periodNorm + 0.25 * approach;
  return clamp(score, 0, 1);
}

function scoreToLevel(score) {
  if (score <= CONFIG.riskThresholds.low) return "low";
  if (score <= CONFIG.riskThresholds.moderate) return "moderate";
  if (score <= CONFIG.riskThresholds.high) return "high";
  return "extreme";
}

function findNearestMesh(lat, lon, cells) {
  let best = cells[0];
  let minDist = Infinity;

  cells.forEach((cell) => {
    const d = distanceKm(lat, lon, cell.lat, cell.lon);
    if (d < minDist) {
      minDist = d;
      best = cell;
    }
  });

  return best;
}

function findNearestSpot(lat, lon) {
  let best = state.spots[0];
  let minDist = Infinity;

  state.spots.forEach((spot) => {
    const d = distanceKm(lat, lon, spot.lat, spot.lon);
    if (d < minDist) {
      minDist = d;
      best = spot;
    }
  });

  return best;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function angularDifferenceDeg(a, b) {
  const diff = Math.abs(((a - b + 180) % 360) - 180);
  return diff;
}

function formatTimestamp(iso) {
  const dt = new Date(iso);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  const h = String(dt.getHours()).padStart(2, "0");
  return `${y}/${m}/${d} ${h}:00`;
}

function addHours(iso, hours) {
  const dt = new Date(iso);
  dt.setHours(dt.getHours() + hours);
  return dt.toISOString();
}





