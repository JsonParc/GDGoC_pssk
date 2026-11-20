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
import { createBuildingFX } from './buildings.js';
import { createWaterLayer } from './water.js';
import { createCloudLayer } from './clouds.js';
import { floodFill, floodDistance } from './flood-grid.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t, sm = x => x * x * (3 - 2 * x);
const smoothstep01 = (a, b, x) => sm(clamp((x - a) / (b - a), 0, 1));
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
    if (depth < 1.) { float dist = length(eyeAt(uv)); fogK = (1. - exp(-2.3*dist*inLayer/max(u_vis, 1.)))*.85; } // 시정 거리에서 약 90%
    else fogK = (1. - smoothstep(1500., 30000., u_vis))*inLayer;                                                 // 하늘: 층 안에서 시정이 짧을 때만 덮음
    vec3 fogC = mix(vec3(.74, .77, .8), u_tint, u_tintAmt)*(1. - .55*u_gloom);
    vec3 c = mix(col.rgb*(1. - .5*u_gloom), fogC, fogK);
    gl_FragColor = vec4(c, col.a);
  }`;
// 지진 화면 흔들림: 카메라를 움직이면 Cesium이 '이동 중'으로 보고 건물 타일 요청을 멈춰서(cullRequestsWhileMoving) 화면 이미지만 흔듦
const SHAKE_FS = `uniform sampler2D colorTexture; varying vec2 v_textureCoordinates; uniform vec3 u_shake;
  void main(){ vec2 c = v_textureCoordinates - .5; float s = sin(u_shake.z), k = cos(u_shake.z);
    vec2 uv = vec2(c.x*k - c.y*s, c.x*s + c.y*k)*(1. - 2.*length(u_shake.xy) - abs(u_shake.z)) + .5 + u_shake.xy;
    gl_FragColor = texture2D(colorTexture, clamp(uv, 0., 1.)); }`;
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
    float k = smoothstep(0., length(p), sin(f.x + f.y)*.017); // 눈송이 크기 (.01이면 거의 안 보였음)
    return k*w;
  }
  void main(){
    vec2 res = czm_viewport.zw, uv = (gl_FragCoord.xy*2. - res)/min(res.x, res.y);
    float c = flake(uv, 10.) + flake(uv, 8.) + flake(uv, 6.) + flake(uv, 5.);
    if (u_snow > .5) c += flake(uv, 15.) + flake(uv, 20.);
    // 눈송이 자리만 밝힘 (예전엔 눈송이 없는 곳을 검정과 섞어 화면 전체가 최대 55% 어두워졌음)
    vec4 col = texture2D(colorTexture, v_textureCoordinates);
    gl_FragColor = vec4(mix(col.rgb, vec3(.96, .97, 1.), clamp(c, 0., 1.)*.85*clamp(u_snow, 0., 1.)), col.a);
  }`;
/* 쌓인 눈: 지형 위에 반투명 눈 영상 층(imagery layer)을 한 장 얹음 → 땅에 붙어 있어 보는 각도 · 거리와 상관없이 같은 땅에 같은 눈.
   (예전엔 화면 후처리에서 깊이 버퍼로 면 방향을 되짚었는데, 깊이 정밀도 · 여러 거리 구간 때문에 가로 줄무늬가 생기고
   위를 보는 면을 거의 단색 흰색으로 덮어 아무것도 안 보였음. 지구 재질(globe.material)은 브이월드 · 예비 지도 모두 화면에 반영되지 않았음)
   땅이 하얘지는 건 기본 위성 영상을 밝게 · 채도를 낮춰서(길 · 숲 · 그림자 무늬가 그대로 남음), 그 위 눈 층은 얼룩만 최대 50%.
   얼룩 무늬: 이음매 없는 값 잡음(주기 256 px, 4 · 8 · 16 · 32칸). 얇게 쌓이면 듬성듬성.
   해 음영은 지구 조명이 그대로 줌. 바다 · 강은 물 표면(water.js)이 위를 덮음. 지붕 눈은 buildings.js */
function snowTileDataUrl(k) {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N), d = img.data;
  const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const octave = (cells, seed) => {
    const v = Array.from({ length: cells * cells }, (_, i) => hash(i + seed * 1000));
    return (x, y) => {
      const fx = x / N * cells, fy = y / N * cells, i = Math.floor(fx), j = Math.floor(fy), tx = sm(fx - i), ty = sm(fy - j);
      const at = (a, b) => v[((b % cells) * cells) + (a % cells)];
      return lerp(lerp(at(i, j), at(i + 1, j), tx), lerp(at(i, j + 1), at(i + 1, j + 1), tx), ty);
    };
  };
  const o = [[octave(4, 1), .4], [octave(8, 2), .3], [octave(16, 3), .2], [octave(32, 4), .1]];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let n = 0; for (const [f, w] of o) n += f(x, y) * w;
    const a = smoothstep01(0, .35, k + (n - .5) * .9 * (1 - .6 * k)) * lerp(.2, .5, n); // 얼룩만 (전체 밝기는 기본 영상을 하얗게 바꿔서)
    const q = (y * N + x) * 4, b = lerp(.9, 1, n);
    d[q] = 228 * b; d[q + 1] = 233 * b; d[q + 2] = 242 * b; d[q + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/* 하늘 템플릿 (템플릿 뷰어의 하늘 사진 15종): 하늘 픽셀(깊이 없음)만 반구-팔면체 사진으로 바꿈.
   사진 속 해 방위를 Cesium 실제 해 방위에 맞춰 돌림 (atmosphere.js와 같은 매핑) */
const SKY_FS = `uniform sampler2D colorTexture; uniform sampler2D depthTexture; uniform sampler2D u_sky; varying vec2 v_textureCoordinates;
  uniform mat3 u_toLocal; uniform vec3 u_camR; uniform vec3 u_camU; uniform vec3 u_camD; uniform vec2 u_tan; uniform vec2 u_texSun; uniform float u_tint; uniform float u_gain; uniform vec3 u_hor; uniform vec3 u_zen; uniform float u_on; uniform float u_dim;
  uniform float u_cover; uniform float u_gloom; uniform vec2 u_wind; uniform float u_time;
  float hh(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
  float nn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3. - 2.*f); return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++) { v += a*nn(p); p = mat2(.8, .6, -.6, .8)*p*2.03 + 17.1; a *= .5; } return v; }
  void main(){
    vec4 col = texture2D(colorTexture, v_textureCoordinates);
    // 시선 방향: 카메라의 오른쪽 · 위 · 앞 벡터(동 · 북 · 위 좌표, JS에서 매 프레임 계산)와 화각으로 바로 만듦.
    // 투영 행렬 역산은 Cesium의 아주 먼 먼 면 때문에 정밀도가 깨져 움직일 때 지지직거렸음
    vec2 sc = (v_textureCoordinates*2. - 1.)*u_tan;
    vec3 l = normalize(u_camD + u_camR*sc.x + u_camU*sc.y), d = normalize(vec3(l.x, l.z, -l.y));
    if ((u_on <= 0. && u_cover <= 0.) || czm_readDepth(depthTexture, v_textureCoordinates) < (d.y > .01 ? .99999 : 1.)) { gl_FragColor = col; return; }
    vec3 sl = u_toLocal*czm_sunDirectionWC;
    float th = atan(u_texSun.y, u_texSun.x) - atan(-sl.y, sl.x);
    vec2 rot = vec2(cos(th), sin(th));
    vec3 r = vec3(d.x*rot.x - d.z*rot.y, max(d.y, 0.), d.x*rot.y + d.z*rot.x);
    vec2 p = r.xz/(abs(r.x) + r.y + abs(r.z) + 1e-6), uv = vec2(p.x + p.y, p.x - p.y)*.5 + .5;
    vec3 tc = mix(texture2D(u_sky, vec2(uv.x, 1. - uv.y)).rgb*u_gain, mix(u_hor, u_zen, pow(max(d.y, 0.), .45)), u_tint)*u_dim;
    vec3 c = mix(col.rgb, tc, u_on*smoothstep(-.02, .04, d.y));
    // 날씨 구름: 바람 따라 흐르고, 비 · 눈 · 태풍이면 짙고 어둡게 덮임 (템플릿 뷰어 하늘 셰이더와 같은 방식)
    if (u_cover > 0. && d.y > 0.) {
      vec2 q = d.xz/(d.y + .08)*1.3 + u_wind*u_time*.004;
      float n = fbm(q), cv = smoothstep(.55 - u_cover*.6, .8 - u_cover*.55, n);
      float lit = fbm(q*1.9 + vec2(4.3, 1.7) + sl.xy*.15);
      vec3 cl = mix(vec3(.42, .45, .5), vec3(.95, .96, .98), smoothstep(.3, .75, lit))*(1. - .65*u_gloom);
      float over = smoothstep(.55, 1., u_cover);                      // 아주 짙으면 하늘 전체가 흐린 회색
      c = mix(c, cl, clamp(cv*smoothstep(0., .2, d.y) + over*.85, 0., 1.)*.95);
    }
    gl_FragColor = vec4(c, col.a);
  }`;


/* 스카이스피어: 카메라를 감싼 큰 구(반지름 = 지평선 거리의 1.3배 이상)를 하늘 사진 + 날씨 구름 재질로 그림.
   화면 후처리로 하늘을 덧칠하면 반투명한 3D 구름 · 물 가장자리까지 하늘로 덮였음 → 실제 물체로 그려 구름이 그 앞에 섞이게.
   구는 깊이를 쓰지 않아(depthMask false) 지형 · 건물이 가리고, 지평선 아래는 버림 */
const SKY_MATERIAL_SRC = `
  float hh(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
  float nn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3. - 2.*f); return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++) { v += a*nn(p); p = mat2(.8, .6, -.6, .8)*p*2.03 + 17.1; a *= .5; } return v; }
  czm_material czm_getMaterial(czm_materialInput materialInput){
    czm_material m = czm_getDefaultMaterial(materialInput);
    vec3 wdir = normalize(czm_inverseViewRotation*(-materialInput.positionToEyeEC));
    // 동 · 북 · 위 좌표 (Material은 3×3 행렬 uniform을 못 받아 축 벡터 셋으로)
    vec3 l = vec3(dot(eastW, wdir), dot(northW, wdir), dot(upW, wdir)), d = normalize(vec3(l.x, l.z, -l.y));
    if (d.y < -.015) discard;
    vec3 sl = vec3(dot(eastW, czm_sunDirectionWC), dot(northW, czm_sunDirectionWC), dot(upW, czm_sunDirectionWC));
    vec3 grad = mix(hor, zen, pow(max(d.y, 0.), .45));
    vec3 c = grad;
    if (on > 0.) {
      float th = atan(texSun.y, texSun.x) - atan(-sl.y, sl.x);
      vec2 rot = vec2(cos(th), sin(th));
      vec3 r = vec3(d.x*rot.x - d.z*rot.y, max(d.y, 0.), d.x*rot.y + d.z*rot.x);
      vec2 p = r.xz/(abs(r.x) + r.y + abs(r.z) + 1e-6), uv = vec2(p.x + p.y, p.x - p.y)*.5 + .5;
      c = mix(grad, mix(texture2D(image, vec2(uv.x, 1. - uv.y)).rgb*gain, grad, tint), on);
    }
    c *= dim;
    if (cover > 0. && d.y > 0.) {   // 먼 하늘 날씨 구름 (가까운 구름은 3D 구름)
      vec2 q = d.xz/(d.y + .08)*1.3 + wind*time*.004;
      float n = fbm(q), cv = smoothstep(.55 - cover*.6, .8 - cover*.55, n);
      float lit = fbm(q*1.9 + vec2(4.3, 1.7) + sl.xy*.15);
      vec3 cl = mix(vec3(.42, .45, .5), vec3(.95, .96, .98), smoothstep(.3, .75, lit))*(1. - .65*gloom);
      c = mix(c, cl, clamp(cv*smoothstep(0., .2, d.y) + smoothstep(.55, 1., cover)*.85, 0., 1.)*.95);
    }
    m.diffuse = vec3(0.); m.emission = c; m.alpha = 1.;
    return m;
  }`;

/* ───── 공유: 후처리 · 바다 · 해수면 ───── */
function createShared(viewer, Cesium) {
  const scene = viewer.scene, t0 = performance.now(), time = () => (performance.now() - t0) / 1000;
  // 진행 시계: 재난 진행(쌓임 · 번짐 · 파도 · 흔들림 단계)만 멈출 수 있음. 내리는 눈 · 비 · 불꽃 깜빡임은 실제 시계로 계속
  let pausedAt = null, pausedTotal = 0;
  const simTime = () => (pausedAt ?? time()) - pausedTotal;
  function setPaused(on) {
    if (on && pausedAt == null) pausedAt = time();
    else if (!on && pausedAt != null) { pausedTotal += time() - pausedAt; pausedAt = null; }
  }
  const look = { vis: 40000, tint: new Cesium.Cartesian3(.75, .77, .8), tintAmt: 0, gloom: 0, heat: 0, rain: 0, snow: 0, cover: 0, wind: 0, dir: 0 };
  const cur = { ...look, tint: look.tint.clone() }; // 부드럽게 바뀌도록 따라감
  const MA = window.MapAtmosphere;
  const sky = { id: null, on: 0, texSun: new Cesium.Cartesian2(1, 0), tint: 0, gain: 1, hor: new Cesium.Cartesian3(.7, .75, .8), zen: new Cesium.Cartesian3(.2, .4, .7) };
  const toLocal = new Cesium.Matrix3(), enuM = new Cesium.Matrix4();
  // 카메라 방향을 그 자리 동 · 북 · 위 좌표로 (하늘 셰이더용)
  const camBasis = { toLocal, r: new Cesium.Cartesian3(), u: new Cesium.Cartesian3(), d: new Cesium.Cartesian3(), tan: new Cesium.Cartesian2(1, 1) };
  function updateCamBasis() {
    const cam = viewer.camera, f = cam.frustum;
    Cesium.Transforms.eastNorthUpToFixedFrame(cam.positionWC, Cesium.Ellipsoid.WGS84, enuM);
    Cesium.Matrix3.transpose(Cesium.Matrix4.getMatrix3(enuM, toLocal), toLocal);
    Cesium.Matrix3.multiplyByVector(toLocal, cam.rightWC, camBasis.r); Cesium.Matrix3.multiplyByVector(toLocal, cam.upWC, camBasis.u); Cesium.Matrix3.multiplyByVector(toLocal, cam.directionWC, camBasis.d);
    const ty = Math.tan((f.fovy || f.fov || 1) / 2), aspect = f.aspectRatio || (scene.canvas.clientWidth / Math.max(1, scene.canvas.clientHeight));
    camBasis.tan.x = ty * aspect; camBasis.tan.y = ty;
  }
  const skyMat = new Cesium.Material({ fabric: { type: 'SkyTemplate', source: SKY_MATERIAL_SRC, uniforms: {
    image: '../data/sky/clear-noon.jpg', eastW: new Cesium.Cartesian3(1, 0, 0), northW: new Cesium.Cartesian3(0, 1, 0), upW: new Cesium.Cartesian3(0, 0, 1), texSun: new Cesium.Cartesian2(1, 0), tint: 0, gain: 1,
    hor: new Cesium.Cartesian3(.7, .75, .8), zen: new Cesium.Cartesian3(.2, .4, .7), on: 0, dim: 1, cover: 0, gloom: 0, wind: new Cesium.Cartesian2(3, 0), time: 0 } } });
  const skyPrim = scene.primitives.add(new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry: new Cesium.EllipsoidGeometry({ radii: new Cesium.Cartesian3(1, 1, 1), stackPartitions: 48, slicePartitions: 96, vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat }) }),
    appearance: new Cesium.MaterialAppearance({ material: skyMat, flat: true, faceForward: false, translucent: false, closed: false,
      renderState: { depthMask: false, depthTest: { enabled: true }, cull: { enabled: false } } }),
    asynchronous: false, show: false,
  }));
  const skyScale = new Cesium.Matrix4();
  function updateSkySphere() {
    const want = (!!sky.id || cur.clouds > .02) && camH < 60000;
    skyPrim.show = want; if (!want) return;
    const r = clamp(Math.sqrt(2 * 6371000 * Math.max(camH, 10)) * 1.3 + 30000, 60000, 900000);
    Cesium.Matrix4.fromUniformScale(r, skyScale); Cesium.Matrix4.setTranslation(skyScale, viewer.camera.positionWC, skyScale);
    skyPrim.modelMatrix = skyScale;
    const u = skyMat.uniforms;
    u.eastW = Cesium.Matrix4.getColumn(enuM, 0, new Cesium.Cartesian4()); u.northW = Cesium.Matrix4.getColumn(enuM, 1, new Cesium.Cartesian4()); u.upW = Cesium.Matrix4.getColumn(enuM, 2, new Cesium.Cartesian4());
    u.eastW = new Cesium.Cartesian3(u.eastW.x, u.eastW.y, u.eastW.z); u.northW = new Cesium.Cartesian3(u.northW.x, u.northW.y, u.northW.z); u.upW = new Cesium.Cartesian3(u.upW.x, u.upW.y, u.upW.z); u.on = sky.on; u.texSun = sky.texSun; u.tint = sky.tint; u.gain = sky.gain; u.hor = sky.hor; u.zen = sky.zen;
    u.dim = 1 - .5 * cur.gloom * wx(); u.cover = cur.clouds * wx(); u.gloom = cur.gloom * wx(); u.time = time();
    const a2 = (cur.dir + 180) * Math.PI / 180, w = Math.max(3, cur.wind); u.wind = new Cesium.Cartesian2(Math.sin(a2) * w, -Math.cos(a2) * w);
  }
  const hex3 = h => { const c = Cesium.Color.fromCssColorString('#' + h.toString(16).padStart(6, '0')); return new Cesium.Cartesian3(c.red, c.green, c.blue); };
  function setSky(id) {
    const def = id && MA && MA.SKY[id];
    sky.id = def ? id : null; if (!def) sky.on = 0;
    if (!def) return;
    skyMat.uniforms.image = `../data/sky/${id}.jpg`;
    sky.texSun = new Cesium.Cartesian2(def.sun[0], def.sun[1]); sky.tint = def.tint || 0; sky.gain = def.gain || 1; sky.hor = hex3(def.horizon); sky.zen = hex3(def.zenith);
  }
  // 바다 · 강 · 호수 물 표면 (OpenFreeMap 물 다각형)
  let W = null; try { W = createWaterLayer(viewer, Cesium); } catch (e) { console.warn('물 표면을 쓸 수 없습니다', e); }
  // 실제 높이 · 크기의 3D 구름 + 구름에서 내리는 비 · 눈 (재난이 만들거나 백엔드 구름 목록)
  let C = null; try { C = createCloudLayer(viewer, Cesium); } catch (e) { console.warn('3D 구름을 쓸 수 없습니다', e); }
  let here = { k: 0 };
  const stages = {
    atmos: new Cesium.PostProcessStage({ fragmentShader: ATMOS_FS, uniforms: { u_vis: () => visEff(), u_tint: () => cur.tint, u_tintAmt: () => cur.tintAmt * wx(), u_gloom: () => cur.gloom * wx(), u_heat: () => cur.heat, u_time: time, u_camH: () => camH, u_layer: () => 800 } }),
    rain: new Cesium.PostProcessStage({ fragmentShader: RAIN_FS, uniforms: { u_rain: () => screenPrecip('rain'), u_time: time, u_angle: () => rainAngle() } }),
    shake: new Cesium.PostProcessStage({ fragmentShader: SHAKE_FS, uniforms: { u_shake: () => shake } }),
    snow: new Cesium.PostProcessStage({ fragmentShader: SNOW_FS, uniforms: { u_snow: () => screenPrecip('snow'), u_time: time, u_wind: () => clamp(cur.wind / 15, 0, 1.5) * windSide() } }),
  };
  for (const s of Object.values(stages)) { s.enabled = false; scene.postProcessStages.add(s); }
  // 시정: 실제 값(비 90 mm/h면 약 1.5 km)은 화면이 거의 안 보여서 기본은 10배 (최소 18 km). '실제 시정' 켜면 실제 값
  const opt = { realVis: false };
  const visEff = () => { const v = opt.realVis ? cur.vis : clamp(cur.vis * 10, 18000, 40000); return lerp(40000, v, wx()); };
  const shake = new Cesium.Cartesian3(); // 화면 흔들림 (x, y 화면 비율, z 회전 rad)
  // 카메라의 지면 위 높이: 비 · 눈 층(1.2 km) 위로 올라가면 화면 빗줄기를 줄임
  let camH = 100;
  const inLayer = () => .25 + .75 * clamp(1500 / Math.max(camH, 1), 0, 1);
  const wx = () => clamp(1 - (camH - 2500) / 5500, 0, 1); // 날씨가 보이는 정도 (구름층 위 · 우주에선 0)
  // 화면 비 · 눈: 3D 구름이 있으면 카메라 머리 위 비 · 눈 구름 밑에 있을 때만 (구름 밖 · 위에선 빗줄기 커튼으로만 보임)
  const screenPrecip = kind => {
    if (C && C.active) return here.kind === kind ? here.k * Math.max(kind === 'rain' ? cur.rain : cur.snow, .7) : 0;
    return (kind === 'rain' ? cur.rain : cur.snow) * wx();
  };
  // 바람이 화면에서 어느 쪽으로 부는지 (비 기울기 · 눈 흐름)
  const windSide = () => Math.sin(((cur.dir + 180) * Math.PI / 180) - viewer.camera.heading);
  const rainAngle = () => -windSide() * clamp(cur.wind / 40, 0, .7);

  scene.preRender.addEventListener((_, now) => {
    updateCamBasis();
    const cc = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC); if (cc) camH = Math.max(1, cc.height - (scene.globe.getHeight(cc) ?? 0));
    const k = .05;
    for (const key of ['vis', 'tintAmt', 'gloom', 'heat', 'rain', 'snow', 'cover', 'wind']) cur[key] = lerp(cur[key], look[key], key === 'cover' ? .08 : k);
    cur.dir = look.dir; Cesium.Cartesian3.lerp(cur.tint, look.tint, k, cur.tint);
    stages.atmos.enabled = wx() > 0 && (visEff() < 39000 || cur.gloom > .01 || cur.tintAmt > .01 || cur.heat > .01);
    stages.shake.enabled = Math.abs(shake.x) + Math.abs(shake.y) + Math.abs(shake.z) > 1e-5;
    if (C) { C.tick(time()); here = C.precipHere(); }
    stages.rain.enabled = screenPrecip('rain') > .01; stages.snow.enabled = screenPrecip('snow') > .01; setGroundSnow(cur.cover);
    // 하늘 사진 위 구름 무늬: 3D 구름이 있으면 먼 하늘을 흐리게 하는 정도로만
    cur.clouds = lerp(cur.clouds || 0, clamp(cur.gloom * 1.3 + cur.rain * .6 + cur.snow * .6, 0, 1) * (C && C.active ? .45 : 1), .03);
    if (sky.id) sky.on = (camH < 60000 ? 1 : 0) * (1 - wx() * .6 * clamp(cur.rain + cur.snow + cur.gloom, 0, 1));
    updateSkySphere();
    if (W) W.setSeaRise(seaRise || 0);
    for (const f of tickers) f(simTime(), time()); // (진행 시계, 실제 시계)
  });
  viewer.scene.requestRenderMode = false; // 효과는 매 프레임 움직임
  viewer.clock.shouldAnimate = true;       // 파티클(불꽃 · 연기)은 장면 시계로 움직임

  function setLook(env = {}) {
    const c = env.tint != null ? Cesium.Color.fromCssColorString('#' + env.tint.toString(16).padStart(6, '0')) : null;
    Object.assign(look, {
      vis: env.vis ?? 40000, tintAmt: env.tintAmt ?? 0, gloom: (env.gloom ?? 0) * .6, heat: env.heat ?? 0, // gloom: 너무 어두우면 건물이 안 보여서 60%만
      rain: clamp((env.rain ?? 0) / 100, 0, 1.2), snow: clamp((env.snow ?? 0) / 6, 0, 1.2), wind: env.wind ?? 0, dir: env.dir ?? 0,
    });
    if (c) look.tint = new Cesium.Cartesian3(c.red, c.green, c.blue);
  }
  const tickers = new Set();

  // 쌓인 눈: 기본 영상 층을 덮임 c만큼 밝게 · 채도 낮게 (원래 값은 기억해 두었다 되돌림) + 얼룩 층(snowTileDataUrl, 4단계)
  const snowUrls = {}, baseLook = new Map();
  let snowLayer = null, snowStep = 0, snowC = 0;
  function setGroundSnow(c) {
    c = c > .02 ? Math.min(1, c) : 0;
    if (Math.abs(c - snowC) < .01 && (c > 0) === (snowC > 0)) return;
    snowC = c;
    dispatchEvent(new CustomEvent('map-snow-cover', { detail: c })); // 예비 지도 건물 지붕 눈 (osm-buildings.js)
    const layers = viewer.imageryLayers;
    for (let i = 0; i < layers.length; i++) {
      const l = layers.get(i); if (l === snowLayer) continue;
      if (!baseLook.has(l)) baseLook.set(l, { brightness: l.brightness, saturation: l.saturation, contrast: l.contrast, gamma: l.gamma });
      const o = baseLook.get(l);
      l.brightness = o.brightness * (1 + .7 * c); l.saturation = o.saturation * (1 - .75 * c);
      l.contrast = o.contrast * (1 - .12 * c); l.gamma = o.gamma * (1 + .3 * c);
    }
    if (!c) baseLook.clear();
    const step = c ? Math.min(4, Math.ceil(c * 4)) : 0;
    if (step === snowStep) return;
    snowStep = step;
    if (snowLayer) { layers.remove(snowLayer, true); snowLayer = null; }
    if (!step) return;
    snowUrls[step] ??= snowTileDataUrl(step / 4);
    snowLayer = layers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({ url: snowUrls[step], maximumLevel: 21, tileWidth: 256, tileHeight: 256 }));
  }

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
    if (W) W.setSeaLevel(seaN);
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

  /* 지형 높이 표본: 브이월드 빌드에선 sampleTerrainMostDetailed가 내부 오류로 실패하고, 레벨 13은 타일이 빈 구역이 생김
     → 상세한 레벨부터 빈 칸만 다시 잼 (13 → 12 → 11 → 10, 끝으로 화면에 받은 지형). 끝내 모르는 칸은 NaN
     (예전엔 0 m로 채워서 해수면 아래 = 바다로 잘못 보고 그 구역을 안 그렸음) */
  async function sampleHeights(cartos) {
    const tp = viewer.terrainProvider, H = new Float32Array(cartos.length).fill(NaN);
    let missing = cartos.map((_, k) => k);
    const take = (res, ks) => res.forEach((c, n) => { if (Number.isFinite(c.height)) H[ks[n]] = c.height; });
    if (tp.availability) { try { take(await Cesium.sampleTerrainMostDetailed(tp, cartos.map(c => c.clone())), missing); } catch { /* 아래 레벨별 표본으로 */ } }
    for (const level of [13, 12, 11, 10]) {
      missing = missing.filter(k => !Number.isFinite(H[k])); if (!missing.length) break;
      try { take(await Cesium.sampleTerrain(tp, level, missing.map(k => cartos[k].clone())), missing); } catch { /* 이 레벨 실패 */ }
    }
    for (const k of missing) { const h = scene.globe.getHeight(cartos[k]); if (Number.isFinite(h)) H[k] = h; }
    return H;
  }

  /* 이어진 침수면: 발생 지점 둘레 2·half m를 N×N 칸으로 나눠 지도 지형 높이를 재고,
     물이 들어오는 곳(base = 'sea': 해수면 이하 칸 = 근처 바다 / 'point': 발생 지점 칸)에서 시작해
     maxLevel보다 낮고 이어진 칸만 채움 (둑 · 언덕 너머 막힌 저지대는 안 잠김). 물 가장자리는 지형이 가려 지형 모양 그대로.
     표면은 높이 0으로 만들고 setHeight로 올림 (해일처럼 수위가 바뀌어도 다시 계산 안 함).
     칸마다 물이 들어온 곳에서 얼마나 떨어졌는지(도달 거리)를 재서 띠로 묶음 → setReach(m)로 그 거리까지만 보여 물이 밀려드는 모습 */
  async function floodSurface({ longitude, latitude, half, base, maxLevel, color, N = 128, flow = false }) {
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(longitude, latitude));
    const at = (x, y) => Cesium.Cartographic.fromCartesian(Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(x, y, 0), new Cesium.Cartesian3()));
    const cell = 2 * half / N, cartos = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) cartos.push(at((i + .5) * cell - half, (j + .5) * cell - half));
    const H = await sampleHeights(cartos), sea = new Uint8Array(N * N), seeds = [];
    const seaH = seaN ?? 0;
    for (let k = 0; k < N * N; k++) if (H[k] <= seaH + .3) sea[k] = 1; // 바다 칸은 지도 바다 표면이 맡음 (어느 기준이든 안 그림)
    if (base === 'point') { const k = (N >> 1) * N + (N >> 1); if (H[k] < maxLevel) seeds.push(k); }
    else for (let k = 0; k < N * N; k++) if (sea[k]) seeds.push(k);
    const fill = floodFill(N, H, seeds, maxLevel), dist = floodDistance(N, fill, seeds); // flood-grid.js
    // 그릴 칸: 잠긴 육지 칸 + 한 칸 둘레 (가장자리는 지형이 가림). 둘레 칸의 도달 거리 = 이웃 잠긴 칸 중 가장 가까운 값
    const reach = new Float32Array(N * N).fill(-1); let count = 0, far = 0;
    for (let k = 0; k < N * N; k++) if (fill[k] && !sea[k]) {
      const i = k % N, j = (k - i) / N;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue;
        const n = b * N + a, d = dist[k] + Math.hypot(di, dj);
        if (reach[n] < 0) { count++; reach[n] = d; } else if (d < reach[n]) reach[n] = d;
        far = Math.max(far, reach[n]);
      }
    }
    const out = { count, setHeight() {}, setReach() {}, destroy() {} };
    if (!count) return out;
    // 도달 거리 띠 (최대 48개). 띠마다 칸 사각형 두 개씩 (꼭짓점은 칸 모서리, 타원체 높이 0)
    const step = Math.max(1, Math.ceil((far + 1) / 48)), bands = new Map();
    for (let k = 0; k < N * N; k++) if (reach[k] >= 0) { const b = Math.floor(reach[k] / step); if (!bands.has(b)) bands.set(b, []); bands.get(b).push(k); }
    const corner = (x, y) => Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(x, y, 0), new Cesium.Cartesian3());
    const instances = [...bands].map(([b, cells]) => {
      const pos = new Float64Array(cells.length * 12), st = new Float32Array(cells.length * 8), idx = new Uint32Array(cells.length * 6);
      cells.forEach((k, q) => {
        const i = k % N, j = (k - i) / N, x0 = i * cell - half, y0 = j * cell - half;
        [[x0, y0], [x0 + cell, y0], [x0 + cell, y0 + cell], [x0, y0 + cell]].forEach(([x, y], v) => {
          const c = Cesium.Cartographic.fromCartesian(corner(x, y)), p0 = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 0);
          pos.set([p0.x, p0.y, p0.z], (q * 4 + v) * 3); st.set([(x + half) / (2 * half), (y + half) / (2 * half)], (q * 4 + v) * 2);
        });
        idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
      });
      const geometry = new Cesium.Geometry({
        attributes: { position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: pos }),
          st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: st }) },
        indices: idx, primitiveType: Cesium.PrimitiveType.TRIANGLES, boundingSphere: Cesium.BoundingSphere.fromVertices(pos),
      });
      return new Cesium.GeometryInstance({ geometry, id: 'band' + b, attributes: { show: new Cesium.ShowGeometryInstanceAttribute(!flow) } });
    });
    const prim = scene.primitives.add(new Cesium.Primitive({
      geometryInstances: instances, asynchronous: false, compressVertices: false, releaseGeometryInstances: false,
      appearance: new Cesium.EllipsoidSurfaceAppearance({ aboveGround: true, translucent: false, material: Cesium.Material.fromType('Water', {
        baseWaterColor: color, blendColor: Cesium.Color.fromAlpha(color, 1), normalMap: Cesium.buildModuleUrl('Assets/Textures/waterNormals.jpg'),
        frequency: 5000, animationSpeed: .015, amplitude: 4, specularIntensity: .7 }) }),
    }));
    const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(Cesium.Cartesian3.fromDegrees(longitude, latitude), new Cesium.Cartesian3()), off = new Cesium.Cartesian3();
    out.setHeight = h => { prim.show = Number.isFinite(h); if (prim.show) prim.modelMatrix = Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.multiplyByScalar(normal, h, off)); };
    out.setColor = c => { prim.appearance.material.uniforms.baseWaterColor = c; };
    out.destroy = () => scene.primitives.remove(prim);
    // 물이 들어온 곳에서 m 안쪽 띠만 보임. 프리미티브가 한 번 그려지기 전엔 속성을 못 바꿔서 다음 호출(다음 프레임)에 다시
    const shown = new Map();
    out.setReach = m => {
      for (const b of bands.keys()) {
        const on = b * step * cell <= m;
        if (shown.get(b) === on) continue;
        try { prim.getGeometryInstanceAttributes('band' + b).show = Cesium.ShowGeometryInstanceAttribute.toValue(on); shown.set(b, on); } catch { return; }
      }
    };
    out.ground = H[(N >> 1) * N + (N >> 1)];
    return out;
  }

  /* 땅 위 선: 브이월드 Cesium 빌드에는 땅에 붙는 선(clampToGround)용 작업 파일(createGroundPolylineGeometry)이 없어
     그리면 렌더링이 멈춤 → 지형 높이를 재서 그 위 3 m에 일반 선(PolylineCollection, 작업 파일 필요 없음)으로 그림 */
  function groundLine({ positions = [], color, width = 3, glow = false, dash = false }) {
    const col = scene.primitives.add(new Cesium.PolylineCollection());
    const material = glow ? Cesium.Material.fromType('PolylineGlow', { color, glowPower: .3 }) : dash ? Cesium.Material.fromType('PolylineDash', { color }) : Cesium.Material.fromType('Color', { color });
    const line = col.add({ positions: [], width, material });
    let req = 0;
    function setPositions(list) {
      const r = ++req, cartos = list.map(p => Cesium.Cartographic.fromCartesian(p));
      const lift = c => Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, (Number.isFinite(c.height) ? c.height : 0) + 3);
      line.positions = cartos.map(c => lift(new Cesium.Cartographic(c.longitude, c.latitude, scene.globe.getHeight(c) ?? 0)));
      const tp = viewer.terrainProvider;
      Promise.resolve(tp.availability ? Cesium.sampleTerrainMostDetailed(tp, cartos) : Cesium.sampleTerrain(tp, 13, cartos)).then(res => { if (r === req && !col.isDestroyed()) line.positions = res.map(lift); }).catch(() => {});
    }
    if (positions.length) setPositions(positions);
    return { setPositions, set show(v) { col.show = v; }, destroy() { if (!col.isDestroyed()) scene.primitives.remove(col); } };
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

  return { C, opt, shake, groundLine, floodSurface, look, cur, setSky, get sky() { return sky.id; }, W, get camH() { return camH; }, setLook, seaLevelAt, get seaLevel() { return seaN; }, water, setOcean, set seaRise(v) { seaRise = v; }, tickers, time, simTime, setPaused, get paused() { return pausedAt != null; }, ringPositions };
}

/* ───── 재난별 효과 ───── */
function createEffect(type, ctx, S) {
  const { viewer, Cesium, longitude, latitude, groundHeight } = ctx, scene = viewer.scene;
  const def = DX().TYPES[type], Phys = DX().Phys;
  let p = normalize(ctx.params), env = def.env(p);
  function normalize(q = {}) {
    const o = {}; for (const d of def.params) o[d.key] = clamp(Number.isFinite(+q[d.key]) ? +q[d.key] : d.value, d.min, d.max);
    o.polygon = Array.isArray(q.polygon) && q.polygon.length >= 3 ? q.polygon : null; // 지도에 그린 영역 [[경도, 위도], …]
    o.waterBase = q.waterBase === 'point' || q.waterBase === 'sea' ? q.waterBase : (type === 'flood' ? 'point' : 'sea'); // 물 기준: 근처 바다 / 이 지점
    for (const key of ['snowDepthCm', 'waterDepthM']) {
      if (Number.isFinite(q[key]) && q[key] >= 0) o[key] = q[key];
    }
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
  let water = null, waterKey = '', waterReq = 0, waterTimer = 0;
  // 기준 높이: 근처 바다면 해수면, 이 지점이면 선택 지점 지형.
  // 해일은 어느 기준이든 바다에서 밀려 들어옴: 지점 기준이면 해안 파고를 키워 가장 높을 때 선택 지점이 파고 × 처오름만큼 잠기게
  const baseH = () => p.waterBase === 'point' && type !== 'tsunami' ? groundHeight : sea;
  const tsAmp = () => p.height * p.runup + (p.waterBase === 'point' ? Math.max(0, groundHeight - sea) : 0);
  const waterAmount = () => type === 'tsunami' ? tsAmp() : (env.water || 0);
  async function buildWater() {
    const req = ++waterReq;
    let w;
    if (type === 'flood' && p.polygon) w = S.water({ longitude, latitude, ...waterSpec, polygon: p.polygon }); // 직접 그린 영역
    else w = await S.floodSurface({ longitude, latitude, half: type === 'flood' ? 4000 : 9000, base: type === 'tsunami' ? 'sea' : p.waterBase, maxLevel: baseH() + waterAmount() + .01, color: waterSpec.color, flow: type === 'tsunami' });
    if (req !== waterReq || !alive) { w.destroy(); return; }
    if (water) water.destroy(); water = w;
    if (type === 'tsunami') water.setReach(tsReach);
    if (type !== 'tsunami') water.setHeight(baseH() + waterAmount());
  }
  function scheduleWater() {
    if (!waterSpec) return;
    const key = [p.waterBase, (baseH() + waterAmount()).toFixed(1), p.polygon ? p.polygon.length : 0, sea].join('|');
    if (key === waterKey) return; waterKey = key;
    clearTimeout(waterTimer); waterTimer = setTimeout(buildWater, 350); // 슬라이더를 끄는 동안은 기다렸다가 한 번
  }

  /* 건물 영향 (지진 · 물 · 산불): 발생 지점 둘레 지면 높이를 잰 뒤 켬 */
  const B = S.B, usesB = !!B && ['quake', 'tsunami', 'sealevel', 'flood', 'typhoon', 'wildfire', 'snow'].includes(type);
  let bReady = false, maxLv = -1e9;
  if (usesB) {
    const half = type === 'quake' ? 12000 : type === 'wildfire' ? clamp(Math.sqrt(p.area * 1e4) * 1.3 + 1500, 3000, 15000) : 8000;
    B.begin(longitude, latitude, half).then(() => { bReady = true; if (alive) apply(); }).catch(e => console.warn(e));
  }
  /* 지진: 진도 반경 원 + 카메라 위치의 흔들림 */
  let quake = null; const quakeLines = [];
  /* 산불 */
  let fire = null;

  /* 재난 구름: 태풍 = 적란운 · 난층운 폭우, 호우 = 난층운, 대설 = 층적운 눈. 백엔드 구름을 받은 상태면 그걸 그대로 둠 */
  let cloudKey = '', cloudTimer = 0;
  function cloudSpec() {
    if (type === 'typhoon') return { kind: 'storm', amount: clamp(p.wind / 50, .4, 1), gloom: env.gloom || .6, wind: p.wind * .6, dir: p.dir, precip: p.rain > 0 ? 'rain' : null, rate: clamp(p.rain / 120, 0, 1), radius: 25000 };
    if (type === 'flood') return { kind: 'rain', amount: clamp(p.rain / 120, .4, 1), gloom: env.gloom || .5, wind: 6, dir: 200, precip: p.rain > 0 ? 'rain' : null, rate: p.rain > 0 ? clamp(p.rain / 150, .2, 1) : 0, radius: 14000 };
    if (type === 'snow') return { kind: 'snow', amount: clamp(p.rate / 8, .4, 1), gloom: env.gloom || .4, wind: p.wind, dir: 320, precip: p.rate > 0 ? 'snow' : null, rate: p.rate > 0 ? clamp(p.rate / 8, .2, 1) : 0, radius: 16000 };
    return null;
  }
  function scheduleClouds() {
    if (!S.C || S.C.api) return;
    const c = cloudSpec(), key = c ? JSON.stringify(c, (k, v) => typeof v === 'number' ? Math.round(v * 10) / 10 : v) : '';
    if (key === cloudKey) return; cloudKey = key;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => { if (!alive) return; if (c) S.C.set({ longitude, latitude, groundHeight, ...c }); else S.C.clear(); }, 300);
  }
  function apply() {
    env = def.env(p);
    scheduleClouds();
    // 산불: 연기는 입자로 직접 보이므로 화면 전체 연무는 옅게 (후처리 안개가 반투명 입자 위에 덮여 연기를 가리지 않게)
    S.setLook(type === 'wildfire' ? { ...env, vis: Math.max(env.vis, 30000), tintAmt: (env.tintAmt || 0) * .4, gloom: 0 } : env);
    if (waterSpec) {
      if (type !== 'tsunami') { const lv = baseH() + waterAmount(); if (water) water.setHeight(lv); if (bReady) B.water(lv, false); }
      scheduleWater();
    }
    // 지도 바다 표면도 같이 올림: 해수면 상승(+ 폭풍해일) · 태풍 폭풍해일 (해일은 아래 tick에서 매 프레임)
    S.seaRise = p.waterBase === 'point' ? 0 : type === 'sealevel' ? p.rise + p.surge : type === 'typhoon' ? (env.water || 0) : 0;
    if (type === 'quake') buildQuake();
    if (type === 'wildfire') buildFire();
    if (type === 'snow') snowT = p.time;
  }

  /* ── 지진 ── */
  function buildQuake() {
    for (const e of entities.splice(0)) viewer.entities.remove(e);
    for (const l of quakeLines.splice(0)) l.destroy();
    const M = p.M, depth = p.depth, colors = { 5: '#9be564', 6: '#f2d544', 7: '#f59a32', 8: '#e8562c', 9: '#b0182c' };
    const radiusFor = lvl => { let lo = 0, hi = 2000; if (Phys.mmi(Phys.pga(M, depth, 0)) < lvl) return 0; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (Phys.mmi(Phys.pga(M, depth, m)) >= lvl) lo = m; else hi = m; } return lo; };
    for (const lvl of [9, 8, 7, 6, 5]) {
      const r = radiusFor(lvl) * 1000; if (r < 50) continue;
      quakeLines.push(S.groundLine({ positions: S.ringPositions(longitude, latitude, r, r, 0, 0, 0, 160), color: Cesium.Color.fromCssColorString(colors[lvl]).withAlpha(.9), width: 3 }));
      add({ position: Cesium.Cartesian3.fromDegrees(longitude, latitude + r / 111320, 0), label: { text: `진도 ${['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ'][lvl]} (${(r / 1000).toFixed(1)} km)`, font: '600 13px system-ui', fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    }
    add({ position: Cesium.Cartesian3.fromDegrees(longitude, latitude), point: { pixelSize: 10, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    quake = { t0: S.simTime() };
  }
  let shakePrev = { x: 0, y: 0, z: 0 };
  tick.add((now, real) => {
    if (type !== 'quake' || !quake) return;
    const cam = viewer.camera;
    // 카메라 아래 지점과 진앙 사이 거리로 그 자리 지반 가속도
    const c = Cesium.Cartographic.fromCartesian(cam.positionWC);
    const d = c ? Cesium.Cartesian3.distance(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude), Cesium.Cartesian3.fromDegrees(longitude, latitude)) / 1000 : p.dist;
    const pga = Phys.pga(p.M, p.depth, d), dur = clamp(Phys.shakeSeconds(p.M), 3, 60), cyc = dur + 4, ph = ((now - quake.t0) % cyc) / dur;
    const envl = ph > 1 ? 0 : Math.min(1, ph / .12) * Math.pow(1 - ph, .6), a = clamp(pga, 0, 2) * envl * .03, w = real * 2 * Math.PI * 1.5;
    shakePrev = { x: Math.sin(w * 1.1) * a, y: Math.sin(w * .9 + 3) * a, z: Math.sin(w * 1.4 + 5) * a * .5 };
    if (bReady) { if (!quake.ready) { quake.ready = true; quake.t0 = now; } B.quake({ t: now - quake.t0, env: envl, M: p.M, depth: p.depth, dur, exag: p.exag ?? 10 }); } // 건물 준비되면 처음부터
    S.shake.x = shakePrev.x * .5; S.shake.y = shakePrev.y * .5; S.shake.z = shakePrev.z;
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
    fire.scar.destroy(); fire.front.destroy(); fire = null;
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
    // 불탄 자리: 땅 · 건물에 덮는 다각형. 브이월드 빌드엔 다각형 작업 파일이 없어 바로 만드는 GroundPrimitive로 (자랄 때마다 새로)
    const scarColor = Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromBytes(16, 12, 10, 165));
    const scar = { prim: null, set(r) {
      const prim = scene.groundPrimitives.add(new Cesium.GroundPrimitive({ asynchronous: false, classificationType: Cesium.ClassificationType.BOTH,
        geometryInstances: new Cesium.GeometryInstance({ geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(r) }), attributes: { color: scarColor } }),
        appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }) }));
      if (this.prim) scene.groundPrimitives.remove(this.prim); this.prim = prim;
    }, destroy() { if (this.prim) scene.groundPrimitives.remove(this.prim); this.prim = null; } };
    scar.set(r0);
    const front = S.groundLine({ positions: [...r0, r0[0]], color: Cesium.Color.fromCssColorString('#ff8a2a'), width: 9, glow: true });
    // 연기 (입자): 화선 근처 불타는 점을 따라 옮김. 바람(m/s) 쪽으로 흐름
    const windVec = new Cesium.Cartesian3(), wind = () => { const a = (q.dir + 180) * Math.PI / 180; return Cesium.Matrix4.multiplyByPointAsVector(enu, new Cesium.Cartesian3(Math.sin(a) * q.wind, Math.cos(a) * q.wind, 0), windVec); };
    const smoke = [];
    for (let i = 0; i < 12; i++) smoke.push(scene.primitives.add(new Cesium.ParticleSystem({
      image: SMOKE, sizeInMeters: true, minimumImageSize: new Cesium.Cartesian2(90, 90), maximumImageSize: new Cesium.Cartesian2(150, 150),
      startScale: 1, endScale: 8, minimumParticleLife: 60, maximumParticleLife: 120, minimumSpeed: 8, maximumSpeed: 15, emissionRate: 3,
      startColor: Cesium.Color.WHITE.withAlpha(.65), endColor: Cesium.Color.WHITE.withAlpha(0), emitter: new Cesium.CircleEmitter(Math.max(60, Math.sqrt(area) * .08)), modelMatrix: Cesium.Matrix4.IDENTITY.clone(),
      updateCallback: (part, dt) => { if (Cesium.Cartesian3.magnitude(part.velocity) < q.wind * 2 + 20) Cesium.Cartesian3.add(part.velocity, Cesium.Cartesian3.multiplyByScalar(wind(), dt * .08, new Cesium.Cartesian3()), part.velocity); },
    })));
    fire = { t0: S.simTime(), bbs, pts, scar, front, smoke, ring, layout: -1, poly, o, box: [minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY)], mapped: false };
  }
  const fc = new Cesium.Color();
  tick.add((now, real) => {
    if (type !== 'wildfire' || !fire) return;
    const g = clamp(.03 + (now - fire.t0) / 30, 0, 1.3), band = .16;
    if (bReady) {
      if (!fire.mapped) { // 건물용 불 번짐 지도: 영역 안 칸마다 발화점에서의 상대 거리 (밖 = 1.5)
        const n = 128, [x0, y0, sx, sy] = fire.box, rel = new Float32Array(n * n);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const q = [x0 + (i + .5) / n * sx, y0 + (j + .5) / n * sy]; rel[j * n + i] = inside(q, fire.poly) ? relOf(q, fire.o, fire.poly) : 1.5; }
        B.fireMap(rel, n, fire.box); fire.mapped = true;
      }
      B.fire(g);
    }
    for (const pt of fire.pts) {
      const d = g - pt.rel; let a = 0, sc = 1;
      const fl = .55 + .45 * Math.sin(real * (9 + pt.seed % 5) + pt.seed) * Math.sin(real * 4.3 + pt.seed * 1.7);
      if (d < 0) { fc.red = fc.green = fc.blue = 1; a = 0; }
      else if (d < band) { fc.red = fc.green = fc.blue = 1; a = pt.glow ? .55 : 1; sc = .75 + .45 * fl; }                       // 화선: 활활
      else { const k = clamp((d - band) / .5, 0, 1); fc.red = 1; fc.green = .6; fc.blue = .45; a = (pt.glow ? .25 : .7) * (1 - k * .85) * (.6 + .4 * fl); sc = .55 - .25 * k; } // 잔불
      fc.alpha = a; pt.bb.color = fc; pt.bb.scale = sc;
    }
    if (Math.abs(g - fire.layout) < .02 && g < 1) return; fire.layout = g;
    const r = fire.ring(Math.min(g, 1));
    fire.scar.set(r); fire.front.setPositions([...r, r[0]]);
    // 연기: 지금 화선 근처에서 타는 점으로
    const burning = fire.pts.filter(pt => g - pt.rel > 0 && g - pt.rel < .3);
    fire.smoke.forEach((ps, i) => { const pt = burning[(i * 37 + Math.floor(g * 10)) % Math.max(1, burning.length)]; if (!pt) return; const c = Cesium.Cartographic.fromCartesian(pt.bb.position); ps.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height + 40)); });
  });

  /* ── 지진해일: 실제 주기 12분 파형(먼저 빠지고 → 차오름 → 잠김 → 빠짐 → 두 번째 파)을 재생 배속만큼 빠르게.
     높이는 해안 처오름 높이(파고 × 배율, 실제 m. 지점 기준이면 + 선택 지점 지면 높이). 해수면 기준 물판이라 DEM보다 낮은 땅만 잠김.
     물이 해안보다 높은 동안 물 끝이 육지로 밀려 들어감: 속도는 육상 해일 물살 2√(g·h), h = 처오름의 1/4 (4 ~ 30 m/s) ── */
  const PERIOD = 720; let tsT0 = S.simTime(), tsReach = 0, tsLast = null;
  const boreSpeed = () => clamp(2 * Math.sqrt(9.81 * p.height * p.runup * .25), 4, 30);
  const tsEta = (tau, A) => { if (tau <= 0) return 0; const x = tau / PERIOD;
    if (x < .25) return -.4 * A * Math.sin(Math.PI * x / .25);
    if (x < .85) { const y = (x - .25) / .6; return A * (y < .25 ? Math.sin(Math.PI / 2 * y / .25) : Math.cos(Math.PI / 2 * (y - .25) / .75)); }
    if (x < 1.05) return -.25 * A * Math.sin(Math.PI * (x - .85) / .2);
    if (x < 1.6) return .55 * A * Math.sin(Math.PI * (x - 1.05) / .55); return 0; };
  tick.add(now => {
    if (type !== 'tsunami' || !water) return;
    const sea0 = baseH();
    let tau = (now - tsT0) * p.speed; if (tau > 1.7 * PERIOD) { tsT0 = now; tau = 0; tsReach = 0; }
    const eta = tsEta(tau, tsAmp()), dt = tsLast == null ? 0 : Math.min(now - tsLast, .25) * p.speed; tsLast = now;
    if (eta > 0) tsReach += boreSpeed() * dt;
    const lv = sea0 + Math.max(eta, -3); water.setHeight(lv); water.setReach(tsReach); S.seaRise = lv - sea0;
    if (bReady && lv > maxLv + .2) { maxLv = lv; B.water(maxLv, true); } // 가장 높이 찼던 물 자국 · 잠긴 층 손상
  });

  /* ── 대설: 경과 시간(h)에 따라 쌓이고(눈 오는 시간 동안) 녹음(녹는 시간 동안). 내리는 구간 20초 + 녹는 구간 25초 타임랩스
     (예전엔 전체 45초라 8시간 눈이 6초 만에 끝났음). 진행 멈춤이면 그 순간에 머문 채 눈만 계속 내림.
     경과 시간 슬라이더로 바로 옮길 수 있음. 눈이 그친 뒤엔 시정이 트여 쌓인 모습이 보임 ── */
  let snowT = p.time, snowLast = null;
  tick.add(now => {
    if (type !== 'snow') return;
    if (p.snowDepthCm != null) {
      if (S.C) S.C.setPrecip(false);
      S.setLook({ ...env, snow: 0, vis: 40000, gloom: (env.gloom || 0) * .2, tintAmt: (env.tintAmt || 0) * .3 }); // 이미 쌓인 눈: 그친 뒤처럼 맑게 (예전엔 짙은 흰 안개가 남아 화면이 하얬음)
      S.look.cover = clamp(p.snowDepthCm / 15, 0, 1);
      if (bReady) B.snow?.(S.cur.cover); // 지붕 · 옥상 눈 (브이월드 건물). ?.: 옛 buildings.js가 캐시돼 있어도 렌더링이 멈추지 않게
      return;
    }
    const dt = snowLast == null ? 0 : now - snowLast; snowLast = now;
    const end = p.hours + p.melt; snowT = Math.min(end, snowT + dt * (snowT < p.hours ? p.hours / 20 : p.melt / 25));
    const falling = snowT < p.hours;
    if (S.C) S.C.setPrecip(falling);
    S.setLook(falling ? env : { ...env, snow: 0, vis: 40000, gloom: (env.gloom || 0) * .2, tintAmt: (env.tintAmt || 0) * .3 });
    S.look.cover = clamp(Phys.snowDepth(p, snowT) / 15, 0, 1); // 15 cm면 땅이 거의 다 덮임
    if (bReady) B.snow?.(S.cur.cover);
    S.onProgress && S.onProgress('time', snowT);
  });

  for (const f of tick) S.tickers.add(f);
  apply();
  return {
    setIntensity() {},
    setParams(q) { p = normalize(q); apply(); },
    destroy() {
      alive = false;
      for (const f of tick) S.tickers.delete(f);
      S.shake.x = S.shake.y = S.shake.z = 0;
      for (const x of parts) x.destroy();
      clearTimeout(waterTimer); if (water) water.destroy();
      for (const e of entities) viewer.entities.remove(e);
      for (const l of quakeLines) l.destroy();
      clearFire();
      S.setLook({}); S.look.cover = 0; S.seaRise = 0;
      if (usesB) B.end();
      clearTimeout(cloudTimer); if (S.C && !S.C.api) S.C.clear();
    },
  };
}

export function registerDisasterEffects(disasters, viewer, Cesium) {
  const S = createShared(viewer, Cesium);
  try { S.B = createBuildingFX(viewer, Cesium); } catch (e) { console.warn('건물 효과를 쓸 수 없습니다', e); }
  for (const type of Object.keys(DX().TYPES)) if (type !== 'none') disasters.register(type, ctx => createEffect(type, ctx, S));
  return S;
}
