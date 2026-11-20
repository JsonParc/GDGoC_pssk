import { getElevation } from './dem.js';
import { enableLocationSearch } from './location-search.js';
import { enableDisasterControls } from './disasters/controls.js';
import { improveTileCoverage } from './tile-coverage.js';
import { attachDisasterPanel } from './disasters/panel.js';
import { createOnboarding } from './onboarding.js';

const status = document.querySelector('#status');
const mapStart = document.querySelector('#map-start');
const region = document.querySelector('#region');
const credentials = document.querySelector('#credentials');
const forget = document.querySelector('#forget');
const storageKey = 'korea-vworld-key';
// 브이월드가 점검 · 장애로 안 열리면 예비 지도(같은 재난 패널 · 효과, 공개 지형 · 영상 · OSM 건물)로 자동 전환
let ready = false;
const pageOptions = new URLSearchParams(location.search);
const settingsMode = pageOptions.has('settings');
// 지도 상태: 브이월드가 늦게라도 뜨면(20초 지연 판정 뒤라도) 그 지도를 씀. 실패는 시작하기를 누른 순간에만 예비 지도로 보냄
let mapInfo = null, mapFailure = null;
const mapWaiters = [];
const mapState = () => mapInfo || (mapFailure ? { failure: mapFailure } : null);
const whenMap = () => mapState() ? Promise.resolve(mapState()) : new Promise(resolve => mapWaiters.push(resolve));
const settleMap = () => { for (const resolve of mapWaiters.splice(0)) resolve(mapState()); };
function toBackup(reason) {
  if (ready) return;
  mapFailure = reason;
  settleMap();
  if (settingsMode) {
    mapStart.hidden = true;
    status.textContent = reason;
    status.hidden = false;
  }
}
// 브라우저에 저장한 키가 없으면 config.js의 배포용 키
const vworldKey = () => localStorage.getItem(storageKey) || window.KOREA_VWORLD_KEY || '';
const regions = {
  seoul: [126.978, 37.564, 1050, -44],
  korea: [127.8, 35.8, 780000, -90],
  bukhansan: [126.981, 37.627, 5200, -42],
  busan: [129.159, 35.145, 1500, -45],
  jeju: [126.53, 33.30, 8000, -45],
};
function regionView(Cesium, [longitude, latitude, height, pitch]) {
  return {
    destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(pitch), roll: 0 },
  };
}

let workspace;
function openWorkspace({ map, viewer, Cesium }, eventRegion) {
  if (!workspace) {
    const disasters = enableDisasterControls(viewer, Cesium);
    enableLocationSearch({ key: vworldKey(), viewer, Cesium });
    workspace = attachDisasterPanel({ viewer, Cesium, disasters, eventRegion });
    window.koreaVWorld = { map, viewer, getElevation, disasters, disasterPanel: workspace };
    window.dispatchEvent(new Event('korea-vworld-ready'));
  }
  workspace?.setOpen(true);
  workspace?.cards?.setOpen(true);
}

const placeView = place => place.region ? regions[place.region] : [place.longitude, place.latitude, 1450, -47];
let previewRequest = 0;

async function previewMap(place) {
  const request = ++previewRequest;
  const { viewer, Cesium } = await whenMap();
  if (!viewer || request !== previewRequest) return;
  const view = regionView(Cesium, placeView(place));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) viewer.camera.setView(view);
  else viewer.camera.flyTo({ ...view, duration: 1.1 });
}

async function launch(place) {
  previewRequest++;
  const view = placeView(place);
  const eventRegion = place.region || { longitude: place.longitude, latitude: place.latitude };
  const map = await whenMap();
  if (map.failure) {
    if (pageOptions.has('nofallback')) throw new Error(map.failure);
    console.warn('브이월드 실패 → 예비 지도:', map.failure);
    const query = new URLSearchParams({ fallback: '1', view: view.join(','), events: place.region || 'nearby' });
    location.replace('./backup.html?' + query);
    return false;
  }
  const { viewer, Cesium } = map;
  region.value = place.region || '';
  const cameraView = regionView(Cesium, view);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) viewer.camera.setView(cameraView);
  else await new Promise(resolve => viewer.camera.flyTo({ ...cameraView, duration: 1.6, complete: resolve, cancel: resolve }));
  openWorkspace(map, eventRegion);
  return true;
}

if (!settingsMode) {
  createOnboarding({ key: vworldKey, launch, previewMap });
}

credentials.addEventListener('submit', event => {
  event.preventDefault();
  const key = document.querySelector('#api-key').value.trim();
  if (!key) return;
  localStorage.setItem(storageKey, key);
  location.reload();
});
forget.addEventListener('click', () => {
  localStorage.removeItem(storageKey);
  location.reload();
});

function start() {
  const { vw } = window;
  if (!vw?.Map) throw new Error('브이월드 SDK를 불러오지 못했습니다. 인증키와 등록 도메인을 확인하세요.');
  const [longitude, latitude, altitude, pitch] = regions.seoul;
  const map = new vw.Map();
  map.setOption({
    mapId: 'vmap',
    initPosition: new vw.CameraPosition(new vw.CoordZ(longitude, latitude, altitude), new vw.Direction(0, pitch, 0)),
    logo: true,
    navigation: true,
  });

  const timer = setTimeout(() => toBackup('지도 응답이 지연되고 있습니다.'), 20000);

  vw.ws3dInitCallBack = () => {
    clearTimeout(timer);
    const { Cesium, ws3d } = window;
    const viewer = ws3d.viewer;
    improveTileCoverage(viewer.scene, Cesium);
    region.disabled = false;
    map.getElementById?.('poi_base')?.hide?.();
    ready = true;
    status.hidden = true;
    region.addEventListener('change', () => viewer.camera.flyTo(regionView(Cesium, regions[region.value])));
    mapInfo = { map, viewer, Cesium };
    settleMap();
    if (settingsMode) openWorkspace(mapInfo);
  };
  map.start();
}

// 브이월드 SDK 파일(map.vworld.kr)에서 지도가 준비되기 전에 오류가 나면 예비 지도로
window.addEventListener('error', e => { if (!ready && !settingsMode && /vworld\.kr/.test(e.filename || '')) toBackup('SDK 오류: ' + e.message); });
if (!vworldKey()) {
  // 키가 없으면 입력창 대신 바로 예비 지도 (키 설정은 vworld.html?settings=1)
  toBackup('브이월드 API 키를 설정하세요.');
} else {
  forget.hidden = false;
  try {
    if (window.vworldIsValid === 'false') throw new Error(window.vworldErrMsg || '브이월드 인증 실패');
    start();
  } catch (error) {
    toBackup(error.message);
  }
}
