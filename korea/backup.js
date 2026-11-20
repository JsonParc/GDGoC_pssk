// 예비 지도 (브이월드 점검 · 장애 때). vworld.js와 같은 순서로 컨트롤 · 재난 패널을 붙이고 OpenStreetMap 3D 건물을 세움
import { demTiles, demZoom, getElevation } from './dem.js';
import { enableDisasterControls } from './disasters/controls.js';
import { attachDisasterPanel } from './disasters/panel.js';
import { createOsmBuildings } from './disasters/osm-buildings.js';

const { Cesium } = window;
Cesium.Ion.defaultAccessToken = '';

// AWS Terrarium DEM 타일 → Cesium 높이 격자 (65×65). z15보다 깊으면 z15 타일의 일부를 늘려 씀. 바다(음수)는 해수면 0으로
const tileCache = new Map();
async function terrariumTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (!tileCache.has(key)) {
    tileCache.set(key, (async () => {
      const res = await fetch(demTiles.replace('{z}', z).replace('{x}', x).replace('{y}', y));
      if (!res.ok) throw new Error('DEM ' + res.status);
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' });
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); bmp.close();
      return g.getImageData(0, 0, c.width, c.height);
    })());
    if (tileCache.size > 400) tileCache.delete(tileCache.keys().next().value);
  }
  return tileCache.get(key);
}
const SIZE = 65;
const terrain = new Cesium.CustomHeightmapTerrainProvider({
  width: SIZE, height: SIZE, tilingScheme: new Cesium.WebMercatorTilingScheme(),
  callback: async (x, y, level) => {
    const out = new Float32Array(SIZE * SIZE);
    try {
      const z = Math.min(level, demZoom), k = 2 ** (level - z), tx = Math.floor(x / k), ty = Math.floor(y / k);
      const img = await terrariumTile(z, tx, ty), W = img.width, d = img.data;
      const ox = (x - tx * k) / k, oy = (y - ty * k) / k;
      for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
        const px = Math.min(W - 1, Math.round((ox + i / (SIZE - 1) / k) * (W - 1))), py = Math.min(W - 1, Math.round((oy + j / (SIZE - 1) / k) * (W - 1)));
        const q = (py * W + px) * 4, h = d[q] * 256 + d[q + 1] + d[q + 2] / 256 - 32768;
        out[j * SIZE + i] = Math.max(0, h);
      }
    } catch { /* 타일 없음: 0 m */ }
    return out;
  },
});

const viewer = new Cesium.Viewer('vmap', {
  terrainProvider: terrain,
  imageryProvider: new Cesium.UrlTemplateImageryProvider({
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg', maximumLevel: 14,
    credit: 'EOxCloudless 2025 by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024 & 2025)',
  }),
  baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false,
  animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
});
viewer.scene.globe.depthTestAgainstTerrain = true;
// 시험은 한국 시간 정오 빛으로 (?time=ISO로 바꿀 수 있음)
viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(new URLSearchParams(location.search).get('time') || '2026-05-15T03:00:00Z');
viewer.scene.globe.enableLighting = true;
const params = new URLSearchParams(location.search);
const [lng, lat, h, pitch] = (params.get('view') || '126.978,37.552,1050,-30').split(',').map(Number);
viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(lng, lat, h), orientation: { heading: Cesium.Math.toRadians(+(params.get('heading') || 0)), pitch: Cesium.Math.toRadians(pitch), roll: 0 } });

const disasters = enableDisasterControls(viewer, Cesium);
const eventRegion = params.get('events') === 'nearby' ? { longitude: lng, latitude: lat } : params.get('events');
const disasterPanel = attachDisasterPanel({ viewer, Cesium, disasters, eventRegion });
createOsmBuildings(viewer, Cesium);
window.koreaVWorld = { viewer, getElevation, disasters, disasterPanel };
window.dispatchEvent(new Event('korea-vworld-ready'));
