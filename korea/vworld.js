import { getElevation } from './dem.js';
import { enableLocationSearch } from './location-search.js';
import { enableDisasterControls } from './disasters/controls.js';
import { improveTileCoverage } from './tile-coverage.js';
import { attachDisasterPanel } from './disasters/panel.js';

const status = document.querySelector('#status');
const region = document.querySelector('#region');
const credentials = document.querySelector('#credentials');
const forget = document.querySelector('#forget');
const storageKey = 'korea-vworld-key';
// 브이월드가 점검 · 장애로 안 열리면 예비 지도(같은 재난 패널 · 효과, 공개 지형 · 영상 · OSM 건물)로 자동 전환
let ready = false;
const toBackup = reason => { if (ready) return; const q = new URLSearchParams(location.search); if (q.has('nofallback') || q.has('settings')) return; console.warn('브이월드 실패 → 예비 지도:', reason); location.replace('./backup.html?fallback=1'); };
// 브라우저에 저장한 키가 없으면 config.js의 배포용 키
const vworldKey = () => localStorage.getItem(storageKey) || window.KOREA_VWORLD_KEY || '';
const regions = {
  seoul: [126.978, 37.564, 1050, -44],
  korea: [127.8, 35.8, 780000, -90],
  bukhansan: [126.981, 37.627, 5200, -42],
  busan: [129.159, 35.145, 1500, -45],
  jeju: [126.53, 33.30, 8000, -45],
};

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

  const timer = setTimeout(() => {
    status.textContent = '브이월드 응답이 지연되고 있습니다. 예비 지도로 전환합니다…';
    setTimeout(() => toBackup('timeout'), 1500);
  }, 20000);

  vw.ws3dInitCallBack = () => {
    clearTimeout(timer);
    const { Cesium, ws3d } = window;
    const viewer = ws3d.viewer;
    improveTileCoverage(viewer.scene, Cesium);
    region.disabled = false;
    map.getElementById?.('poi_base')?.hide?.();
    ready = true;
    status.hidden = true;
    region.addEventListener('change', () => {
      const [lng, lat, height, tilt] = regions[region.value];
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, height),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(tilt), roll: 0 },
      });
    });

    const disasters = enableDisasterControls(viewer, Cesium);
    enableLocationSearch({ key: vworldKey(), viewer, Cesium });
    const disasterPanel = attachDisasterPanel({ viewer, Cesium, disasters }); // 재난 · 기후변화 패널 (오른쪽 위)
    window.koreaVWorld = { map, viewer, getElevation, disasters, disasterPanel };
    window.dispatchEvent(new Event('korea-vworld-ready'));
  };
  map.start();
}

const settingsMode = new URLSearchParams(location.search).has('settings');
// 브이월드 SDK 파일(map.vworld.kr)에서 지도가 준비되기 전에 오류가 나면 예비 지도로
window.addEventListener('error', e => { if (!ready && !settingsMode && /vworld\.kr/.test(e.filename || '')) toBackup('SDK 오류: ' + e.message); });
if (!vworldKey()) {
  // 키가 없으면 입력창 대신 바로 예비 지도 (키 설정은 vworld.html?settings=1)
  if (settingsMode) status.textContent = '브이월드 API 키를 설정하세요.'; else toBackup('키 없음');
} else {
  forget.hidden = false;
  status.textContent = '브이월드 지도를 불러오는 중…';
  try {
    if (window.vworldIsValid === 'false') throw new Error(window.vworldErrMsg || '브이월드 인증 실패');
    start();
  } catch (error) {
    status.textContent = error.message + ' 예비 지도로 전환합니다…';
    setTimeout(() => toBackup(error.message), 1500);
  }
}
