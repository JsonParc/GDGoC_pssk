/* 브이월드(Cesium 1.99) 위 재난 · 기후변화 효과
   재난 종류 · 입력값 · 간이 공식은 템플릿 뷰어와 같은 js/disaster.js(window.DisasterFX)의 TYPES · Phys를 씀.
   모든 크기는 실제 m. 높이는 Cesium 타원체 높이이므로, 해수면(평균해수면의 타원체 높이 N)은
   선택 지점의 지도 지형 높이 − 공개 DEM 해발고도로 구함 (육지). 바다 위 지점이면 그 지형 높이 자체를 해수면으로 봄.

   효과 (재난마다 아래를 조합):
   - 시정 · 하늘: 깊이 버퍼로 거리마다 안개(시정 m) · 어두움 · 색 (후처리)
   - 비 · 눈: 화면 후처리 (흔히 쓰는 Cesium 비/눈 셰이더 형태), 바람 방향으로 기울어짐
   - 쌓인 눈: 깊이 버퍼에서 표면 방향을 구해 위를 보는 면(지형 · 건물 지붕)을 하얗게 (후처리)
   - 물: 해수면 + 상승분(또는 지형 + 침수 깊이) 높이의 물 재질 원판. 지형 · 건물보다 낮은 곳만 보이므로 DEM 그대로 잠김
   - 지진: 카메라 흔들림(카메라 위치의 지반 가속도) + 진도별 영향 반경 원
   - 산불: 바람 쪽으로 늘어진 타원 화선(빛나는 선) · 불탄 자리 · 불꽃 · 연기 입자(ParticleSystem, 실제 m)  */
import { getElevation } from '../dem.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t, sm = x => x * x * (3 - 2 * x);
const DX = () => window.DisasterFX;

function sprite(stops, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  return c.toDataURL();
}

/* ───── 후처리 셰이더 (Cesium 1.99 = WebGL1 GLSL) ───── */
// 깊이 → 눈 좌표: Cesium 1.99 내장 DepthOfField.glsl과 같은 방식 (후처리에서는 로그 깊이 변환이 따로 안 붙음)
const EYE = `vec3 eyeAt(vec2 uv){ float d = czm_readDepth(depthTexture, uv); vec4 e = czm_inverseProjection*vec4(uv*2. - 1., d, 1.); return e.xyz/e.w; }`;
const ATMOS_FS = `uniform sampler2D colorTexture; uniform sampler2D depthTexture; varying vec2 v_textureCoordinates;
  uniform float u_vis; uniform vec3 u_tint; uniform float u_tintAmt; uniform float u_gloom; uniform float u_heat; uniform float u_time; uniform float u_camH; uniform float u_layer;
  ${EYE}
  void main(){
    vec2 uv = v_textureCoordinates;
    // 폭염 아지랑이: 화면 아래(가까운 지면)일수록 흔들림
    uv.x += sin(uv.y*160. + u_time*5.)*.0007*u_heat*(1. - uv.y);
    vec4 col = texture2D(colorTexture, uv);
    float depth = czm_readDepth(depthTexture, uv);
    float fogK;
    // 비 · 눈 · 연기는 지면 위 u_layer(m) 안에만 있음: 시선이 그 층을 지나는 거리만 시정으로 셈 (위에서 내려다보면 덜 뿌옇게)
    float inLayer = clamp(u_layer/max(u_camH, 1.), 0., 1.);
    if (depth < 1.) { float dist = length(eyeAt(uv)); fogK = 1. - exp(-2.3*dist*inLayer/max(u_vis, 1.)); } // 시정 거리에서 약 90%
    else fogK = (1. - smoothstep(1500., 30000., u_vis))*inLayer;                                                 // 하늘: 층 안에서 시정이 짧을 때만 덮음
    vec3 fogC = mix(vec3(.74, .77, .8), u_tint, u_tintAmt)*(1. - .55*u_gloom);
    vec3 c = mix(col.rgb*(1. - .5*u_gloom), fogC, fogK);
    gl_FragColor = vec4(c, col.a);
  }`;
const RAIN_FS = `uniform sampler2D colorTexture; varying vec2 v_textureCoordinates; uniform float u_rain; uniform float u_angle; uniform float u_time;
  float hash(float x){ return fract(sin(x*133.3)*13.13); }
  void main(){
    vec2 res = czm_viewport.zw, uv = (gl_FragCoord.xy*2. - res)/min(res.x, res.y);
    float si = sin(u_angle), co = cos(u_angle);
    uv *= mat2(co, -si, si, co);
    uv *= length(uv + vec2(0., 4.9))*.3 + 1.;
    float v = 1. - sin(hash(floor(uv.x*100.))*2.);
    float b = clamp(abs(sin(20.*u_time*v + uv.y*(5./(2. + v)))) - .95, 0., 1.)*20.;
    vec3 c = vec3(.6, .7, .8)*v*b;
    gl_FragColor = mix(texture2D(colorTexture, v_textureCoordinates), vec4(c, 1.), .5*u_rain);
  }`;
const SNOW_FS = `uniform sampler2D colorTexture; varying vec2 v_textureCoordinates; uniform float u_snow; uniform float u_time; uniform float u_wind;
  float flake(vec2 uv, float scale){
    float w = 1. - smoothstep(0., 1., -uv.y*(scale/10.)); if (w < .1) return 0.;
    float t = u_time;
    uv += t/scale + vec2(u_wind*t/scale, 0.); uv.y += t*2./scale; uv.x += sin(uv.y + t*.5)/scale; uv *= scale;
    vec2 s = floor(uv), f = fract(uv), p = vec2(0.);
    p = .5 + .35*sin(11.*fract(sin((s + scale)*mat2(7, 3, 6, 5))*5.)) - f;
    float k = smoothstep(0., length(p), sin(f.x + f.y)*.01);
    return k*w;
  }
  void main(){
    vec2 res = czm_viewport.zw, uv = (gl_FragCoord.xy*2. - res)/min(res.x, res.y);
    float c = flake(uv, 10.) + flake(uv, 8.) + flake(uv, 6.) + flake(uv, 5.);
    if (u_snow > .5) c += flake(uv, 15.) + flake(uv, 20.);
    gl_FragColor = mix(texture2D(colorTexture, v_textureCoordinates), vec4(vec3(c), 1.), .55*clamp(u_snow, 0., 1.));
  }`;
const COVER_FS = `uniform sampler2D colorTexture; uniform sampler2D depthTexture; varying vec2 v_textureCoordinates; uniform vec3 u_upEC; uniform float u_cover;
  ${EYE}
  float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
  void main(){
    vec2 uv = v_textureCoordinates; vec4 col = texture2D(colorTexture, uv);
    float depth = czm_readDepth(depthTexture, uv);
    if (depth >= 1. || u_cover <= 0.) { gl_FragColor = col; return; }
    vec2 px = 1./czm_viewport.zw;
    vec3 p = eyeAt(uv), n = normalize(cross(eyeAt(uv + vec2(px.x, 0.)) - p, eyeAt(uv + vec2(0., px.y)) - p));
    if (dot(n, -p) < 0.) n = -n;
    float up = dot(n, u_upEC);
    float s = smoothstep(.5 - .25*u_cover, .85 - .2*u_cover, up)*clamp(u_cover*1.4, 0., 1.);
    s *= .85 + .15*h21(floor(gl_FragCoord.xy/3.));
    float lit = .78 + .22*max(dot(n, czm_sunDirectionEC), 0.);
    gl_FragColor = vec4(mix(col.rgb, vec3(.93, .95, .99)*lit, s), col.a);
  }`;

/* ───── 공유: 후처리 · 바다 · 해수면 ───── */
function createShared(viewer, Cesium) {
  const scene = viewer.scene, t0 = performance.now(), time = () => (performance.now() - t0) / 1000;
  const look = { vis: 40000, tint: new Cesium.Cartesian3(.75, .77, .8), tintAmt: 0, gloom: 0, heat: 0, rain: 0, snow: 0, cover: 0, wind: 0, dir: 0 };
  const cur = { ...look, tint: look.tint.clone() }; // 부드럽게 바뀌도록 따라감
  const upEC = new Cesium.Cartesian3(), scratch = new Cesium.Cartesian3();
  const stages = {
    cover: new Cesium.PostProcessStage({ fragmentShader: COVER_FS, uniforms: { u_cover: () => cur.cover, u_upEC: () => {
      const n = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(viewer.camera.positionWC, scratch);
      return Cesium.Cartesian3.normalize(Cesium.Matrix4.multiplyByPointAsVector(viewer.camera.viewMatrix, n, upEC), upEC);
    } } }),
    atmos: new Cesium.PostProcessStage({ fragmentShader: ATMOS_FS, uniforms: { u_vis: () => cur.vis, u_tint: () => cur.tint, u_tintAmt: () => cur.tintAmt, u_gloom: () => cur.gloom, u_heat: () => cur.heat, u_time: time, u_camH: () => camH, u_layer: () => 1200 } }),
    rain: new Cesium.PostProcessStage({ fragmentShader: RAIN_FS, uniforms: { u_rain: () => cur.rain * inLayer(), u_time: time, u_angle: () => rainAngle() } }),
    snow: new Cesium.PostProcessStage({ fragmentShader: SNOW_FS, uniforms: { u_snow: () => cur.snow * inLayer(), u_time: time, u_wind: () => clamp(cur.wind / 15, 0, 1.5) * windSide() } }),
  };
  for (const s of Object.values(stages)) { s.enabled = false; scene.postProcessStages.add(s); }
  // 카메라의 지면 위 높이: 비 · 눈 층(1.2 km) 위로 올라가면 화면 빗줄기를 줄임
  let camH = 100;
  const inLayer = () => .25 + .75 * clamp(1500 / Math.max(camH, 1), 0, 1);
  // 바람이 화면에서 어느 쪽으로 부는지 (비 기울기 · 눈 흐름)
  const windSide = () => Math.sin(((cur.dir + 180) * Math.PI / 180) - viewer.camera.heading);
  const rainAngle = () => -windSide() * clamp(cur.wind / 40, 0, .7);

  scene.preRender.addEventListener((_, now) => {
    const cc = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC); if (cc) camH = Math.max(1, cc.height - (scene.globe.getHeight(cc) ?? 0));
    const k = .05;
    for (const key of ['vis', 'tintAmt', 'gloom', 'heat', 'rain', 'snow', 'cover', 'wind']) cur[key] = lerp(cur[key], look[key], key === 'cover' ? .02 : k);
    cur.dir = look.dir; Cesium.Cartesian3.lerp(cur.tint, look.tint, k, cur.tint);
    stages.atmos.enabled = cur.vis < 39000 || cur.gloom > .01 || cur.tintAmt > .01 || cur.heat > .01;
    stages.rain.enabled = cur.rain > .01; stages.snow.enabled = cur.snow > .01; stages.cover.enabled = cur.cover > .005;
    for (const f of tickers) f(time());
  });
  viewer.scene.requestRenderMode = false; // 효과는 매 프레임 움직임
  viewer.clock.shouldAnimate = true;       // 파티클(불꽃 · 연기)은 장면 시계로 움직임

  function setLook(env = {}) {
    const c = env.tint != null ? Cesium.Color.fromCssColorString('#' + env.tint.toString(16).padStart(6, '0')) : null;
    Object.assign(look, {
      vis: env.vis ?? 40000, tintAmt: env.tintAmt ?? 0, gloom: (env.gloom ?? 0) * .6, // 너무 어두우면 건물이 안 보여서 60%만 heat: env.heat ?? 0,
      rain: clamp((env.rain ?? 0) / 100, 0, 1.2), snow: clamp((env.snow ?? 0) / 6, 0, 1.2), wind: env.wind ?? 0, dir: env.dir ?? 0,
    });
    if (c) look.tint = new Cesium.Cartesian3(c.red, c.green, c.blue);
  }
  const tickers = new Set();

  /* 해수면: 지도 지형에서 바다인 곳의 높이. 선택 지점 둘레(1~12 km) 점들 중 공개 DEM이 바다(< −1 m)인 곳의 지도 높이 중앙값.
     브이월드 · 시험 지도 모두 평균해수면 기준이라 보통 0 m 근처. 바다가 안 보이면 0 m */
  let seaN = null;
  async function seaLevelAt(longitude, latitude) {
    const globe = viewer.scene.globe, hs = [], jobs = [];
    for (const r of [1000, 3000, 6000, 12000]) for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, lo = longitude + Math.sin(a) * r / (111320 * Math.cos(latitude * Math.PI / 180)), la = latitude + Math.cos(a) * r / 110540;
      jobs.push(getElevation(lo, la).then(dem => { if (dem < -1) { const h = globe.getHeight(Cesium.Cartographic.fromDegrees(lo, la)); if (Number.isFinite(h)) hs.push(h); } }).catch(() => {}));
    }
    await Promise.all(jobs);
    hs.sort((x, y) => x - y);
    seaN = hs.length >= 3 ? clamp(hs[hs.length >> 1], -5, 60) : (seaN ?? 0);
    return seaN;
  }

  /* 물 원판: 중심 · 반지름(m) · 높이(타원체 m) · 색. 높이는 setHeight로 바로 바꿈 */
  function water({ longitude, latitude, radius, color, frequency = 6000, amplitude = 6, speed = .015, polygon = null }) {
    const center = Cesium.Cartesian3.fromDegrees(longitude, latitude), normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(center, new Cesium.Cartesian3());
    // 그린 영역이 있으면 그 다각형만, 없으면 반지름 radius 원
    const geometry = polygon
      ? new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(polygon.map(([lo, la]) => Cesium.Cartesian3.fromDegrees(lo, la))), height: 0, vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT })
      : new Cesium.EllipseGeometry({ center, semiMajorAxis: radius, semiMinorAxis: radius, height: 0, granularity: Cesium.Math.toRadians(.05), vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT });
    const prim = scene.primitives.add(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance: new Cesium.EllipsoidSurfaceAppearance({ aboveGround: true, material: Cesium.Material.fromType('Water', {
        baseWaterColor: color, blendColor: Cesium.Color.fromAlpha(color, 1), normalMap: Cesium.buildModuleUrl('Assets/Textures/waterNormals.jpg'),
        frequency, animationSpeed: speed, amplitude, specularIntensity: .7, fadeFactor: 1 }) }),
      asynchronous: false,
    }));
    const off = new Cesium.Cartesian3();
    return {
      prim,
      setHeight(h) { prim.show = Number.isFinite(h); if (prim.show) prim.modelMatrix = Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.multiplyByScalar(normal, h, off)); },
      setColor(c) { prim.appearance.material.uniforms.baseWaterColor = c; },
      destroy() { scene.primitives.remove(prim); },
    };
  }

  /* 바다 물결: 카메라 둘레 60 km를 실제 해수면 높이로 덮음 (육지는 지형이 가림). 카메라가 25 km 넘게 움직이면 옮김 */
  let ocean = null, oceanAt = null;
  const oceanTick = () => {
    const c = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
    if (!c || c.height > 300000) { if (ocean) ocean.prim.show = false; return; }
    const lon = Cesium.Math.toDegrees(c.longitude), lat = Cesium.Math.toDegrees(c.latitude);
    if (!ocean || Cesium.Cartesian3.distance(Cesium.Cartesian3.fromDegrees(lon, lat), Cesium.Cartesian3.fromDegrees(...oceanAt)) > 25000) {
      ocean?.destroy(); oceanAt = [lon, lat];
      ocean = water({ longitude: lon, latitude: lat, radius: 60000, color: new Cesium.Color(.05, .22, .32, .92), frequency: 9000, amplitude: 8, speed: .01 });
    }
    ocean.setHeight((seaN ?? 0) + .4 + (seaRise || 0));
  };
  let seaRise = 0;
  function setOcean(on) {
    if (on) { tickers.add(oceanTick); if (seaN == null) { const c = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC); seaLevelAt(Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)); } }
    else { tickers.delete(oceanTick); ocean?.destroy(); ocean = null; }
  }

  /* 땅 위 원 (진도 · 화선 등) */
  const ringPositions = (lon, lat, rE, rN = rE, rot = 0, offE = 0, offN = 0, n = 96, jitter = 0, seed = 1) => {
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(lon, lat)), out = [];
    for (let i = 0; i <= n; i++) {
      const a = i / n * Math.PI * 2, j = 1 + jitter * (Math.sin(a * 5 + seed) * .5 + Math.sin(a * 11 + seed * 2.3) * .3 + Math.sin(a * 23 + seed * 4.1) * .2);
      const x = Math.cos(a) * rE * j, y = Math.sin(a) * rN * j;
      const e = offE + x * Math.cos(rot) - y * Math.sin(rot), nn = offN + x * Math.sin(rot) + y * Math.cos(rot);
      out.push(Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(e, nn, 0), new Cesium.Cartesian3()));
    }
    return out;
  };

  return { look, cur, get camH() { return camH; }, setLook, seaLevelAt, get seaLevel() { return seaN; }, water, setOcean, set seaRise(v) { seaRise = v; }, tickers, time, ringPositions };
}

/* ───── 재난별 효과 ───── */
function createEffect(type, ctx, S) {
  const { viewer, Cesium, longitude, latitude, groundHeight } = ctx, scene = viewer.scene;
  const def = DX().TYPES[type], Phys = DX().Phys;
  let p = normalize(ctx.params), env = def.env(p);
  function normalize(q = {}) {
    const o = {}; for (const d of def.params) o[d.key] = clamp(Number.isFinite(+q[d.key]) ? +q[d.key] : d.value, d.min, d.max);
    o.polygon = Array.isArray(q.polygon) && q.polygon.length >= 3 ? q.polygon : null; // 지도에 그린 영역 [[경도, 위도], …]
    return o;
  }
  const parts = [], entities = [], tick = new Set(), add = e => (entities.push(viewer.entities.add(e)), entities[entities.length - 1]);
  let sea = 0, alive = true;
  S.seaLevelAt(longitude, latitude).then(v => { sea = v; if (alive) apply(); });

  // 물 높이를 쓰는 재난: 기준(해수면 또는 선택 지점 지형) + 높이
  const waterSpec = {
    typhoon: { radius: 30000, color: new Cesium.Color(.24, .27, .24, .9), base: 'sea' },
    flood: { radius: 4000, color: new Cesium.Color(.38, .3, .18, .93), base: 'ground', frequency: 3000, amplitude: 3 },
    tsunami: { radius: 30000, color: new Cesium.Color(.27, .27, .2, .93), base: 'sea' },
    sealevel: { radius: 50000, color: new Cesium.Color(.06, .25, .33, .9), base: 'sea' },
  }[type];
  let water = null;
  if (waterSpec) { water = S.water({ longitude, latitude, ...waterSpec, polygon: type === 'flood' ? p.polygon : null }); parts.push(water); }

  /* 지진: 진도 반경 원 + 카메라 위치의 흔들림 */
  let quake = null;
  /* 산불 */
  let fire = null;

  function apply() {
    env = def.env(p);
    // 산불: 연기는 입자로 직접 보이므로 화면 전체 연무는 옅게 (후처리 안개가 반투명 입자 위에 덮여 연기를 가리지 않게)
    S.setLook(type === 'wildfire' ? { ...env, vis: Math.max(env.vis, 30000), tintAmt: (env.tintAmt || 0) * .4, gloom: 0 } : env);
    if (water) {
      const lv = type === 'flood' ? groundHeight + (env.water || 0) : type === 'tsunami' ? null : sea + (env.water || 0);
      if (lv != null) water.setHeight(lv);
    }
    if (type === 'sealevel') S.seaRise = p.rise; else S.seaRise = 0;
    if (type === 'quake') buildQuake();
    if (type === 'wildfire') buildFire();
    if (type === 'snow') snowStart = S.time();
  }

  /* ── 지진 ── */
  function buildQuake() {
    for (const e of entities.splice(0)) viewer.entities.remove(e);
    const M = p.M, depth = p.depth, colors = { 5: '#9be564', 6: '#f2d544', 7: '#f59a32', 8: '#e8562c', 9: '#b0182c' };
    const radiusFor = lvl => { let lo = 0, hi = 2000; if (Phys.mmi(Phys.pga(M, depth, 0)) < lvl) return 0; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (Phys.mmi(Phys.pga(M, depth, m)) >= lvl) lo = m; else hi = m; } return lo; };
    for (const lvl of [9, 8, 7, 6, 5]) {
      const r = radiusFor(lvl) * 1000; if (r < 50) continue;
      add({ polyline: { positions: S.ringPositions(longitude, latitude, r), clampToGround: true, width: 3, material: Cesium.Color.fromCssColorString(colors[lvl]).withAlpha(.9) } });
      add({ position: Cesium.Cartesian3.fromDegrees(longitude, latitude + r / 111320, 0), label: { text: `진도 ${['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ'][lvl]} (${(r / 1000).toFixed(1)} km)`, font: '600 13px system-ui', fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    }
    add({ position: Cesium.Cartesian3.fromDegrees(longitude, latitude), point: { pixelSize: 10, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    quake = { t0: S.time() };
  }
  let shakePrev = { x: 0, y: 0, z: 0 };
  tick.add(now => {
    if (type !== 'quake' || !quake) return;
    const cam = viewer.camera;
    cam.lookRight(-shakePrev.x); cam.lookUp(-shakePrev.y); cam.twistRight(-shakePrev.z);
    // 카메라 아래 지점과 진앙 사이 거리로 그 자리 지반 가속도
    const c = Cesium.Cartographic.fromCartesian(cam.positionWC);
    const d = c ? Cesium.Cartesian3.distance(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude), Cesium.Cartesian3.fromDegrees(longitude, latitude)) / 1000 : p.dist;
    const pga = Phys.pga(p.M, p.depth, d), dur = clamp(Phys.shakeSeconds(p.M), 3, 60), cyc = dur + 4, ph = ((now - quake.t0) % cyc) / dur;
    const envl = ph > 1 ? 0 : Math.min(1, ph / .12) * Math.pow(1 - ph, .6), a = clamp(pga, 0, 2) * envl * .03, w = now * 2 * Math.PI * 1.5;
    shakePrev = { x: Math.sin(w * 1.1) * a, y: Math.sin(w * .9 + 3) * a, z: Math.sin(w * 1.4 + 5) * a * .5 };
    cam.lookRight(shakePrev.x); cam.lookUp(shakePrev.y); cam.twistRight(shakePrev.z);
  });

  /* ── 산불: 그린 영역(없으면 바람 쪽으로 늘어진 타원, 면적 = 피해 면적)을 발화점에서 바깥으로 태움 (30초 타임랩스) ──
     영역 안을 불꽃 수천 개(실제 불꽃 높이, m)로 채움: 지금 번지는 화선 근처는 활활, 지나간 자리는 잔불로 줄어듦. 연기는 입자 */
  const FLAME = sprite([[0, 'rgba(255,240,190,1)'], [.25, 'rgba(255,170,60,.9)'], [.6, 'rgba(230,70,15,.45)'], [1, 'rgba(120,20,0,0)']]);
  const GLOW = sprite([[0, 'rgba(255,160,60,.6)'], [.45, 'rgba(255,100,25,.2)'], [1, 'rgba(255,60,0,0)']]);
  const SMOKE = sprite([[0, 'rgba(70,64,60,.75)'], [.5, 'rgba(90,86,82,.35)'], [1, 'rgba(110,108,105,0)']]);
  const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
  const areaOf = poly => Math.abs(poly.reduce((acc, [x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; return acc + x * y2 - x2 * y; }, 0)) / 2;
  // 발화점 o에서 점 q 방향으로 경계까지 거리 대비 비율 (0 = 발화점, 1 = 경계): 영역 모양 그대로 번짐
  function relOf(q, o, poly) {
    const dx = q[0] - o[0], dy = q[1] - o[1], len = Math.hypot(dx, dy); if (len < 1e-6) return 0;
    let tMin = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length], ex = x2 - x1, ey = y2 - y1, den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) continue;
      const t = ((x1 - o[0]) * ey - (y1 - o[1]) * ex) / den, u = ((x1 - o[0]) * dy - (y1 - o[1]) * dx) / den;
      if (t > 1e-9 && u >= 0 && u <= 1) tMin = Math.min(tMin, t);
    }
    return Number.isFinite(tMin) ? clamp(1 / tMin, 0, 1) : 1;
  }
  function clearFire() {
    if (!fire) return;
    scene.primitives.remove(fire.bbs); for (const ps of fire.smoke) scene.primitives.remove(ps);
    viewer.entities.remove(fire.scar); viewer.entities.remove(fire.front); fire = null;
  }
  function buildFire() {
    clearFire();
    const q = p, dry = clamp((100 - q.humidity) / 80, .2, 1), fh = Phys.flameHeight(q.wind, dry);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(longitude, latitude)), inv = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4());
    const toLocal = (lo, la) => { const v = Cesium.Matrix4.multiplyByPoint(inv, Cesium.Cartesian3.fromDegrees(lo, la), new Cesium.Cartesian3()); return [v.x, v.y]; };
    const toCarto = (x, y) => Cesium.Cartographic.fromCartesian(Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(x, y, 0), new Cesium.Cartesian3()));
    let poly;
    if (q.polygon) poly = q.polygon.map(([lo, la]) => toLocal(lo, la));
    else { // 바람이 불어가는 쪽으로 늘어진 타원 (면적 = 피해 면적), 가장자리를 조금 들쭉날쭉하게
      const R = Math.sqrt(q.area * 1e4 / Math.PI), to = (q.dir + 180) * Math.PI / 180, st = 1 + clamp(q.wind / 20, 0, 1.2), A = R * Math.sqrt(st), B = R / Math.sqrt(st);
      const d = [Math.sin(to), Math.cos(to)], n = [Math.cos(to), -Math.sin(to)]; poly = [];
      for (let i = 0; i < 72; i++) { const t = i / 72 * Math.PI * 2, j = 1 + .07 * (Math.sin(t * 5 + q.area) * .5 + Math.sin(t * 11 + 2) * .3 + Math.sin(t * 23) * .2), x = Math.cos(t) * A * j + A * .35, y = Math.sin(t) * B * j; poly.push([d[0] * x + n[0] * y, d[1] * x + n[1] * y]); }
    }
    const o = inside([0, 0], poly) ? [0, 0] : poly.reduce((m, [x, y]) => [m[0] + x / poly.length, m[1] + y / poly.length], [0, 0]); // 발화점이 영역 밖이면 영역 가운데
    // 불꽃 수: 600 m²(약 25 m 간격)마다 하나, 400 ~ 4000개
    const area = areaOf(poly), N = clamp(Math.round(area / 600), 400, 4000);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; for (const [x, y] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const bbs = scene.primitives.add(new Cesium.BillboardCollection({ scene })), pts = [], globe = scene.globe;
    for (let tries = 0; pts.length < N && tries < N * 20; tries++) {
      const x = lerp(minX, maxX, Math.random()), y = lerp(minY, maxY, Math.random()); if (!inside([x, y], poly)) continue;
      const c = toCarto(x, y), h = globe.getHeight(c) ?? groundHeight;
      const glow = pts.length % 6 === 0, k = .7 + Math.random() * .6;
      const bb = bbs.add({ position: Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, h + fh * .05), image: glow ? GLOW : FLAME, sizeInMeters: true,
        width: (glow ? fh * 4 : fh * .7) * k, height: (glow ? fh * 2.6 : fh * 1.2) * k, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, color: new Cesium.Color(1, 1, 1, 0) });
      pts.push({ bb, glow, rel: relOf([x, y], o, poly), seed: Math.random() * 100 });
    }
    // 높이: 처음엔 지금 보이는 지형 높이(타일이 덜 받아졌으면 낮게 나옴) → 지형 표본으로 다시 맞춤 (불꽃이 비탈에 묻히지 않게)
    {
      const cartos = pts.map(pt => Cesium.Cartographic.fromCartesian(pt.bb.position)), tp = viewer.terrainProvider;
      const job = tp.availability ? Cesium.sampleTerrainMostDetailed(tp, cartos) : Cesium.sampleTerrain(tp, 14, cartos);
      Promise.resolve(job).then(res => { if (!fire || fire.bbs !== bbs) return; res.forEach((c, i) => { if (Number.isFinite(c.height)) pts[i].bb.position = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height + fh * .05); }); }).catch(() => {});
    }
    // 불탄 자리 · 화선 (영역을 발화점 기준 g배로 줄인 모양)
    const ring = g => poly.map(([x, y]) => { const c = toCarto(o[0] + (x - o[0]) * g, o[1] + (y - o[1]) * g); return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude); });
    const r0 = ring(.05);
    const scar = viewer.entities.add({ polygon: { hierarchy: new Cesium.PolygonHierarchy(r0), material: Cesium.Color.fromBytes(16, 12, 10, 165), classificationType: Cesium.ClassificationType.BOTH } });
    const front = viewer.entities.add({ polyline: { positions: [...r0, r0[0]], clampToGround: true, width: 7, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: .3, color: Cesium.Color.fromCssColorString('#ff8a2a') }) } });
    // 연기 (입자): 화선 근처 불타는 점을 따라 옮김. 바람(m/s) 쪽으로 흐름
    const windVec = new Cesium.Cartesian3(), wind = () => { const a = (q.dir + 180) * Math.PI / 180; return Cesium.Matrix4.multiplyByPointAsVector(enu, new Cesium.Cartesian3(Math.sin(a) * q.wind, Math.cos(a) * q.wind, 0), windVec); };
    const smoke = [];
    for (let i = 0; i < 12; i++) smoke.push(scene.primitives.add(new Cesium.ParticleSystem({
      image: SMOKE, sizeInMeters: true, minimumImageSize: new Cesium.Cartesian2(90, 90), maximumImageSize: new Cesium.Cartesian2(150, 150),
      startScale: 1, endScale: 8, minimumParticleLife: 60, maximumParticleLife: 120, minimumSpeed: 8, maximumSpeed: 15, emissionRate: 3,
      startColor: Cesium.Color.WHITE.withAlpha(.65), endColor: Cesium.Color.WHITE.withAlpha(0), emitter: new Cesium.CircleEmitter(Math.max(60, Math.sqrt(area) * .08)), modelMatrix: Cesium.Matrix4.IDENTITY.clone(),
      updateCallback: (part, dt) => { if (Cesium.Cartesian3.magnitude(part.velocity) < q.wind * 2 + 20) Cesium.Cartesian3.add(part.velocity, Cesium.Cartesian3.multiplyByScalar(wind(), dt * .08, new Cesium.Cartesian3()), part.velocity); },
    })));
    fire = { t0: S.time(), bbs, pts, scar, front, smoke, ring, layout: -1 };
  }
  const fc = new Cesium.Color();
  tick.add(now => {
    if (type !== 'wildfire' || !fire) return;
    const g = clamp(.03 + (now - fire.t0) / 30, 0, 1.3), band = .16;
    for (const pt of fire.pts) {
      const d = g - pt.rel; let a = 0, sc = 1;
      const fl = .55 + .45 * Math.sin(now * (9 + pt.seed % 5) + pt.seed) * Math.sin(now * 4.3 + pt.seed * 1.7);
      if (d < 0) { fc.red = fc.green = fc.blue = 1; a = 0; }
      else if (d < band) { fc.red = fc.green = fc.blue = 1; a = pt.glow ? .55 : 1; sc = .75 + .45 * fl; }                       // 화선: 활활
      else { const k = clamp((d - band) / .5, 0, 1); fc.red = 1; fc.green = .6; fc.blue = .45; a = (pt.glow ? .25 : .7) * (1 - k * .85) * (.6 + .4 * fl); sc = .55 - .25 * k; } // 잔불
      fc.alpha = a; pt.bb.color = fc; pt.bb.scale = sc;
    }
    if (Math.abs(g - fire.layout) < .02 && g < 1) return; fire.layout = g;
    const r = fire.ring(Math.min(g, 1));
    fire.scar.polygon.hierarchy = new Cesium.PolygonHierarchy(r); fire.front.polyline.positions = [...r, r[0]];
    // 연기: 지금 화선 근처에서 타는 점으로
    const burning = fire.pts.filter(pt => g - pt.rel > 0 && g - pt.rel < .3);
    fire.smoke.forEach((ps, i) => { const pt = burning[(i * 37 + Math.floor(g * 10)) % Math.max(1, burning.length)]; if (!pt) return; const c = Cesium.Cartographic.fromCartesian(pt.bb.position); ps.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height + 40)); });
  });

  /* ── 지진해일: 실제 주기 12분 파형(먼저 빠지고 → 차오름 → 잠김 → 빠짐 → 두 번째 파)을 재생 배속만큼 빠르게.
     높이는 해안 처오름 높이(파고 × 배율, 실제 m). 해수면 기준 물판이라 DEM보다 낮은 땅만 잠김 ── */
  const PERIOD = 720; let tsT0 = S.time();
  const tsEta = (tau, A) => { if (tau <= 0) return 0; const x = tau / PERIOD;
    if (x < .25) return -.4 * A * Math.sin(Math.PI * x / .25);
    if (x < .85) { const y = (x - .25) / .6; return A * (y < .25 ? Math.sin(Math.PI / 2 * y / .25) : Math.cos(Math.PI / 2 * (y - .25) / .75)); }
    if (x < 1.05) return -.25 * A * Math.sin(Math.PI * (x - .85) / .2);
    if (x < 1.6) return .55 * A * Math.sin(Math.PI * (x - 1.05) / .55); return 0; };
  tick.add(now => {
    if (type !== 'tsunami' || !water) return;
    let tau = (now - tsT0) * p.speed; if (tau > 1.7 * PERIOD) { tsT0 = now; tau = 0; }
    water.setHeight(sea + Math.max(tsEta(tau, p.height * p.runup), -3));
  });

  /* ── 대설: 쌓인 눈 (30초 동안 누적 적설까지) ── */
  let snowStart = S.time();
  tick.add(now => {
    if (type !== 'snow') return;
    const total = p.rate * p.hours, sofar = total * clamp((now - snowStart) / 30, 0, 1);
    S.look.cover = clamp(sofar / 15, 0, 1); // 15 cm면 땅이 거의 다 덮임
  });

  for (const f of tick) S.tickers.add(f);
  apply();
  return {
    setIntensity() {},
    setParams(q) { p = normalize(q); apply(); },
    destroy() {
      alive = false;
      for (const f of tick) S.tickers.delete(f);
      if (shakePrev) { const cam = viewer.camera; cam.lookRight(-shakePrev.x); cam.lookUp(-shakePrev.y); cam.twistRight(-shakePrev.z); }
      for (const x of parts) x.destroy();
      for (const e of entities) viewer.entities.remove(e);
      clearFire();
      S.setLook({}); S.look.cover = 0; S.seaRise = 0;
    },
  };
}

export function registerDisasterEffects(disasters, viewer, Cesium) {
  const S = createShared(viewer, Cesium);
  for (const type of Object.keys(DX().TYPES)) if (type !== 'none') disasters.register(type, ctx => createEffect(type, ctx, S));
  return S;
}
