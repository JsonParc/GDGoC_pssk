/* 지도 위 실제 물 표면 (바다 · 강 · 호수)
   브이월드 지도의 물은 위성 사진일 뿐이라, OpenFreeMap 벡터 타일(OpenMapTiles 스키마, 팀원 기본 지도와 같은 원본)의
   water 다각형을 받아 물 재질(물결 · 반짝임)로 덮음.
   - 바다(ocean): 해수면 높이 (+ 기후변화 해수면 상승분)
   - 강 · 호수 · 저수지: 그 다각형 가장자리 지형 높이의 하위 25% + 0.4 m (지형보다 살짝 위)
   카메라 높이에 맞는 줌(z11 ~ z13)으로 화면에 보이는 타일만 받고, 멀어진 타일은 지움.
   데이터: © OpenMapTiles © OpenStreetMap contributors (ODbL) */
import * as PbfNS from 'https://cdn.jsdelivr.net/npm/pbf@3.2.1/+esm';
import * as VTNS from 'https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@1.3.1/+esm';
const Pbf = PbfNS.default || PbfNS;
const VectorTile = VTNS.VectorTile || (VTNS.default && VTNS.default.VectorTile);

const TILEJSON = 'https://tiles.openfreemap.org/planet';

export function createWaterLayer(viewer, Cesium) {
  const scene = viewer.scene;
  let template = null, enabled = false, seaLevel = 0, seaRise = 0;
  const tiles = new Map(); // key → { sea, inland, z, x, y }
  const look = { sea: new Cesium.Color(.04, .2, .27, 1), seaBlend: new Cesium.Color(.08, .32, .38, 1), inland: new Cesium.Color(.12, .22, .2, 1), inlandBlend: new Cesium.Color(.2, .3, .26, 1) };
  const normalMap = Cesium.buildModuleUrl('Assets/Textures/waterNormals.jpg');
  const material = (base, blend, freq, amp) => Cesium.Material.fromType('Water', { baseWaterColor: base, blendColor: blend, normalMap, frequency: freq, animationSpeed: .012, amplitude: amp, specularIntensity: .8, fadeFactor: 1 });
  const seaMat = () => material(look.sea, look.seaBlend, 9000, 6), inlandMat = () => material(look.inland, look.inlandBlend, 6000, 3);

  async function getTemplate() {
    if (!template) template = fetch(TILEJSON).then(r => r.json()).then(j => j.tiles[0]);
    return template;
  }
  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
  const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * 2 ** z); };

  async function loadTile(z, x, y) {
    const key = `${z}/${x}/${y}`; if (tiles.has(key)) return;
    const entry = { z, x, y, sea: null, inland: null }; tiles.set(key, entry);
    try {
      const url = (await getTemplate()).replace('{z}', z).replace('{x}', x).replace('{y}', y);
      const res = await fetch(url); if (!res.ok) return;
      const vt = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
      const layer = vt.layers.water; if (!layer || !tiles.has(key)) return;
      const sea = [], inland = [];
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i); if (f.type !== 3) continue;
        const gj = f.toGeoJSON(x, y, z), cls = f.properties.class;
        const polys = gj.geometry.type === 'Polygon' ? [gj.geometry.coordinates] : gj.geometry.coordinates;
        for (const rings of polys) (cls === 'ocean' ? sea : inland).push(rings);
      }
      // 강 · 호수 수면: 가장자리 지형 높이의 하위 25%
      const tp = viewer.terrainProvider, heights = [];
      for (const rings of inland) {
        const outer = rings[0], step = Math.max(1, Math.floor(outer.length / 16));
        const cartos = []; for (let i = 0; i < outer.length; i += step) cartos.push(Cesium.Cartographic.fromDegrees(outer[i][0], outer[i][1]));
        let hs = [];
        try { const s = await (tp.availability ? Cesium.sampleTerrainMostDetailed(tp, cartos) : Cesium.sampleTerrain(tp, 13, cartos)); hs = s.map(c => c.height).filter(Number.isFinite); } catch { /* 지형 표본 실패 */ }
        hs.sort((a, b) => a - b);
        heights.push(hs.length ? hs[Math.floor(hs.length * .25)] + .4 : seaLevel + .5);
      }
      if (!tiles.has(key)) return;
      const inst = (rings, h) => new Cesium.GeometryInstance({ geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(rings[0].flat()), rings.slice(1).map(r => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(r.flat())))),
        height: h, vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT }) });
      if (sea.length) entry.sea = scene.primitives.add(new Cesium.Primitive({ geometryInstances: sea.map(r => inst(r, 0)), appearance: new Cesium.EllipsoidSurfaceAppearance({ material: seaMat(), translucent: false }), show: enabled, asynchronous: false })); // 브이월드 빌드엔 다각형 작업 파일이 없어 바로 만듦
      if (inland.length) entry.inland = scene.primitives.add(new Cesium.Primitive({ geometryInstances: inland.map((r, i) => inst(r, heights[i])), appearance: new Cesium.EllipsoidSurfaceAppearance({ material: inlandMat(), translucent: false }), show: enabled, asynchronous: false }));
      placeSea(entry);
    } catch (e) { console.warn('물 타일', key, e); }
  }
  // 바다 높이: 다각형은 0 m로 만들고 모델 행렬로 해수면 + 상승분만큼 올림 (타일 가운데의 수직 방향)
  function placeSea(entry) {
    if (!entry.sea) return;
    const n = 2 ** entry.z, lon = (entry.x + .5) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (entry.y + .5) / n))) * 180 / Math.PI;
    const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(Cesium.Cartesian3.fromDegrees(lon, lat), new Cesium.Cartesian3());
    entry.sea.modelMatrix = Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.multiplyByScalar(up, seaLevel + seaRise + .3, new Cesium.Cartesian3()));
  }
  function drop(key) { const e = tiles.get(key); if (!e) return; if (e.sea) scene.primitives.remove(e.sea); if (e.inland) scene.primitives.remove(e.inland); tiles.delete(key); }

  function refresh() {
    if (!enabled) return;
    const c = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC); if (!c) return;
    const hgt = c.height - (scene.globe.getHeight(c) ?? 0);
    const z = hgt < 6000 ? 13 : hgt < 30000 ? 11 : hgt < 120000 ? 9 : null;
    if (z == null) { for (const k of [...tiles.keys()]) drop(k); return; }
    const rect = viewer.camera.computeViewRectangle(); if (!rect) return;
    const w = Cesium.Math.toDegrees(rect.west), e = Cesium.Math.toDegrees(rect.east), s = Cesium.Math.toDegrees(rect.south), nn = Cesium.Math.toDegrees(rect.north);
    const cx = lon2x(Cesium.Math.toDegrees(c.longitude), z), cy = lat2y(Cesium.Math.toDegrees(c.latitude), z);
    const want = [];
    for (let x = lon2x(w, z); x <= lon2x(e, z); x++) for (let y = lat2y(nn, z); y <= lat2y(s, z); y++) want.push([x, y, Math.hypot(x - cx, y - cy)]);
    want.sort((a, b) => a[2] - b[2]);
    const keep = new Set(want.slice(0, 30).map(([x, y]) => `${z}/${x}/${y}`));
    for (const k of [...tiles.keys()]) if (!keep.has(k)) drop(k);
    for (const k of keep) { const [zz, x, y] = k.split('/').map(Number); loadTile(zz, x, y); }
  }
  viewer.camera.moveEnd.addEventListener(refresh);

  return {
    setEnabled(on) { enabled = on; for (const e of tiles.values()) { if (e.sea) e.sea.show = on; if (e.inland) e.inland.show = on; } if (on) refresh(); },
    get enabled() { return enabled; },
    setSeaLevel(v) { seaLevel = v; for (const e of tiles.values()) placeSea(e); },
    setSeaRise(v) { if (Math.abs(v - seaRise) < .01) return; seaRise = v; for (const e of tiles.values()) placeSea(e); },
    // 바다 템플릿 색 (깊은 색 · 얕은 색)
    setColors(deep, shallow) {
      look.sea = deep.clone(); look.seaBlend = shallow.clone();
      look.inland = Cesium.Color.lerp(deep, new Cesium.Color(.2, .22, .14, 1), .45, new Cesium.Color()); look.inlandBlend = Cesium.Color.lerp(shallow, new Cesium.Color(.3, .3, .2, 1), .45, new Cesium.Color());
      for (const e of tiles.values()) {
        if (e.sea) { e.sea.appearance.material.uniforms.baseWaterColor = look.sea; e.sea.appearance.material.uniforms.blendColor = look.seaBlend; }
        if (e.inland) { e.inland.appearance.material.uniforms.baseWaterColor = look.inland; e.inland.appearance.material.uniforms.blendColor = look.inlandBlend; }
      }
    },
    refresh,
  };
}
