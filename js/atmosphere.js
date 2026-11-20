/* 맵별 하늘 · 바다 · 조명. 값은 원본 맵 썸네일(map-thumbnails/<slug>.webp)을 보고 맞춤.
   index.html(시점유도 sim)과 carrier.html(함재기 sim)이 같이 씀. 맵을 바꿀 때 Build_terrain()에서 apply()
   zenith/horizon: 하늘 꼭대기 · 수평선(=안개) 색, sun: 햇빛 색, sunElev: 해 고도(°, 방위는 페이지 기본값 유지),
   sunI: 햇빛 세기, hemiSky/hemiGround/hemiI: 반구광(위 · 아래 색, 세기), deep/shallow: 바다 색 (없으면 페이지 기본),
   cloudLit/cloudDark: 구름 밝은 면 · 그늘 색, cover: 구름 양 (+ 많이, - 적게), haze: 안개 거리 배율 (작을수록 뿌옇게),
   aurora: 오로라 세기, seaState: 바다 거칠기 (너울 · 흰 물거품), rain: 비, structLights: 맵 구조물(건물 · 시추 시설) 창문 불빛, overcast: 하늘을 덮는 두꺼운 구름층 (흐린 날), glow: 해 광륜 · 해 쪽 수평선 물듦, glint: 바다 햇빛 반짝임 */
(function(root){
'use strict';
const DEFAULT = {
  zenith: 0x2c64a6, horizon: 0xa9bfcc, sun: 0xfff1d6, sunElev: 25, sunI: .9,
  hemiSky: 0xcfe0ec, hemiGround: 0x1d3440, hemiI: .95, deep: null, shallow: null,
  cloudLit: null, cloudDark: null, cover: 0, haze: 1, aurora: 0, glow: 1, glint: 1, seaState: .15, rain: 0, overcast: 0, structLights: 0,
  clarity: .2, caps: .6, sand: 0xb4a88a,
};
/* 물 맑기 · 흰 물마루 · 해저 모래색 (썸네일 기준). clarity = 1 m당 빛이 줄어드는 정도 (작을수록 맑아 얕은 바닥이 잘 비침),
   caps = 잔잔한 바다에도 흩어지는 흰 물마루 양 (거친 바다 seaState와 별개), sand = 얕은 바닥 색 (terrain.js가 수면 아래를 이 색으로) */
const WATER_LOOK = {
  'jade-lagoon': [.09, .35, 0xdcd2aa], 'teal-shoal': [.13, .5, 0xcaa47c], 'sapphire-sea': [.13, .5, 0xb8b292], 'glacier-indigo': [.15, .4, 0xa4b8c8],
  'dawn-current': [.17, .6, 0xc8aa88], 'calm-steel': [.22, .6, 0xb4ac8c], 'dusk-slate': [.25, .4, 0x8c8472], 'midnight-deep': [.25, .5, 0x6c7074],
  'emerald-bay': [.28, .5, 0xa09c7a], 'mauve-harbor': [.3, .3, 0x7c7264], 'choppy-moss': [.32, 1, 0x605e54], 'bronze-estuary': [.34, .4, 0x9c8c6c],
  'ashen-north': [.35, .9, 0x5a5a54], 'frost-gray': [.35, .7, 0x707276], 'raging-sea': [.45, 1.2, 0x4c5052],
};
const SAND = { value: null }; // THREE.Color (apply에서 만듦). terrain.js 해저 색
/* 원본 썸네일처럼 명암이 강하게: 햇빛(sunI)은 세게, 그늘을 채우는 반구광(hemiI)은 약하게.
   glow = 해 주변 광륜 · 해 쪽 수평선과 물길이 햇빛 색으로 물드는 정도, glint = 바다 햇빛 반짝임 */
const PRESETS = {
  // 이 지형: 쨍한 낮, 붉은 바위 · 청록 바다
  'clear-noon': { zenith: 0x2f86d6, horizon: 0xc4dff2, sun: 0xffeccc, sunElev: 38, sunI: 1.55,
    hemiSky: 0xbcd8f0, hemiGround: 0x4a3a28, hemiI: .55, deep: 0x0b4a78, shallow: 0x25a0b4, cloudDark: 0x9eacc0, glint: 1.3 },
  // 이 지형: 열대 한낮, 하늘 높이 뜬 해 · 옥빛 바다
  'tropic-zenith': { zenith: 0x3d9ce6, horizon: 0xd2ecfa, sun: 0xfff6e2, sunElev: 55, sunI: 1.6,
    hemiSky: 0xc8e4f8, hemiGround: 0x2a4a3c, hemiI: .6, deep: 0x0a6090, shallow: 0x2cc4d0, cloudDark: 0xa4b6ca, cover: -.06, glow: 1.3, glint: 1.4 },
  // 이 지형: 역광 해 · 물 위로 길게 반짝이는 햇빛, 초록빛 바다
  'backlit-haze': { zenith: 0x6f93c4, horizon: 0xd6dde0, sun: 0xfff2dc, sunElev: 18, sunI: 1.5,
    hemiSky: 0xc4d2de, hemiGround: 0x22403a, hemiI: .55, deep: 0x154a4c, shallow: 0x2e8a78, cloudDark: 0x8a98aa,
    cover: .05, haze: .8, glow: 1.8, glint: 2.2 , seaState: .3 , overcast: .25 },
  // 이 지형: 먹구름 사이로 새는 차가운 빛, 짙은 바다
  'slate-overcast': { zenith: 0x55687c, horizon: 0x9eacb8, sun: 0xdfe6ee, sunElev: 28, sunI: .95,
    hemiSky: 0xa4b2c0, hemiGround: 0x1e2428, hemiI: .55, deep: 0x16242c, shallow: 0x34505a,
    cloudLit: 0xc2ccd6, cloudDark: 0x4c5662, cover: .3, haze: .6, glow: .7, glint: .8 , seaState: .6 , overcast: .85 },
  // 이 지형: 맑고 차가운 파랑, 눈부신 얼음
  'polar-blue': { zenith: 0x3478c6, horizon: 0xb8d8f2, sun: 0xf6faff, sunElev: 32, sunI: 1.1,
    hemiSky: 0xc4dcf4, hemiGround: 0x4a6a8c, hemiI: .42, deep: 0x0a3668, shallow: 0x2468a6, cloudDark: 0x92a8c4, cover: -.05, glint: 1.3 },
  // 이 지형: 낮게 깔린 노을, 금빛 연무
  'golden-dusk': { zenith: 0x5a7298, horizon: 0xe6b880, sun: 0xffb860, sunElev: 7, sunI: 1.7,
    hemiSky: 0xc8b49c, hemiGround: 0x2c2218, hemiI: .45, deep: 0x22323e, shallow: 0x6a5e44,
    cloudLit: 0xffd49a, cloudDark: 0x6a5a66, cover: .08, haze: .75, glow: 2.2, glint: 2 , overcast: .35 },
  // 이 지형: 눈 오는 흐린 날 (그늘이 옅은 확산광)
  'blizzard-gray': { zenith: 0x7c808c, horizon: 0xbcbec4, sun: 0xeaeaee, sunElev: 25, sunI: .65,
    hemiSky: 0xc0c4cc, hemiGround: 0x30343a, hemiI: .85, deep: 0x26343e, shallow: 0x52606a,
    cloudLit: 0xc6c8ce, cloudDark: 0x6c707a, cover: .32, haze: .55, glow: .5, glint: .5 , seaState: .5 , overcast: .9 },
  // 이 지형: 보랏빛 · 분홍 노을
  'violet-sunset': { zenith: 0x404a78, horizon: 0xdc9c8c, sun: 0xffa274, sunElev: 6, sunI: 1.4,
    hemiSky: 0xa898b8, hemiGround: 0x241c2c, hemiI: .5, deep: 0x1a243c, shallow: 0x524c66,
    cloudLit: 0xf8ac9c, cloudDark: 0x4c4a76, cover: .18, haze: .85, glow: 2, glint: 1.8 , overcast: .4 },
  // 이 지형: 밤, 오로라 · 수평선의 주황 해
  'aurora-night': { zenith: 0x0e1428, horizon: 0x464c66, sun: 0xff8a48, sunElev: 3, sunI: .9,
    hemiSky: 0x5a6a90, hemiGround: 0x141a22, hemiI: .5, deep: 0x0a1824, shallow: 0x24384c,
    cloudLit: 0x868ca6, cloudDark: 0x242a3a, haze: .8, aurora: 1.2, glow: 2.4, glint: 2.2 , seaState: .25 , overcast: .3 , structLights: 1 },
  // 이 지형: 옅은 연무 속 밝은 낮
  'milky-haze': { zenith: 0x6c88aa, horizon: 0xc8ced4, sun: 0xfff0da, sunElev: 35, sunI: 1.35,
    hemiSky: 0xbccad6, hemiGround: 0x283638, hemiI: .6, deep: 0x163a4c, shallow: 0x30707c, cover: .1, haze: .8, glint: 1.1 , overcast: .3 },
  // 이 지형: 진하게 맑은 파랑, 뭉게구름
  'cumulus-blue': { zenith: 0x0566ba, horizon: 0x9ccbe2, sun: 0xfff6e4, sunElev: 45, sunI: 1.65,
    hemiSky: 0xbcdcf2, hemiGround: 0x1a3434, hemiI: .55, deep: 0x083c60, shallow: 0x188898, cover: .06, glint: 1.4 },
  // 이 지형: 차가운 확산광으로 형태를 읽고, 작업등 아래에만 밝은 부분이 생김.
  'thunder-storm': { zenith: 0x080c12, horizon: 0x1c2630, sun: 0x9aabbc, sunElev: 20, sunI: .35,
    hemiSky: 0x8799ac, hemiGround: 0x2c3a46, hemiI: .65, deep: 0x091b29, shallow: 0x1e3e52,
    cloudLit: 0x4c5a68, cloudDark: 0x10161e, cover: .45, haze: .45, glow: .2, glint: .35, seaState: 1, rain: 1 , overcast: 1 , structLights: 1 },
  // 이 지형: 분홍 · 연보라 노을, 수면에 비치는 낮은 해
  // (노을: 위는 푸른 회색, 수평선은 주황 · 분홍, 구름 밑면은 따뜻한 빛 · 그늘은 차가운 남회색)
  'rose-twilight': { zenith: 0x48577a, horizon: 0xe8b49c, sun: 0xffc896, sunElev: 9, sunI: 1.45,
    hemiSky: 0xb4aab8, hemiGround: 0x26262c, hemiI: .5, deep: 0x1c2638, shallow: 0x4a5266,
    cloudLit: 0xf6b49a, cloudDark: 0x4a4e6c, cover: .15, haze: .8, glow: 2, glint: 2.2 , overcast: .35 },
  // 이 지형: 금빛 해돋이, 눈부신 물길
  'amber-dawn': { zenith: 0x4e82c0, horizon: 0xeed2ac, sun: 0xffcc86, sunElev: 9, sunI: 1.75,
    hemiSky: 0xc8c8cc, hemiGround: 0x2e2a28, hemiI: .5, deep: 0x183c58, shallow: 0x3e7a90,
    cloudLit: 0xffecc8, cloudDark: 0x948ca0, cover: .1, glow: 2.4, glint: 2.4 },
  // 이 지형: 흐린 회녹색, 거친 바다
  'sea-fog': { zenith: 0x7a8c9c, horizon: 0xb8c0be, sun: 0xf2eee2, sunElev: 30, sunI: .95,
    hemiSky: 0xb8c0c0, hemiGround: 0x262c28, hemiI: .65, deep: 0x1e2e34, shallow: 0x44585a,
    cloudLit: 0xccd2d2, cloudDark: 0x667078, cover: .3, haze: .65, glow: .7, glint: .7 , seaState: .55 , overcast: .7 },
};
/* 하늘 텍스처 (terrain/texture_map/map_sky → terrain/sky/<slug>.jpg, 2048², 선형 → 화면 색 감마 2.2로 구움).
   원본은 위 반구 팔면체(hemi-octahedral) 투영: 가운데 = 천정, 정사각형 테두리 = 수평선.
   어느 하늘을 쓸지는 맵 썸네일 기준 (이름이 같아도 썸네일과 다르면 다른 하늘):
   sun = 텍스처 속 해의 방위 (x, z) → 페이지 해 방위에 맞춰 하늘을 돌림, horizon · zenith = 텍스처 수평선 · 천정 평균색 (안개 · 바다 반사 이음매용),
   tint = 프리셋 하늘색(썸네일)으로 섞는 비율, gain = 하늘 밝기 배율 */
const SKY = {
  'clear-noon':       { sun: [-.777, .616], horizon: 0xcbcece, zenith: 0x546377 },
  'tropic-zenith':         { sun: [-.047, .933], horizon: 0x9daebd, zenith: 0x004872, tint: .15 },
  'backlit-haze':       { sun: [.726, .687], horizon: 0xbdcddc, zenith: 0xa7b2c6 },
  'slate-overcast':            { sun: [-.462, .329], horizon: 0x6f8094, zenith: 0x6d85a3, tint: .2 },
  'polar-blue':           { sun: [-.742, .67], horizon: 0xb2d5f4, zenith: 0x79a8e4 },
  'golden-dusk':           { sun: [-.818, .57], horizon: 0x8a6245, zenith: 0x654c41, gain: 1.45 }, // 원본이 어두움 (최대 163/255) → 썸네일 금빛 밝기
  'blizzard-gray': { sun: [-.887, .426], horizon: 0x8394b8, zenith: 0xb7c2ed, tint: .35 },
  'violet-sunset':         { sun: [-.628, .774], horizon: 0x8d7284, zenith: 0x626c93, gain: 1.2 },
  'aurora-night':      { sun: [-.668, -.608], horizon: 0x4b4847, zenith: 0x454951 },
  'milky-haze':     { sun: [-.838, .487], horizon: 0xa2a8b4, zenith: 0x6f86a0 },
  'cumulus-blue':         { sun: [-.665, .632], horizon: 0xb8bec0, zenith: 0x637691 },
  'thunder-storm':              { sun: [-.666, .71], horizon: 0x4a5055, zenith: 0x575c65 },
  'rose-twilight':         { sun: [-.646, .749], horizon: 0x8f969f, zenith: 0x8d96a7 },
  'amber-dawn':    { sun: [-.936, .28], horizon: 0x858aa0, zenith: 0x637097 },
  'sea-fog':          { sun: [-.909, .06], horizon: 0xb6c5d1, zenith: 0x556e8f, tint: .45 }, // 게임 하늘은 맑지만 썸네일은 흐림
};
const SKY_BASE = 'data/sky/';
const SKY_GLSL = `
uniform sampler2D skyTex; uniform float skyOn; uniform vec2 skyRot; uniform float skyTint; uniform float skyGain;
vec3 skyTexColor(vec3 d){
  vec3 r = vec3(d.x*skyRot.x - d.z*skyRot.y, max(d.y, 0.), d.x*skyRot.y + d.z*skyRot.x);
  vec2 p = r.xz/(abs(r.x) + r.y + abs(r.z) + 1e-6);
  vec2 uv = vec2(p.x + p.y, p.x - p.y)*.5 + .5;
  return texture2D(skyTex, vec2(uv.x, 1. - uv.y)).rgb;
}
`;
const SKY_MIX = `
      if (skyOn > 0.) { vec3 tc = mix(skyTexColor(d)*skyGain, mix(hor, zenith, pow(up, .45)), skyTint); c = mix(c, tc, skyOn*smoothstep(-.03, 0., d.y)); }
      `;
const skyCache = {};
let skyWant = null;
// 페이지 하늘 셰이더에 텍스처 하늘을 끼움 (한 번만). 오로라 · 구름 셰이더는 그대로 두고 오로라 앞에서 덮음
function patchSky(THREE, m){
  if (m.uniforms.skyTex) return;
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat); blank.needsUpdate = true;
  Object.assign(m.uniforms, { skyTex: { value: blank }, skyOn: { value: 0 }, skyRot: { value: new THREE.Vector2(1, 0) }, skyTint: { value: 0 }, skyGain: { value: 1 } });
  const mark = '// 오로라 (이 지형)', fs = m.fragmentShader, i = fs.indexOf(mark);
  m.fragmentShader = SKY_GLSL + (i >= 0 ? fs.slice(0, i) + SKY_MIX + fs.slice(i) : fs.replace(/gl_FragColor = vec4\(c, 1\.\);\s*\}\s*$/, SKY_MIX + 'gl_FragColor = vec4(c, 1.);\n}'));
  m.needsUpdate = true;
}
function applySky(o, slug, p){
  const THREE = root.THREE, m = o.skyMat; if (!THREE || !m) return;
  patchSky(THREE, m);
  const u = m.uniforms, s = opts.detail && slug && SKY[slug];
  skyWant = s ? slug : null;
  if (!s) { u.skyOn.value = 0; return; }
  const a = o.sunAzDir, th = Math.atan2(s.sun[1], s.sun[0]) - Math.atan2(a.z, a.x);
  u.skyRot.value.set(Math.cos(th), Math.sin(th)); u.skyTint.value = s.tint || 0; u.skyGain.value = s.gain || 1;
  const use = tex => { if (skyWant !== slug) return; u.skyTex.value = tex; u.skyOn.value = 1; };
  const hit = skyCache[slug];
  if (hit && hit.tex) { use(hit.tex); return; }
  u.skyOn.value = 0;
  if (hit) return;
  skyCache[slug] = {};
  new THREE.TextureLoader().load(SKY_BASE + slug + '.jpg', tex => {
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 4; skyCache[slug].tex = tex; use(tex);
    // 하늘이 비동기로 도착한 뒤 환경광도 같은 텍스처로 다시 구움.
    if (skyWant === slug && root.MapScenery && root.MapScenery.env.update) root.MapScenery.env.update();
  }, undefined, () => { delete skyCache[slug]; console.warn('하늘 텍스처를 읽지 못함: ' + slug); });
}
const mixHex = (a, b, t) => { const ch = s => [(a >> s) & 255, (b >> s) & 255]; let r = 0;
  for (const s of [16, 8, 0]) { const [x, y] = ch(s); r |= Math.round(x + (y - x)*t) << s; } return r; };
// night: 0 = 밝은 낮 ~ 1 = 밤 · 이 지형. 햇빛(세기 × 밝기 × 고도)과 반구광 밝기로 계산 → 함재기 항법등 · 계기판 발광 세기
const WIN_GLSL = `
  {
    // 창문 불빛: 수직 벽면에만 격자로 창을 깔고 일부만 켬 (나트륨등 주황 · 가끔 백열등 색). 실내 불빛이 번진 은은한 빛 조금
    vec3 fn = normalize(cross(dFdx(WP), dFdy(WP)));
    float wall = 1. - smoothstep(WALL0, WALL1, abs(fn.y)); // 벽 기울기 허용 범위 (함선은 스텔스형 경사 함교까지, 구조물은 거의 수직만)
    vec2 hz = normalize(vec2(-fn.z, fn.x) + 1e-6);
    vec2 wc = vec2(dot(WP.xz, hz), WP.y - BASEY)/SPACING;
    vec2 id = floor(wc), f = fract(wc);
    float pane = smoothstep(PW, PW + .08, f.x)*smoothstep(1. - PW, .92 - PW, f.x)*smoothstep(.25, .33, f.y)*smoothstep(.75, .67, f.y);
    float h1 = fract(sin(dot(id, vec2(12.9898, 78.233)))*43758.5453);
    vec3 wcol = mix(vec3(1., .55, .18), vec3(1., .8, .5), step(.88, h1));
    totalEmissiveRadiance += wcol*GAIN*(1. + h1)*wall*pane*step(LIT, h1)*CLUSTER*MASK*STRENGTH;
    totalEmissiveRadiance += vec3(1., .58, .22)*GLOW*MASK*STRENGTH;
  }`;
const lum = c => (.2126*((c >> 16) & 255) + .7152*((c >> 8) & 255) + .0722*(c & 255))/255;
/* 맵 옵션 (두 시뮬 공통, 이 브라우저에 저장)
   detail: 맵 디테일 표시 (끄면 맵마다 다른 하늘 · 바다 · 조명 · 비 · 창문 불빛 없이 예전의 기본 모습)
   team: 우리 팀 'A' | 'B' | 'random' (배치할 때마다 뽑음), slot: 스폰 자리 0 = 무작위 · 1~7 = 그 번호
   enemy: (시점유도) 적 배치 'enemy' = 상대 팀 스폰 · 'ally' = 우리 팀 스폰 · 'near' = 내 함선 주변 (예전 방식) */
const opts = { detail: true, team: 'A', slot: 0, enemy: 'enemy' };
try { Object.assign(opts, JSON.parse(localStorage.getItem('map-opts') || '{}')); } catch {}
const saveOpts = () => { try { localStorage.setItem('map-opts', JSON.stringify(opts)); } catch {} };
let ours = 'TeamA';
function rollTeam(){ ours = opts.team === 'random' ? (Math.random() < .5 ? 'TeamA' : 'TeamB') : 'Team' + (opts.team === 'B' ? 'B' : 'A'); return ours; }
const teams = () => ({ ours, enemy: ours === 'TeamA' ? 'TeamB' : 'TeamA' });
rollTeam();
// 설정 화면 연결: 있는 요소만. onLook = 하늘 · 바다 다시 적용, onSpawn = 함선 다시 배치
function bindUI(onLook, onSpawn){
  const $ = id => document.getElementById(id);
  const d = $('mapDetail'), t = $('spawnTeam'), sl = $('spawnSlot'), en = $('enemySpawn'), re = $('respawnSpawn');
  if (d) { d.checked = opts.detail; d.addEventListener('change', () => { opts.detail = d.checked; saveOpts(); onLook(); }); }
  if (t) { t.value = opts.team; t.addEventListener('change', () => { opts.team = t.value; saveOpts(); onSpawn(); }); }
  if (sl) { sl.value = String(opts.slot); sl.addEventListener('change', () => { opts.slot = +sl.value || 0; saveOpts(); onSpawn(); }); }
  if (en) { en.value = opts.enemy; en.addEventListener('change', () => { opts.enemy = en.value; saveOpts(); onSpawn(); }); }
  if (re) re.addEventListener('click', onSpawn);
}

/* 창문 불빛 세기 (공유 uniform): WIN = 함선 창문 · 내 함선 투광등, STRUCT_WIN = 맵 구조물 창문 (이 지형 · 이 지형) */
const WIN = { value: 0 }, STRUCT_WIN = { value: 0 };
/* 구름 그림자: 구름 아래 바다 · 지형이 살짝 어두움 (구름이 빛을 조금만 통과). 월드 좌표에 흘러가는 얼룩, TIME은 페이지 루프가 갱신 */
const CLOUD = { value: 0 }, TIME = { value: 0 };
const CLOUD_GLSL = `
uniform float uCloudSh; uniform float uCloudT;
float csHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
float csNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3. - 2.*f);
  return mix(mix(csHash(i), csHash(i + vec2(1., 0.)), f.x), mix(csHash(i + vec2(0., 1.)), csHash(i + vec2(1., 1.)), f.x), f.y); }
float cloudShadow(vec2 xz){
  vec2 p = xz/900. + vec2(uCloudT*.012, uCloudT*.005);
  float v = .5*csNoise(p) + .3*csNoise(mat2(.8, .6, -.6, .8)*p*2.1 + 5.2) + .2*csNoise(mat2(.8, .6, -.6, .8)*p*4.3 + 1.7);
  return smoothstep(.5, .66, v);
}
`;
/* 함선 불빛 (게임처럼)
   - 함교 창: 모델에 실제로 만들어진 함교 유리 띠 위치(opt.bands, 모델 원본 OBJ 좌표 { y:[아래, 위], z:[뒤, 앞], lit, front })에만
     창틀 무늬로 노란 불빛. 실제 함정 함교 위치를 참고해 함종별로 지정 (055 · 정조대왕급 · 엔터프라이즈 · 줌왈트)
   - 함교 창 주변에만 약한 작업등 (opt.flood, 기본 .3). 선체 · 갑판 전체를 자체 발광시키지 않음.
   - opt.deckLights = 항모 갑판 가장자리 등 (갑판 높이는 위를 향한 면 넓이로 찾음, opt.deck = 직접 지정)
   - opt.norm = { cx, cz, s, flip } 원본 OBJ 좌표 → 지오메트리 좌표 (Target_model이 가운데 맞춤 · 180° 회전 · 축척) */
const SHIP_GLSL = `
  {
    vec3 fn = normalize(cross(dFdx(vWinL), dFdy(vWinL)));
    float y = vWinL.y;
    float wall = 1. - smoothstep(.78, .86, abs(fn.y));                     // 경사진 함교 유리까지 (수평면 제외)
    vec2 hz = normalize(vec2(-fn.z, fn.x) + 1e-6);
    float u = dot(vWinL.xz, hz)/uWinSp, id = floor(u), fx = fract(u);
    float h1 = fract(sin(id*12.9898 + 4.1)*43758.5453);
    float pane = smoothstep(.06, .16, fx)*smoothstep(.94, .84, fx);
    float frontF = abs(fn.z)/max(length(fn.xz), 1e-4);
    float lit = 0.;
    for (int i = 0; i < 2; i++) {
      vec4 b = uBand[i]; vec2 o = uBandOpt[i];
      if (b.y <= b.x) continue;
      float e = (b.y - b.x)*.14;
      float iy = smoothstep(b.x, b.x + e, y)*(1. - smoothstep(b.y - e, b.y, y));
      float iz = smoothstep(b.z, b.z + uWinSp, vWinL.z)*(1. - smoothstep(b.w - uWinSp, b.w, vWinL.z));
      float fr = o.y > .5 ? smoothstep(.6, .8, frontF) : 1.;
      lit = max(lit, iy*iz*fr*step(1. - o.x, h1));
    }
    vec3 col = mix(vec3(1., .7, .34), vec3(1., .86, .62), h1);
    totalEmissiveRadiance += col*1.35*wall*pane*lit*uWin;
    // 창 가까이에만 새는 빛: 수평 갑판과 선체는 맵 조명 · 그림자를 그대로 받음.
    totalEmissiveRadiance += diffuseColor.rgb*vec3(1., .86, .66)*uFlood*wall*lit*uWin;
    if (uDeckLights > .5) {
      float band = smoothstep(uWinDeck - uWinSp*1.3, uWinDeck - uWinSp*1.1, y)*(1. - smoothstep(uWinDeck - uWinSp*.5, uWinDeck - uWinSp*.3, y));
      float d = abs(fract(u/9.) - .5)*9.;                                    // 등 사이 간격 = 창 9칸
      float w2 = 1. - smoothstep(.3, .45, abs(fn.y));
      totalEmissiveRadiance += vec3(1., .78, .4)*1.8*band*(1. - smoothstep(.25, .45, d))*w2*uWin;
    }
  }`;
// UV가 없는 항모 모델의 비행갑판: 선체와 다른 무광 도장, 착함 유도선 · 사출 레일 · 계류점.
// 발광이 아닌 반사색이므로 낮/밤 조명과 그림자를 그대로 받음.
const DECK_GLSL = `
  if (uDeckLights > .5) {
    vec3 face = normalize(cross(dFdx(vWinL), dFdy(vWinL)));
    float deck = smoothstep(.9, .98, abs(face.y))*(1. - smoothstep(uShipLength*.002, uShipLength*.004, abs(vWinL.y - uWinDeck)));
    vec2 p = vWinL.xz/uShipLength;
    float aa = max(fwidth(p.x), fwidth(p.y));
    float lane = p.x + p.y*.14 + .012;
    float runway = step(-.15, p.y)*step(p.y, .44);
    float edges = (1. - smoothstep(.0008, .0008 + aa, abs(abs(lane) - .031)))*runway;
    float center = (1. - smoothstep(.00065, .00065 + aa, abs(lane)))*step(.48, fract(p.y*40.))*runway;
    float rails = (1. - smoothstep(.0008, .0008 + aa, abs(abs(p.x) - .024)))*step(-.46, p.y)*step(p.y, -.12);
    vec2 tie = abs(fract(p*vec2(100., 90.)) - .5);
    float pins = (1. - smoothstep(.035, .1 + aa*100., length(tie)))*(1. - smoothstep(.001, .003, aa));
    float wear = .94 + .06*sin(p.y*110. + sin(p.x*71.));
    vec3 coating = diffuseColor.rgb*.24*wear;
    coating = mix(coating, vec3(.18, .19, .18), max(edges, center)*.8 + pins*.18);
    coating = mix(coating, vec3(.26, .17, .045), rails*.8);
    diffuseColor.rgb = mix(diffuseColor.rgb, coating, deck);
  }`;
function shipWindows(THREE, mats, geos, opt = {}){
  const box = new THREE.Box3(); geos.forEach(g => { g.computeBoundingBox(); box.union(g.boundingBox); });
  const L = Math.max(box.max.x - box.min.x, box.max.z - box.min.z), top = box.max.y, B = 64;
  const up = new Float32Array(B);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  // 높이별 위를 향한 면 넓이 → 가장 넓은 층 = 갑판
  for (const g of geos) {
    const p = g.attributes.position, idx = g.index ? g.index.array : null, cnt = idx ? idx.length : p.count;
    for (let i = 0; i < cnt; i += 3) {
      a.fromBufferAttribute(p, idx ? idx[i] : i); b.fromBufferAttribute(p, idx ? idx[i + 1] : i + 1); c.fromBufferAttribute(p, idx ? idx[i + 2] : i + 2);
      n.subVectors(b, a).cross(e.subVectors(c, a)); const area = n.length()/2; if (!area) continue;
      const y = (a.y + b.y + c.y)/3, ny = Math.abs(n.y)/(2*area); if (y <= 0) continue;
      if (ny >= .92) up[Math.min(B - 1, Math.floor(y/top*B))] += area;
    }
  }
  let k = 0; for (let i = 1; i < B; i++) if (up[i] > up[k]) k = i;
  const nm = opt.norm || { cx: 0, cz: 0, s: 1, flip: false };
  const deck = opt.deck != null ? opt.deck*nm.s : (k + .5)/B*top, sp = L/170;
  // 함교 띠: 원본 좌표 → 지오메트리 좌표 (180° 회전이면 z 부호가 바뀌어 앞 · 뒤가 뒤집힘)
  const bands = [0, 1].map(i => {
    const d = (opt.bands || [])[i]; if (!d) return new THREE.Vector4(0, 0, 0, 0);
    const z0 = (d.z[0] - nm.cz)*nm.s*(nm.flip ? -1 : 1), z1 = (d.z[1] - nm.cz)*nm.s*(nm.flip ? -1 : 1);
    return new THREE.Vector4(d.y[0]*nm.s, d.y[1]*nm.s, Math.min(z0, z1), Math.max(z0, z1));
  });
  const bandOpt = [0, 1].map(i => { const d = (opt.bands || [])[i] || {}; return new THREE.Vector2(d.lit ?? .9, d.front ? 1 : 0); });
  const u = { uWin: WIN, uWinDeck: { value: deck }, uWinTop: { value: top }, uWinSp: { value: sp }, uFlood: { value: opt.flood ?? .3 },
    uBand: { value: bands }, uBandOpt: { value: bandOpt }, uDeckLights: { value: opt.deckLights ? 1 : 0 }, uShipLength: { value: L } };
  for (const m of mats) {
    m.extensions = Object.assign(m.extensions || {}, { derivatives: true });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'varying vec3 vWinL;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWinL = transformed;');
      sh.fragmentShader = 'varying vec3 vWinL; uniform float uWin; uniform float uWinDeck; uniform float uWinTop; uniform float uWinSp; uniform float uFlood; uniform vec4 uBand[2]; uniform vec2 uBandOpt[2]; uniform float uDeckLights; uniform float uShipLength;\n' +
        sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + DECK_GLSL)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  if (uDeckLights > .5 && abs(vWinL.y - uWinDeck) < uShipLength*.004) roughnessFactor = .94;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  if (uWin > 0.) ' + SHIP_GLSL);
    };
  }
}
/* 함종별 함교 유리 띠 (모델 원본 OBJ 좌표, 함수 +Z · Y 위 · 수면 0). 실제 함정 기준:
   055형: 전방 상부 구조물 앞면을 감싸는 경사 유리 띠 (통합 마스트 바로 앞 · 아래)
   정조대왕급 (KDX-III Batch-II): 전방 상부 구조물 맨 윗단 앞면의 경사 유리창 (SPY-1D 면 아래)
   엔터프라이즈급 (CVN-65): 아일랜드 앞쪽 끝 위 두 층 (항해 함교 · 기함 함교)
   줌왈트: 복합 상부 구조물 앞 경사면 위쪽의 작은 창 한 줄 (옆면은 창 없음) */
const BRIDGES = {
  '055':   { bands: [{ y: [2.24, 2.47], z: [1.9, 3.85], lit: .92 }] },
  frigate: { bands: [{ y: [2.43, 2.63], z: [3.4, 4.65], lit: .92 }] },
  cv:      { bands: [{ y: [5.21, 5.37], z: [-13.3, -11.9], lit: .9 }, { y: [4.80, 4.99], z: [-13.3, -11.9], lit: .7 }] },
  zumwalt: { bands: [{ y: [3.5, 3.69], z: [1.3, 2.3], lit: .95, front: true }] },
};
function get(slug){
  const p = Object.assign({}, DEFAULT, slug && PRESETS[slug] || {});
  if (slug && WATER_LOOK[slug]) [p.clarity, p.caps, p.sand] = WATER_LOOK[slug];
  // 하늘 텍스처가 있으면 안개 · 바다 반사 색을 텍스처 수평선 · 천정 쪽으로 (먼 지형 · 수평선 이음매가 하늘과 같은 색)
  const s = slug && SKY[slug];
  if (s) { const k = 1 - (s.tint || 0); p.horizon = mixHex(p.horizon, s.horizon, .75*k); p.zenith = mixHex(p.zenith, s.zenith, .5*k); }
  const b = p.sunI*lum(p.sun)*Math.max(Math.sin(p.sunElev*Math.PI/180), .15) + p.hemiI*lum(p.hemiSky)*.6;
  if (p.night == null) p.night = Math.max(0, Math.min(1, (.7 - b)/.45));
  return p;
}

/* o: { skyMat, seaMat, sun, hemi, fog, fogNear, fogFar, sunAzDir (해 방위 기준 벡터), seaDeep, seaShallow, cloudLit, cloudDark (페이지 기본값), extraFog: [Color] } */
function apply(o, slug){
  const p = get(opts.detail ? slug : null), u = o.skyMat.uniforms, w = o.seaMat.uniforms;
  const e = p.sunElev*Math.PI/180, a = o.sunAzDir, h = Math.hypot(a.x, a.z) || 1;
  u.zenith.value.set(p.zenith); u.hor.value.set(p.horizon); u.sunCol.value.set(p.sun);
  u.sunDir.value.set(a.x/h*Math.cos(e), Math.sin(e), a.z/h*Math.cos(e));
  if (u.cloudLit) { u.cloudLit.value.set(p.cloudLit ?? o.cloudLit); u.cloudDark.value.set(p.cloudDark ?? o.cloudDark); u.cover.value = p.cover; u.aurora.value = p.aurora; }
  if (u.glow) u.glow.value = p.glow;
  if (u.overcast) u.overcast.value = p.overcast;
  if (w.glow) { w.glow.value = p.glow; w.glint.value = p.glint; }
  if (w.seaState) w.seaState.value = p.seaState;
  if (w.uClarity) { w.uClarity.value = p.clarity; w.uCaps.value = p.caps; }
  (SAND.value || (SAND.value = w.deep.value.clone())).set(p.sand);
  // 바다 uniform은 UniformsUtils.merge로 복사된 값이라 따로 맞춤
  w.zenith.value.copy(u.zenith.value); w.hor.value.copy(u.hor.value); w.sunCol.value.copy(u.sunCol.value); w.sunDir.value.copy(u.sunDir.value);
  applySky(o, slug, p);
  w.deep.value.set(p.deep ?? o.seaDeep); w.shallow.value.set(p.shallow ?? o.seaShallow);
  o.sun.color.set(p.sun); o.sun.intensity = p.sunI; o.sun.position.copy(u.sunDir.value).multiplyScalar(8000);
  // 그늘 · 그림자 속을 하늘빛으로 조금 더 채움 (그림자가 생긴 뒤로 그늘이 새까맣지 않게)
  o.hemi.color.set(p.hemiSky); o.hemi.groundColor.set(p.hemiGround); o.hemi.intensity = p.hemiI*1.3;
  o.fog.color.set(p.horizon);
  // 렌더러가 선형 색 공간이면 (scenery.js colorPipeline) 조명 · 안개 색도 선형으로. 하늘 · 바다 셰이더 값은 화면 색 그대로
  const toLinear = root.MapScenery && root.MapScenery.lightColor;
  if (toLinear) { toLinear(o.sun.color); toLinear(o.hemi.color); toLinear(o.hemi.groundColor); toLinear(o.fog.color); }
  if (o.fogNear != null) { o.fog.near = o.fogNear*p.haze; o.fog.far = o.fogFar*p.haze; }
  (o.extraFog || []).forEach(c => c.set(p.horizon));
  WIN.value = Math.max(0, Math.min(1, (p.night - .3)/.5));
  STRUCT_WIN.value = p.structLights ? Math.max(.6, WIN.value) : 0;
  CLOUD.value = opts.detail ? .3*Math.max(0, Math.min(1, .45 + p.cover*2.5))*(1 - .6*p.overcast)*Math.min(1, p.sunI) : 0;
  // 조명 uniform을 갱신한 뒤 물체 · 작업등 · 하늘 환경광을 함께 적용.
  if (root.MapScenery && root.MapScenery.afterAtmosphere) root.MapScenery.afterAtmosphere(p);
  return p;
}
root.MapAtmosphere = { DEFAULT, PRESETS, SKY, SKY_GLSL, patchSky, get, apply, opts, saveOpts, rollTeam, teams, bindUI, WIN, STRUCT_WIN, WIN_GLSL, shipWindows, BRIDGES, CLOUD, TIME, CLOUD_GLSL, SAND, WATER_LOOK };
})(typeof window !== 'undefined' ? window : globalThis);
