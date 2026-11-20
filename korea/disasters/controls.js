import { getElevation } from '../dem.js';
import { createDisasterController } from './controller.js';

export function enableDisasterControls(viewer, Cesium) {
  const disasters = createDisasterController(viewer, Cesium);
  const panel = document.querySelector('#disaster-controls');
  const elevation = document.querySelector('#elevation');
  const markerButton = document.querySelector('#place-marker');
  let selected;
  let marker;
  panel.hidden = false;

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(async ({ position }) => {
    const ray = viewer.camera.getPickRay(position);
    const point = ray && viewer.scene.globe.pick(ray, viewer.scene);
    if (!point) return;
    const coordinate = Cesium.Cartographic.fromCartesian(point);
    const site = {
      longitude: Cesium.Math.toDegrees(coordinate.longitude),
      latitude: Cesium.Math.toDegrees(coordinate.latitude),
      terrainHeight: coordinate.height,
    };
    selected = site;
    window.dispatchEvent(new CustomEvent('korea-site-selected', { detail: site })); // 재난 패널이 발생 지점으로 씀
    markerButton.disabled = false;
    const label = `${site.latitude.toFixed(5)}°, ${site.longitude.toFixed(5)}°`;
    elevation.textContent = `${label} · DEM 조회 중…`;
    try {
      const height = await getElevation(site.longitude, site.latitude);
      if (selected === site) elevation.textContent = `${label} · DEM ${height.toFixed(1)} m`;
    } catch {
      if (selected === site) {
        elevation.textContent = `${label} · 지도 지형 높이 ${site.terrainHeight.toFixed(1)} m (타원체 기준)`;
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  markerButton.addEventListener('click', () => {
    if (!selected) return;
    if (marker) viewer.entities.remove(marker);
    marker = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(selected.longitude, selected.latitude, selected.terrainHeight + 5),
      ellipse: {
        semiMajorAxis: 11,
        semiMinorAxis: 11,
        material: Cesium.Color.fromCssColorString('#32d4bd').withAlpha(0.28),
      },
      model: {
        uri: new URL('./Box.glb', import.meta.url).href,
        scale: 4,
        minimumPixelSize: 11,
        maximumScale: 10,
      },
    });
    viewer.scene.requestRender();
  });

  return disasters;
}
