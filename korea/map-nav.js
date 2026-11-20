/* 예비 지도용 지도 버튼: 브이월드 SDK 오른쪽 버튼과 같은 자리 · 역할 (북쪽 맞추기 · 확대 · 축소 · 처음 위치)
   마우스 조작(왼쪽 끌기 이동, 오른쪽 끌기 기울이기, 휠 확대)은 tile-coverage.js가 두 지도에 똑같이 맞춤 */
export function createMapNavigation(viewer, Cesium, homeView) {
  const nav = document.createElement('nav');
  nav.id = 'map-nav';
  nav.setAttribute('aria-label', '지도 조작');
  nav.innerHTML = `
    <button type="button" data-act="north" aria-label="북쪽을 위로" title="북쪽을 위로"><span class="map-nav-needle" aria-hidden="true"></span></button>
    <button type="button" data-act="in" aria-label="확대" title="확대">+</button>
    <button type="button" data-act="out" aria-label="축소" title="축소">−</button>
    <button type="button" data-act="home" aria-label="처음 위치로" title="처음 위치로"><span aria-hidden="true">↻</span><small>초기화</small></button>`;
  document.body.append(nav);
  const { camera, scene } = viewer;
  const needle = nav.querySelector('.map-nav-needle');

  // 화면 가운데 지면 (없으면 카메라 바로 아래)
  function centerPoint() {
    const canvas = scene.canvas;
    const ray = camera.getPickRay(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    return (ray && scene.globe.pick(ray, scene)) || null;
  }
  function heightAboveGround() {
    const c = Cesium.Cartographic.fromCartesian(camera.positionWC);
    return Math.max(10, c.height - (scene.globe.getHeight(c) ?? 0));
  }
  const actions = {
    north() {
      const center = centerPoint();
      if (!center) { camera.setView({ orientation: { heading: 0, pitch: camera.pitch, roll: 0 } }); return; }
      const range = Cesium.Cartesian3.distance(camera.positionWC, center);
      camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 0), {
        offset: new Cesium.HeadingPitchRange(0, camera.pitch, range), duration: .6,
      });
    },
    in() { camera.zoomIn(heightAboveGround() * .4); },
    out() { camera.zoomOut(heightAboveGround() * .6); },
    home() { camera.flyTo({ ...homeView, duration: 1.2 }); },
  };
  nav.addEventListener('click', event => {
    const button = event.target.closest('button[data-act]');
    if (button) actions[button.dataset.act]();
  });
  // 나침반 바늘: 카메라 방위만큼 반대로 돌림
  let last = NaN;
  scene.postRender.addEventListener(() => {
    const heading = camera.heading;
    if (Math.abs(heading - last) < 1e-3) return;
    last = heading;
    needle.style.rotate = `${-heading}rad`;
  });
  return nav;
}
