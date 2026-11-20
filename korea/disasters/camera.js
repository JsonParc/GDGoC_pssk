/* 재난 지점으로 카메라 이동 (재난 카드 · 지역 분석이 같이 씀)
   비 · 눈이 오는 재난(호우 · 태풍 · 대설)은 비구름 밑면(지면 위 약 400~1200 m, clouds.js)보다 낮게 지면 위 350 m에서 봄.
   예전엔 해발 1.6 km로 고정이라 산간(지면 해발 800 m 등)에선 카메라가 구름 속에 들어가 화면이 회색으로만 보였음.
   그 밖의 재난(산불 · 지진 등)은 넓게 보도록 지면 위 1.2 km */
export const UNDER_CLOUD = ['flood', 'typhoon', 'snow'];

async function terrainHeight(viewer, Cesium, at) {
  const c = Cesium.Cartographic.fromDegrees(at.longitude, at.latitude);
  try { // 먼 화면에서 받은 지형은 거칠어서, 지형 자료를 레벨 11로 따로 잼
    const [r] = await Cesium.sampleTerrain(viewer.terrainProvider, 11, [c]);
    if (Number.isFinite(r?.height)) return r.height;
  } catch { /* 아래 화면 지형으로 */ }
  const h = viewer.scene.globe.getHeight(c);
  return Number.isFinite(h) ? h : 0;
}

export async function flyToSite(viewer, Cesium, at, type) {
  if (!viewer || !Cesium || !Number.isFinite(at?.longitude) || !Number.isFinite(at?.latitude)) return;
  const low = UNDER_CLOUD.includes(type), ground = await terrainHeight(viewer, Cesium, at);
  const [back, up, pitch] = low ? [.0135, 350, -18] : [.027, 1200, -32]; // 지점 남쪽으로 물러난 거리(위도) · 지면 위 높이(m) · 내려다보는 각
  viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(at.longitude, at.latitude - back, ground + up),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(pitch), roll: 0 }, duration: 2.2 });
}

/* 날씨(비 · 눈 · 안개)는 카메라가 지면 위 약 8 km보다 높으면 안 보임 → 높을 때만 내려감 */
export function cameraIsHigh(viewer, Cesium, limit = 4000) {
  const c = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
  return !!c && c.height - (viewer.scene.globe.getHeight(c) ?? 0) > limit;
}
