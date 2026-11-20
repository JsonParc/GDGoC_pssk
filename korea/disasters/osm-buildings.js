/* 예비 지도(브이월드 점검 · 장애 때)의 3D 건물: OpenFreeMap 벡터 타일(OpenStreetMap)의 building 외곽선을
   타일에 든 높이(render_height · render_min_height, 없으면 추정값)만큼 세움. 팀원 기본 지도(MapLibre)와 같은 원본 · 색.
   카메라가 지면 위 5 km 아래일 때 화면에 보이는 z14 타일만 받음.
   데이터: © OpenMapTiles © OpenStreetMap contributors (ODbL) */
import * as PbfNS from 'https://cdn.jsdelivr.net/npm/pbf@3.2.1/+esm';
import * as VTNS from 'https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@1.3.1/+esm';
const Pbf = PbfNS.default || PbfNS;
const VectorTile = VTNS.VectorTile || (VTNS.default && VTNS.default.VectorTile);
const TILEJSON = 'https://tiles.openfreemap.org/planet', Z = 14;

/* 지붕 눈: PerInstanceColorAppearance와 같은 꼭짓점 셰이더 + 위를 보는 면(지붕 · 옥상)만 눈 색으로 섞는 조각 셰이더.
   덮임 정도는 재질 하나(cover)로 모든 타일이 같이 씀 (fx.js가 'map-snow-cover' 이벤트로 알려 줌) */
const ROOF_VS = `attribute vec3 position3DHigh; attribute vec3 position3DLow; attribute vec3 normal; attribute vec4 color; attribute float batchId;
  varying vec3 v_positionEC; varying vec3 v_normalEC; varying vec4 v_color;
  void main(){ vec4 p = czm_computePosition(); v_positionEC = (czm_modelViewRelativeToEye*p).xyz; v_normalEC = czm_normal*normal; v_color = color;
    gl_Position = czm_modelViewProjectionRelativeToEye*p; }`;
const ROOF_FS = `varying vec3 v_positionEC; varying vec3 v_normalEC; varying vec4 v_color;
  void main(){
    vec3 toEye = -v_positionEC, n = normalize(v_normalEC);
    czm_materialInput mi; mi.normalEC = n; mi.positionToEyeEC = toEye;
    float cover = czm_getMaterial(mi).alpha;
    vec4 c = czm_gammaCorrect(v_color);
    vec3 upEC = normalize((czm_view*vec4(normalize((czm_inverseView*vec4(v_positionEC, 1.)).xyz), 0.)).xyz);
    float roof = smoothstep(.75, .95, dot(n, upEC));
    c.rgb = mix(c.rgb, vec3(.88, .9, .95), roof*clamp(cover*1.2, 0., 1.)*.88);
    czm_material m = czm_getDefaultMaterial(mi); m.diffuse = c.rgb; m.alpha = c.a;
    gl_FragColor = czm_phong(normalize(toEye), m, czm_lightDirectionEC);
  }`;

export function createOsmBuildings(viewer, Cesium) {
  const scene = viewer.scene, tiles = new Map();
  let template = null;
  const getTemplate = () => (template ??= fetch(TILEJSON).then(r => r.json()).then(j => j.tiles[0]));
  const lon2x = lon => Math.floor((lon + 180) / 360 * 2 ** Z);
  const lat2y = lat => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * 2 ** Z); };
  const roofSnow = new Cesium.Material({ fabric: { type: 'OsmRoofSnow', uniforms: { cover: 0 },
    source: 'czm_material czm_getMaterial(czm_materialInput mi){ czm_material m = czm_getDefaultMaterial(mi); m.alpha = cover; return m; }' } });
  const appearance = () => new Cesium.Appearance({ material: roofSnow, translucent: false, closed: true, vertexShaderSource: ROOF_VS, fragmentShaderSource: ROOF_FS,
    renderState: Cesium.Appearance.getDefaultRenderState(false, true) });
  addEventListener('map-snow-cover', e => { roofSnow.uniforms.cover = e.detail; });
  const colorFor = h => Cesium.Color.fromCssColorString(h < 20 ? '#ded2bd' : h < 55 ? '#c4b7aa' : h < 150 ? '#a7b8c6' : '#738ea5');

  async function load(x, y) {
    const key = `${x}/${y}`; if (tiles.has(key)) return;
    tiles.set(key, null);
    try {
      const res = await fetch((await getTemplate()).replace('{z}', Z).replace('{x}', x).replace('{y}', y)); if (!res.ok) return;
      const layer = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer()))).layers.building; if (!layer || !tiles.has(key)) return;
      const feats = [];
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i); if (f.type !== 3 || f.properties.hide_3d) continue;
        const gj = f.toGeoJSON(x, y, Z), polys = gj.geometry.type === 'Polygon' ? [gj.geometry.coordinates] : gj.geometry.coordinates;
        const h = +f.properties.render_height || 8, min = +f.properties.render_min_height || 0;
        for (const rings of polys) if (rings[0].length >= 4) feats.push({ rings, h, min, c: rings[0][0] });
      }
      if (!feats.length) return;
      // 건물 바닥 = 그 자리 지형 높이
      const tp = viewer.terrainProvider, cartos = feats.map(f => Cesium.Cartographic.fromDegrees(f.c[0], f.c[1]));
      let hs; try { hs = (await (tp.availability ? Cesium.sampleTerrainMostDetailed(tp, cartos) : Cesium.sampleTerrain(tp, 14, cartos))).map(c => c.height); } catch { hs = cartos.map(() => 0); }
      if (!tiles.has(key)) return;
      const instances = feats.map((f, i) => {
        const g = Number.isFinite(hs[i]) ? hs[i] : 0;
        return new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(f.rings[0].flat()), f.rings.slice(1).map(r => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(r.flat())))),
            height: g + f.min, extrudedHeight: g + f.h, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colorFor(f.h)) },
        });
      });
      tiles.set(key, scene.primitives.add(new Cesium.Primitive({ geometryInstances: instances, appearance: appearance() })));
    } catch (e) { console.warn('건물 타일', key, e); }
  }
  function refresh() {
    const c = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC); if (!c) return;
    const hgt = c.height - (scene.globe.getHeight(c) ?? 0);
    if (hgt > 5000) { for (const [k, p] of tiles) { if (p) scene.primitives.remove(p); tiles.delete(k); } return; }
    const rect = viewer.camera.computeViewRectangle(); if (!rect) return;
    const cx = lon2x(Cesium.Math.toDegrees(c.longitude)), cy = lat2y(Cesium.Math.toDegrees(c.latitude)), want = [];
    for (let x = lon2x(Cesium.Math.toDegrees(rect.west)); x <= lon2x(Cesium.Math.toDegrees(rect.east)); x++)
      for (let y = lat2y(Cesium.Math.toDegrees(rect.north)); y <= lat2y(Cesium.Math.toDegrees(rect.south)); y++) want.push([x, y, Math.hypot(x - cx, y - cy)]);
    want.sort((a, b) => a[2] - b[2]);
    const keep = new Set(want.slice(0, 16).map(([x, y]) => `${x}/${y}`));
    for (const [k, p] of tiles) if (!keep.has(k)) { if (p) scene.primitives.remove(p); tiles.delete(k); }
    for (const k of keep) { const [x, y] = k.split('/').map(Number); load(x, y); }
  }
  viewer.camera.moveEnd.addEventListener(refresh);
  setTimeout(refresh, 1500);
  return { refresh };
}
