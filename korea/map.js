import { demTiles, demZoom, getElevation } from './dem.js';
import { createDisasterLayers } from './disaster-layers.js';

const bounds = [[124.45, 32.8], [132.05, 38.65]];
const regions = {
  seoul: { center: [126.977, 37.574], zoom: 17, pitch: 58, bearing: -18 },
  bukhansan: { center: [126.984, 37.659], zoom: 13, pitch: 61, bearing: -24 },
  busan: { center: [129.158, 35.160], zoom: 16, pitch: 58, bearing: -20 },
  jeju: { center: [126.534, 33.362], zoom: 13, pitch: 62, bearing: 22 },
  dokdo: { center: [131.867, 37.242], zoom: 15, pitch: 54 },
};
const status = document.querySelector('#status');
const output = document.querySelector('#elevation');
const region = document.querySelector('#region');
const form = document.querySelector('#coordinates');
const buildings = document.querySelector('#buildings');
const imagery = document.querySelector('#imagery');
const sdk = window.maplibregl;

function startMap() {
  if (!sdk) throw new Error('MapLibre를 불러올 수 없습니다. CDN 연결을 확인하세요.');
  const map = new sdk.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/bright',
    ...regions.bukhansan,
    maxPitch: 75,
    maxZoom: 19,
    renderWorldCopies: false,
  });
  map.addControl(new sdk.NavigationControl({ visualizePitch: true }));
  const marker = new sdk.Marker({ color: '#18796a' });
  let selection = 0;
  let dataError = false;

  async function inspect(longitude, latitude) {
    const request = ++selection;
    const coord = `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°`;
    form.elements.lat.value = latitude.toFixed(6);
    form.elements.lng.value = longitude.toFixed(6);
    marker.setLngLat([longitude, latitude]).addTo(map);
    output.textContent = `${coord} · 고도 조회 중…`;
    try {
      const elevation = await getElevation(longitude, latitude);
      if (request === selection) output.textContent = `${coord} · DEM ${elevation.toFixed(1)} m`;
    } catch {
      if (request === selection) output.textContent = `${coord} · DEM 조회 실패. 연결을 확인한 뒤 다시 선택하세요.`;
    }
  }

  map.on('error', ({ error }) => {
    dataError = true;
    status.textContent = '일부 지도 데이터를 불러오지 못했습니다. 네트워크 또는 WebGL 상태를 확인하세요.';
    console.error(error);
  });

  map.once('load', () => {
    map.addSource('korea-dem', {
      type: 'raster-dem', tiles: [demTiles], tileSize: 256, maxzoom: demZoom,
      encoding: 'terrarium',
      attribution: '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen / AWS Terrain Tiles</a>',
    });
    map.setTerrain({ source: 'korea-dem', exaggeration: 1 });
    const overlay = map.getStyle().layers.find(layer => layer.type === 'line' || layer.type === 'symbol');
    map.addSource('korea-satellite', {
      type: 'raster',
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg'],
      tileSize: 256,
      maxzoom: 14,
      attribution: '<a href="https://cloudless.eox.at/">EOxCloudless</a> by <a href="https://eox.at/">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2024 &amp; 2025) · <a href="https://maps.eox.at/">EOX::Maps</a>',
    });
    map.addLayer({
      id: 'korea-satellite',
      type: 'raster',
      source: 'korea-satellite',
      layout: { visibility: imagery.checked ? 'visible' : 'none' },
      paint: { 'raster-fade-duration': 0 },
    }, overlay?.id);
    map.addLayer({
      id: 'korea-relief',
      type: 'hillshade',
      source: 'korea-dem',
      paint: {
        'hillshade-exaggeration': imagery.checked ? 0.35 : 0.65,
        'hillshade-shadow-color': '#34463b',
        'hillshade-highlight-color': '#fff7dc',
      },
    }, overlay?.id);
    const label = map.getStyle().layers.find(layer => layer.type === 'symbol' && layer.layout?.['text-field']);
    map.setLight({ anchor: 'map', position: [1.5, 220, 55], intensity: 0.55 });
    map.addLayer({
      id: 'korea-buildings',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 15,
      filter: ['!=', ['get', 'hide_3d'], true],
      layout: { visibility: buildings.checked ? 'visible' : 'none' },
      paint: {
        'fill-extrusion-color': [
          'to-color', ['get', 'colour'],
          ['step', ['coalesce', ['get', 'render_height'], 0],
            '#ded2bd', 20, '#c4b7aa', 55, '#a7b8c6', 150, '#738ea5'],
        ],
        'fill-extrusion-vertical-gradient': true,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      },
    }, label?.id);
    if (!dataError) status.textContent = '3D 건물은 확대하면 표시됩니다. 우클릭을 누르고 드래그하면 시점이 회전합니다.';
    window.koreaMap = { map, getElevation, disasters: createDisasterLayers(map, sdk.MercatorCoordinate) };
    window.dispatchEvent(new Event('korea-map-ready'));
  });

  map.on('click', ({ lngLat }) => {
    const point = lngLat.wrap();
    if (Math.abs(point.lat) <= 85) inspect(point.lng, point.lat);
  });

  region.addEventListener('change', () => {
    const location = regions[region.value];
    if (location) {
      map.flyTo(location);
      inspect(...location.center);
    } else {
      map.fitBounds(bounds, { padding: 30, maxZoom: 7, pitch: 0, bearing: 0 });
      selection++;
      marker.remove();
      form.reset();
      output.textContent = '지도를 클릭하면 좌표와 DEM 고도가 표시됩니다.';
    }
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const longitude = form.elements.lng.valueAsNumber;
    const latitude = form.elements.lat.valueAsNumber;
    map.flyTo({ center: [longitude, latitude], zoom: Math.max(14, map.getZoom()), pitch: 55 });
    inspect(longitude, latitude);
  });
  imagery.addEventListener('change', () => {
    if (map.getLayer('korea-satellite')) {
      map.setLayoutProperty('korea-satellite', 'visibility', imagery.checked ? 'visible' : 'none');
      map.setPaintProperty('korea-relief', 'hillshade-exaggeration', imagery.checked ? 0.35 : 0.65);
    }
  });
  buildings.addEventListener('change', () => {
    if (map.getLayer('korea-buildings')) {
      map.setLayoutProperty('korea-buildings', 'visibility', buildings.checked ? 'visible' : 'none');
    }
  });
}

try {
  startMap();
} catch (error) {
  status.textContent = error.message;
}
