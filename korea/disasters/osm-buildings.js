/* 예비 지도(브이월드 점검 · 장애 때)의 3D 건물: OpenFreeMap 벡터 타일(OpenStreetMap)의 building 외곽선을
   타일에 든 높이(render_height · render_min_height, 없으면 추정값)만큼 세움. 팀원 기본 지도(MapLibre)와 같은 원본 · 색.
   카메라가 지면 위 5 km 아래일 때 화면에 보이는 z14 타일만 받음.
   데이터: © OpenMapTiles © OpenStreetMap contributors (ODbL) */
import * as PbfNS from 'https://cdn.jsdelivr.net/npm/pbf@3.2.1/+esm';
import * as VTNS from 'https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@1.3.1/+esm';
const Pbf = PbfNS.default || PbfNS;
const VectorTile = VTNS.VectorTile || (VTNS.default && VTNS.default.VectorTile);
const TILEJSON = 'https://tiles.openfreemap.org/planet', Z = 14;

export function createOsmBuildings(viewer, Cesium) {
  const scene = viewer.scene, tiles = new Map();
  let template = null;
  const getTemplate = () => (template ??= fetch(TILEJSON).then(r => r.json()).then(j => j.tiles[0]));
  const lon2x = lon => Math.floor((lon + 180) / 360 * 2 ** Z);
  const lat2y = lat => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * 2 ** Z); };
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
      tiles.set(key, scene.primitives.add(new Cesium.Primitive({ geometryInstances: instances, appearance: new Cesium.PerInstanceColorAppearance({ translucent: false }) })));
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
