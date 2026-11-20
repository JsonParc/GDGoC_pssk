/* 재난 시뮬레이션 (시험판)
   - TYPES: 재난 종류마다 입력 파라미터(이름 · 단위 · 범위 · 기본값), 간이 공식 추정치(derive), 화면 연출 목표값(env)
   - create(): 비 · 눈 · 산불 · 해일 연출과 하늘 · 안개 · 바다 · 카메라 흔들림을 한 번에 다룸
   - mountUI(): 재난 선택 + 숫자 입력칸과 슬라이더(서로 연동) + 추정치 + JSON 입력
   - 외부(API)에서는 window.Disaster.set('typhoon', { wind: 50, rain: 80 }) 처럼 수치만 넘기면 됨

   간이 공식 출처: MetroRisk(MIT, github.com/FrancisCodex/disaster-simulator)의 engine/config.js · quakeSim.js 값과
   Campbell(1981) 지진동 감쇠식, Wald(1999) PGA→진도, Atkinson–Holliday(1977) 풍속–기압, Rothfusz 체감온도.
   모두 시각화용 근사이며 공학 계산이 아님. 화면 효과는 연출. */
(function (global) {
'use strict';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
const P = (key, label, unit, min, max, step, value) => ({ key, label, unit, min, max, step, value });
const fmt = (v, d = 0) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });

/* ───── 간이 공식 ───── */
const Phys = {
  pga: (M, depth, dist) => 0.0159 * Math.exp(0.868 * M) * Math.pow(Math.hypot(dist, depth) + 0.0606 * Math.exp(0.7 * M), -1.09), // g
  mmi: pga => clamp(3.66 * Math.log10(Math.max(pga * 980.665, 1e-3)) - 1.66, 1, 12),
  shakeSeconds: M => Math.pow(10, 0.5 * M - 2.2),                       // MetroRisk shakingDuration
  typhoonPressure: wind => 1010 - Math.pow(wind * 1.944 / 6.7, 1 / 0.644), // hPa
  surge: (wind, pc) => Math.max(0, (1013 - pc) / 100 + wind * wind / 2500), // 기압 1 hPa ≈ 1 cm + 바람 밀어올림(근사)
  floodDepth: (rain, drain, hours) => Math.min(15, Math.max(0, rain - drain) * hours / 1000 * 3), // 저지대로 모이는 배율 3
  heatIndex(t, rh) {                                                    // °C
    if (t < 27) return t;
    const f = t * 9 / 5 + 32;
    const hi = -42.379 + 2.04901523 * f + 10.14333127 * rh - .22475541 * f * rh - .00683783 * f * f - .05481717 * rh * rh
      + .00122874 * f * f * rh + .00085282 * f * rh * rh - .00000199 * f * f * rh * rh;
    return (hi - 32) * 5 / 9;
  },
  windChill: (t, v) => { const k = Math.pow(v * 3.6, .16); return v < 1.3 ? t : 13.12 + .6215 * t - 11.37 * k + .3965 * t * k; },
  fireSpread: (wind, rh) => 1.5 * Math.exp(.17 * wind) * clamp((60 - rh) / 40, .1, 1.5), // m/min
  // 시정(m): 비 V ≈ 25·R^-0.63 km (R mm/h), 눈 V ≈ 1.6·S^-0.8 km (S cm/h) — 관측 경험식 근사
  rainVis: r => r < .5 ? 30000 : clamp(25000 * Math.pow(r, -.63), 150, 30000),
  snowVis: s => s < .1 ? 30000 : clamp(1600 * Math.pow(s, -.8), 80, 30000),
  flameHeight: (wind, dry) => clamp(4 + wind * 1.2, 4, 40) * (.6 + .6 * dry), // m, 지표화 ~ 수관화
};
const MMI_KO = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'];

/* ───── 재난 종류 ─────
   env(p): 연출 목표값. rain mm/h · snow cm/h · wind m/s · dir 바람이 불어오는 방향(°, 북=0) · gloom 어두움 0~1 ·
   vis 시정(m, 안개가 다 덮는 거리) · tint/tintAmt 안개 색 · sea 바다 거칠기 0~1 · water 수면 상승(m) · mud 흙탕물 0~1 · heat 햇빛 강화 */
const TYPES = {
  none: { name: '없음', icon: '○', desc: '재난 효과를 끕니다.', params: [], derive: () => [], env: () => ({}) },
  typhoon: {
    name: '태풍', icon: '🌀', desc: '강풍 · 폭우 · 폭풍 해일. 구름이 짙어지고 바다가 거칠어지며 해안 저지대가 잠깁니다.',
    params: [P('wind', '최대 풍속', 'm/s', 17, 80, 1, 45), P('rain', '시간당 강수량', 'mm/h', 0, 150, 1, 50), P('dir', '바람이 불어오는 방향', '°', 0, 359, 1, 135)],
    derive(p) {
      const pc = Phys.typhoonPressure(p.wind);
      return [['중심기압', `${fmt(pc)} hPa`], ['시정 (비)', `${fmt(Phys.rainVis(p.rain) / 1000, 1)} km`], ['강도 (기상청 구분)', p.wind >= 54 ? '초강력' : p.wind >= 44 ? '매우 강' : p.wind >= 33 ? '강' : p.wind >= 25 ? '중' : '약'],
        ['폭풍 해일', `${fmt(Phys.surge(p.wind, pc), 1)} m`]];
    },
    env: p => ({ rain: p.rain, wind: p.wind, dir: p.dir, gloom: clamp(.3 + p.wind / 110 + p.rain / 400, 0, 1), vis: Phys.rainVis(p.rain),
      tint: 0x59636d, tintAmt: .7, sea: clamp(p.wind / 45, .3, 1), water: Phys.surge(p.wind, Phys.typhoonPressure(p.wind)), mud: .5 }),
  },
  flood: {
    name: '집중호우 · 홍수', icon: '🌧', desc: '시간당 강수량이 배수 능력을 넘으면 넘친 만큼 저지대에 물이 찹니다.',
    params: [P('rain', '시간당 강수량', 'mm/h', 0, 200, 1, 80), P('hours', '지속 시간', 'h', 1, 72, 1, 12), P('drain', '배수 능력', 'mm/h', 0, 120, 1, 40)],
    derive(p) {
      return [['누적 강수량', `${fmt(p.rain * p.hours)} mm`], ['배수 초과분', `${fmt(Math.max(0, p.rain - p.drain) * p.hours)} mm`],
        ['저지대 침수 깊이', `${fmt(Phys.floodDepth(p.rain, p.drain, p.hours), 1)} m`], ['시정 (비)', `${fmt(Phys.rainVis(p.rain) / 1000, 1)} km`], ['호우 특보', p.rain * 3 >= 90 ? '경보 수준' : p.rain * 3 >= 60 ? '주의보 수준' : '해당 없음']];
    },
    env: p => ({ rain: p.rain, wind: 6, dir: 200, gloom: clamp(.25 + p.rain / 250, 0, .9), vis: Phys.rainVis(p.rain), tint: 0x67717a, tintAmt: .6,
      sea: .45, water: Phys.floodDepth(p.rain, p.drain, p.hours), mud: 1 }),
  },
  quake: {
    name: '지진', icon: '〰', desc: '규모 · 깊이 · 거리로 지반 가속도를 추정하고 그 세기로 화면을 흔듭니다. 재생하면 흔들림 시간만큼 반복합니다.',
    params: [P('M', '규모', 'M', 3, 9.5, .1, 6.5), P('depth', '진원 깊이', 'km', 1, 100, 1, 10), P('dist', '진앙까지 거리', 'km', 0, 300, 1, 15)],
    derive(p) {
      const g = Phys.pga(p.M, p.depth, p.dist), mmi = Phys.mmi(g);
      return [['최대 지반 가속도 (PGA)', `${fmt(g, 2)} g`], ['수정 메르칼리 진도', MMI_KO[Math.round(mmi)] + ` (${fmt(mmi, 1)})`],
        ['강한 흔들림 시간', `${fmt(Phys.shakeSeconds(p.M))} 초`]];
    },
    env: p => { const g = Phys.pga(p.M, p.depth, p.dist); return { shake: g, shakeSec: Phys.shakeSeconds(p.M), gloom: .08, vis: lerp(20000, 6000, clamp(g, 0, 1)), tint: 0xb4a68a, tintAmt: clamp(g, 0, .5), sea: .25 }; },
  },
  tsunami: {
    name: '지진해일', icon: '🌊', desc: '먼바다에선 거의 안 보이다가 얕은 곳에서 높아집니다. 해안에 닿기 전 바닷물이 먼저 빠지고, 흰 물살과 함께 해수면이 몇 분간 차올라 처오름 높이보다 낮은 땅이 흙탕물에 잠긴 뒤 빠집니다. 도착 시간은 수심(√(g·d))으로 계산해 섬을 돌아 들어갑니다. 반복 재생됩니다.',
    params: [P('height', '파고 (수심 10 m 기준)', 'm', 1, 40, .5, 10), P('runup', '처오름 배율', '×', 1, 4, .1, 2), P('dir', '해일이 오는 방향', '°', 0, 359, 1, 315), P('speed', '재생 배속', '×', 1, 120, 1, 30)],
    derive(p) {
      const gh = d => p.height * Math.pow(10 / d, .25);
      return [['파고: 수심 4 km / 100 m / 10 m', `${fmt(gh(4000), 1)} / ${fmt(gh(100), 1)} / ${fmt(p.height, 1)} m`], ['처오름 높이', `${fmt(p.height * p.runup, 1)} m`],
        ['속도: 수심 4 km / 100 m / 10 m', `${fmt(Math.sqrt(9.81 * 4000) * 3.6)} / ${fmt(Math.sqrt(9.81 * 100) * 3.6)} / ${fmt(Math.sqrt(9.81 * 10) * 3.6)} km/h`],
        ['부서지기 시작 (파고 > 수심 × 0.78)', `수심 ${fmt(Math.pow(p.height * Math.pow(10, .25) / .78, 1 / 1.25), 1)} m 부근`]];
    },
    env: p => ({ tsunami: { height: p.height, runup: p.runup, dir: p.dir, speed: p.speed }, gloom: .2, vis: 16000, tint: 0x6a7680, tintAmt: .4, sea: .9, mud: .6, wind: 8, dir: p.dir }),
  },
  sealevel: {
    name: '해수면 상승', icon: '🌡', desc: '기후변화로 바다가 오른 만큼 해안 저지대가 잠깁니다. 폭풍해일을 더하면 그 위로 더 올라옵니다. IPCC 6차 보고서(AR6) 2100년 전망과 비교해 보세요.',
    params: [P('rise', '해수면 상승', 'm', 0, 5, .01, .77), P('surge', '폭풍해일 추가', 'm', 0, 5, .1, 0)],
    derive(p) {
      // IPCC AR6 WG1 표 9.9 · SPM: 1995–2014 대비 2100년 전 지구 평균 해수면 상승 중앙값(가능성 높은 범위)
      const ar6 = [['SSP1-1.9', .38, '0.28–0.55'], ['SSP1-2.6', .44, '0.32–0.62'], ['SSP2-4.5', .56, '0.44–0.76'], ['SSP3-7.0', .68, '0.55–0.90'], ['SSP5-8.5', .77, '0.63–1.01']];
      const near = ar6.reduce((a, b) => Math.abs(b[1] - p.rise) < Math.abs(a[1] - p.rise) ? b : a);
      return [['바다 높이 (상승 + 해일)', `${fmt(p.rise + p.surge, 2)} m`], ['가장 가까운 AR6 2100년 전망', `${near[0]} ${fmt(near[1], 2)} m (${near[2]})`],
        ['참고', p.rise > 1.01 ? '빙상 붕괴 등 가능성 낮은 고영향 시나리오 (2100년 최대 약 2 m, 2150년 최대 약 5 m)' : '가능성 높은 범위 안']];
    },
    env: p => ({ water: p.rise + p.surge, mud: p.surge > 0 ? .4 : 0, sea: p.surge > 0 ? .6 : .25, gloom: p.surge > 0 ? .25 : 0, vis: p.surge > 0 ? 12000 : 40000 }),
  },
  wildfire: {
    name: '산불', icon: '🔥', desc: '발화점(기본: 화면 가운데가 가리키는 땅)에서 피해 면적까지 불이 번지고 연기가 바람을 따라 흐릅니다.',
    params: [P('area', '피해 면적', 'ha', 1, 30000, 1, 800), P('wind', '풍속', 'm/s', 0, 30, .5, 7), P('dir', '바람이 불어오는 방향', '°', 0, 359, 1, 270), P('humidity', '상대 습도', '%', 5, 100, 1, 25)],
    derive(p) {
      const r = Math.sqrt(p.area * 1e4 / Math.PI), ros = Phys.fireSpread(p.wind, p.humidity);
      return [['피해 반경', `${fmt(r / 1000, 2)} km`], ['불꽃 높이', `${fmt(Phys.flameHeight(p.wind, clamp((100 - p.humidity) / 80, .2, 1)))} m`], ['확산 속도', `${fmt(ros, 1)} m/분`], ['이 면적까지 번지는 시간', `${fmt(r / ros / 60, 1)} 시간`],
        ['대형 산불 기준 (100 ha)', p.area >= 100 ? '해당' : '미만']];
    },
    env: p => ({ fire: { area: p.area, wind: p.wind, dir: p.dir, dry: clamp((100 - p.humidity) / 80, .2, 1) }, wind: p.wind, dir: p.dir, gloom: .15,
      vis: clamp(30000 / (1 + p.area / 2000), 6000, 30000), tint: 0xb87a48, tintAmt: .55 }),
  },
  heatwave: {
    name: '폭염', icon: '☀', desc: '뜨겁고 습한 공기로 햇빛이 강해지고 먼 곳이 누렇게 뿌옇게 보입니다.',
    params: [P('temp', '최고 기온', '°C', 28, 50, .5, 37), P('humidity', '상대 습도', '%', 10, 95, 1, 55), P('days', '지속 일수', '일', 1, 40, 1, 7)],
    derive(p) {
      const hi = Phys.heatIndex(p.temp, p.humidity);
      return [['체감 온도', `${fmt(hi, 1)} °C`], ['폭염 특보', hi >= 35 && p.days >= 2 ? '경보 수준' : hi >= 33 && p.days >= 2 ? '주의보 수준' : '해당 없음']];
    },
    env: p => { const k = clamp((p.temp - 30) / 15, 0, 1); return { heat: k, gloom: 0, vis: lerp(15000, 5000, k), tint: 0xdcb07c, tintAmt: lerp(.3, .75, k), sea: .1 }; },
  },
  snow: {
    name: '대설 · 한파', icon: '❄', desc: '눈이 바람에 날리고 시야가 하얗게 줄어듭니다.',
    params: [P('rate', '시간당 적설', 'cm/h', 0, 15, .5, 3), P('hours', '지속 시간', 'h', 1, 48, 1, 8), P('wind', '풍속', 'm/s', 0, 25, .5, 6), P('temp', '기온', '°C', -30, 2, .5, -6)],
    derive(p) {
      const total = p.rate * p.hours;
      return [['누적 적설', `${fmt(total, 1)} cm`], ['시정 (눈)', `${fmt(Phys.snowVis(p.rate) / (1 + p.wind / 15) / 1000, 2)} km`], ['체감 온도', `${fmt(Phys.windChill(p.temp, p.wind), 1)} °C`],
        ['대설 특보 (24시간)', total >= 20 ? '경보 수준' : total >= 5 ? '주의보 수준' : '해당 없음']];
    },
    env: p => ({ snow: p.rate, wind: p.wind, dir: 320, gloom: clamp(.2 + p.rate / 25, 0, .7), vis: Phys.snowVis(p.rate) / (1 + p.wind / 15), tint: 0xdde4ec, tintAmt: .8, sea: clamp(p.wind / 25, .2, .8) }),
  },
};

/* ───── 연출 엔진 ───── */
function create(THREE, o) {
  // o: { scene, camera, renderer, skyMat, seaMat, sea, sun, hemi, fog, seaLevel, getTerrain, ground }
  const { scene, camera, renderer, skyMat, seaMat, sea, sun, hemi } = o, fog = scene.fog;
  const U = () => { const t = o.getTerrain(); return (t ? t.scale : 10) / 10 / .8; }; // 1 m → 월드 단위 (원본 1단위 0.8 m, 배율 ×10 기준)
  const STORM = new THREE.Color(0x2c3a40), MUD = new THREE.Color(0x5a4a30), MUD_SHALLOW = new THREE.Color(0x8a7650), tmp = new THREE.Color();
  let base = null;
  const rebase = () => {
    base = { fog: fog.color.clone(), near: fog.near, far: fog.far, cover: skyMat.uniforms.cover.value, cloudLit: skyMat.uniforms.cloudLit.value.clone(),
      cloudDark: skyMat.uniforms.cloudDark.value.clone(), hor: skyMat.uniforms.hor.value.clone(), zenith: skyMat.uniforms.zenith.value.clone(),
      sunI: sun.intensity, hemiI: hemi.intensity, seaState: seaMat.uniforms.seaState.value,
      skyTint: skyMat.uniforms.skyTint ? skyMat.uniforms.skyTint.value : 0, skyGain: skyMat.uniforms.skyGain ? skyMat.uniforms.skyGain.value : 1,
      clarity: seaMat.uniforms.uClarity ? seaMat.uniforms.uClarity.value : .2, deep: seaMat.uniforms.deep.value.clone(), shallow: seaMat.uniforms.shallow.value.clone() };
  };
  const ZERO = { rain: 0, snow: 0, wind: 0, dx: 0, dz: 0, gloom: 0, vis: 40000, tintAmt: 0, sea: 0, water: 0, mud: 0, heat: 0 };
  const cur = { ...ZERO, tint: new THREE.Color(0x888888) }, goal = { ...ZERO, tint: new THREE.Color(0x888888) };
  let type = 'none', params = {}, env = {}, playing = true, time = 0;
  let data = null; // 맵 · API에서 받은 부가 정보(침수 이력 · 방재 시설 등)를 그대로 보관. 아직 연출에는 쓰지 않음

  /* 비 (선분) · 눈 (점): 카메라 둘레 상자 안에서 셰이더로 떨어지고 감싸 돌아옴 */
  // 실제 단위: 빗방울 낙하 속도 ≈ 9 m/s, 눈송이 ≈ 1.2 m/s, 카메라 둘레 120 m 안의 입자만 그림 (그 너머는 시정 안개가 맡음)
  const MAXR = 14000, MAXS = 12000, BOX_M = 120, RAIN_MS = 9, SNOW_MS = 1.2;
  const precipVS = (snow) => `
    attribute vec4 seed; uniform float t, box, speed, len, sway, flake, px; uniform vec3 cam; uniform vec2 wind; varying float vA;
    void main(){
      vec3 vel = vec3(wind.x, -speed*(.8 + .4*seed.w), wind.y);
      vec3 p = seed.xyz*box + vel*t;
      ${snow ? 'p.x += sin(t*.9 + seed.w*40.)*sway; p.z += cos(t*.7 + seed.w*30.)*sway;' : ''}
      p = mod(p - cam + box*.5, box) - box*.5;
      float fade = 1. - smoothstep(box*.28, box*.5, length(p));
      p += cam;
      ${snow ? '' : 'p -= vel*len*position.x;'}
      vec4 mv = modelViewMatrix*vec4(p, 1.);
      vA = fade;
      ${snow ? 'gl_PointSize = clamp(flake*px/-mv.z, 1., 7.);' : ''}
      gl_Position = projectionMatrix*mv;
    }`;
  const precipMat = (snow) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { t: { value: 0 }, box: { value: 100 }, speed: { value: 1 }, len: { value: .09 }, sway: { value: .5 }, flake: { value: .05 }, px: { value: 600 }, cam: { value: new THREE.Vector3() }, wind: { value: new THREE.Vector2() }, alpha: { value: snow ? .9 : .32 } },
    vertexShader: precipVS(snow),
    fragmentShader: snow
      ? 'uniform float alpha; varying float vA; void main(){ vec2 c = gl_PointCoord - .5; float d = length(c); if (d > .5) discard; gl_FragColor = vec4(vec3(.96), alpha*vA*smoothstep(.5, .2, d)); }'
      : 'uniform float alpha; varying float vA; void main(){ gl_FragColor = vec4(.72, .77, .82, alpha*vA); }',
  });
  function seeds(n, perItem) {
    const s = new Float32Array(n * perItem * 4), tip = new Float32Array(n * perItem * 3);
    for (let i = 0; i < n; i++) {
      const a = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < perItem; k++) { s.set(a, (i * perItem + k) * 4); tip[(i * perItem + k) * 3] = k; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(tip, 3)); g.setAttribute('seed', new THREE.BufferAttribute(s, 4));
    return g;
  }
  const rain = new THREE.LineSegments(seeds(MAXR, 2), precipMat(false)), snow = new THREE.Points(seeds(MAXS, 1), precipMat(true));
  for (const m of [rain, snow]) { m.frustumCulled = false; m.renderOrder = 5; m.visible = false; scene.add(m); }

  /* 산불: 발화점 둘레 땅 위 점들에서 불꽃(가산 혼합) · 연기 입자 */
  const EMIT = 700, FLAME = 6, SMOKE = 2;
  // 실제 단위: 불꽃 높이 = Phys.flameHeight, 연기는 부력으로 ≈ 6 m/s 상승 · 90초 동안 바람 따라 흐름.
  // 불은 발화점에서 바깥으로 번지는 띠(화선)로 타고, 지나간 자리는 연기만 남음
  const fireVS = (smoke) => `
    attribute vec4 base; attribute vec3 rnd; uniform float t, grow, rise, size, px, rate; uniform vec2 drift; varying float vLife; varying float vA;
    void main(){
      float life = fract(t*rate*(.7 + rnd.z*.6) + rnd.x);
      vec3 p = base.xyz;
      float a = rnd.y*6.2832;
      p.xz += vec2(cos(a), sin(a))*size*${smoke ? '.8' : '.5'}*rnd.z;
      p.y += life*rise;
      p.xz += drift*life${smoke ? '*life' : ''};
      vec4 mv = modelViewMatrix*vec4(p, 1.);
      float sz = size*${smoke ? '(1. + life*4.)' : '(1. - life*.6)'};
      float on = step(base.w, grow)${smoke ? '' : '*step(grow - .22, base.w)'};
      gl_PointSize = clamp(sz*px/-mv.z, ${smoke ? '0.' : '1.5'}, 260.)*on;
      vLife = life; vA = smoothstep(0., .08, life);
      gl_Position = projectionMatrix*mv;
    }`;
  const fireMat = (smoke) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
    uniforms: { t: { value: 0 }, grow: { value: 0 }, rise: { value: 10 }, size: { value: 5 }, px: { value: 600 }, rate: { value: smoke ? 1 / 90 : 1 / 1.2 }, drift: { value: new THREE.Vector2() }, dry: { value: 1 } },
    vertexShader: fireVS(smoke),
    fragmentShader: smoke
      ? 'varying float vLife; varying float vA; void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; vec3 c = mix(vec3(.2,.17,.15), vec3(.55,.52,.5), vLife); gl_FragColor = vec4(c, vA*(1. - vLife)*.3*smoothstep(.5, .1, d)); }'
      : 'uniform float dry; varying float vLife; varying float vA; void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; vec3 c = mix(vec3(1., .86, .45), vec3(1., .3, .04), smoothstep(0., .6, vLife)); gl_FragColor = vec4(c*(1. - vLife)*smoothstep(.5, .05, d)*vA*(.6 + .4*dry), 1.); }',
  });
  function fireGeometry(perEmitter) {
    const g = new THREE.BufferGeometry(), n = EMIT * perEmitter;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('base', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    const r = new Float32Array(n * 3); for (let i = 0; i < r.length; i++) r[i] = Math.random();
    g.setAttribute('rnd', new THREE.BufferAttribute(r, 3));
    return g;
  }
  const flames = new THREE.Points(fireGeometry(FLAME), fireMat(false)), smoke = new THREE.Points(fireGeometry(SMOKE), fireMat(true));
  const fireLight = new THREE.PointLight(0xff7a2a, 0, 1, 2);
  for (const m of [smoke, flames]) { m.frustumCulled = false; m.visible = false; scene.add(m); }
  smoke.renderOrder = 6; flames.renderOrder = 7; scene.add(fireLight);
  // 피해 면적 경계(실제 반경)를 땅 위에 선으로
  const RING = 160, ring = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(RING * 3), 3)),
    new THREE.LineBasicMaterial({ color: 0xffa040, transparent: true, opacity: .85, depthTest: false }));
  ring.visible = false; ring.renderOrder = 8; ring.frustumCulled = false; scene.add(ring);
  let fireCenter = null, fireKey = '', fireT = 0;
  function pickGround() {
    const t = o.getTerrain(); if (!t) return null;
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    const p = camera.position.clone();
    for (let s = 0; s < 4000; s++) {
      p.addScaledVector(d, 25 * U());
      if (Math.abs(p.x) > t.size / 2 || Math.abs(p.z) > t.size / 2) break;
      const h = t.height(p.x, p.z); if (p.y <= h) return h > o.seaLevel + 1 ? new THREE.Vector3(p.x, h, p.z) : null;
    }
    return null;
  }
  function anyLand() {   // 화면 가운데가 바다면, 카메라에서 가까운 육지
    const t = o.getTerrain(); if (!t) return new THREE.Vector3();
    let best = null, bd = Infinity;
    for (let i = 0; i < 4000; i++) {
      const x = (Math.random() - .5) * t.size * .9, z = (Math.random() - .5) * t.size * .9, h = t.height(x, z);
      if (h < o.seaLevel + 5 * U()) continue;
      const d = Math.hypot(x - camera.position.x, z - camera.position.z); if (d < bd) { bd = d; best = new THREE.Vector3(x, h, z); }
    }
    return best || new THREE.Vector3();
  }
  function placeFire(f) {
    const t = o.getTerrain(); if (!t || !fireCenter) return;
    const r = Math.sqrt(f.area * 1e4 / Math.PI) * U();
    const bases = [flames, smoke].map(m => m.geometry.attributes.base);
    let placed = 0;
    for (let tries = 0; placed < EMIT && tries < EMIT * 30; tries++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * r, x = fireCenter.x + Math.cos(a) * rr, z = fireCenter.z + Math.sin(a) * rr;
      const h = t.height(x, z); if (h <= o.seaLevel + .5) continue;
      const rel = rr / r;
      for (const [b, per] of [[bases[0], FLAME], [bases[1], SMOKE]]) for (let k = 0; k < per; k++) b.setXYZW(placed * per + k, x, h, z, rel);
      placed++;
    }
    for (const [b, per] of [[bases[0], FLAME], [bases[1], SMOKE]]) { for (let i = placed * per; i < EMIT * per; i++) b.setXYZW(i, 0, -1e5, 0, 2); b.needsUpdate = true; }
    const fh = Phys.flameHeight(f.wind, f.dry) * U();
    flames.material.uniforms.rise.value = fh; flames.material.uniforms.size.value = fh * .7;
    smoke.material.uniforms.rise.value = 6 * 90 * U(); smoke.material.uniforms.size.value = 30 * U();
    const rp = ring.geometry.attributes.position;
    for (let i = 0; i < RING; i++) {
      const a = i / RING * Math.PI * 2, x = fireCenter.x + Math.cos(a) * r, z = fireCenter.z + Math.sin(a) * r;
      rp.setXYZ(i, x, Math.max(o.seaLevel, t.height(x, z)) + 3 * U(), z);
    }
    rp.needsUpdate = true;
    fireLight.position.set(fireCenter.x, fireCenter.y + 200 * U(), fireCenter.z); fireLight.distance = r * 3 + 2000 * U();
  }

  /* 지진해일: 지형(수심)에 따라 구간마다 속도 · 높이가 달라지는 파면 (tsunami.js) */
  const tsu = global.DisasterTsunami ? global.DisasterTsunami.create(THREE, { scene, seaMat, getTerrain: o.getTerrain, U, seaLevel: o.seaLevel, setView: (p, t) => o.setView && o.setView(p, t) }) : null;
  const tsLook = { deep: new THREE.Color(), shallow: new THREE.Color(), sky: new THREE.Color(), sunDir: new THREE.Vector3(), sunCol: new THREE.Color(), sunI: 1, fog, px: 600 };
  let tsKey = '';

  /* 지진 흔들림 */
  const shakeOff = new THREE.Vector3(), shakeRot = new THREE.Vector3();
  let quakePh = 0;
  let quakeT = 0;

  function set(t, p = {}, extra) {
    if (!TYPES[t]) t = 'none';
    const def = TYPES[t];
    const prevType = type;
    if (extra !== undefined) data = extra; else if (t !== type) data = null;
    type = t; params = {};
    for (const q of def.params) params[q.key] = clamp(Number.isFinite(+p[q.key]) ? +p[q.key] : q.value, q.min, q.max);
    env = def.env(params);
    if (t === 'wildfire') { if (!fireCenter || p.relocate) fireCenter = pickGround() || anyLand(); }
    if (t === 'quake') quakeT = 0;
    // 해일: 방향 · 파고 · 처오름이 바뀌면 먼바다에서 다시 출발, 배속만 바뀌면 이어서
    if (tsu) {
      if (t !== 'tsunami') { tsu.stop(); tsKey = ''; }
      else { const ts = env.tsunami, key = [ts.height, ts.runup, ts.dir].join('|'); if (key !== tsKey || !tsu.running) tsu.start({ ...ts }); else tsu.setSpeed(ts.speed); tsKey = key; }
    }
    retarget();
    api.onchange && api.onchange();
    return api.get();
  }
  function retarget() {
    Object.assign(goal, ZERO);
    for (const k of Object.keys(ZERO)) if (env[k] != null) goal[k] = env[k];
    if (env.dir != null) { const a = env.dir * Math.PI / 180, w = env.wind || 0; goal.dx = -Math.sin(a) * w; goal.dz = Math.cos(a) * w; } // 북 = -Z, 불어오는 방향의 반대로 흐름
    goal.tint.set(env.tint != null ? env.tint : 0x888888);
    const f = env.fire, key = f ? `${f.area}|${fireCenter && fireCenter.x}|${fireCenter && fireCenter.z}` : '';
    if (f && key !== fireKey) { placeFire(f); if (!fireKey || fireKey.split('|')[0] !== String(f.area)) fireT = 0; }
    fireKey = key;
  }

  function update(dt) {
    if (!base) rebase();
    if (playing) time += dt;
    const k = 1 - Math.exp(-dt * 1.6);
    for (const key of Object.keys(ZERO)) cur[key] = lerp(cur[key], goal[key], k);
    cur.tint.lerp(goal.tint, k);
    const u = skyMat.uniforms, w = seaMat.uniforms, g = cur.gloom, ta = cur.tintAmt;

    // 하늘 · 안개 · 빛
    fog.color.copy(base.fog).lerp(cur.tint, ta).multiplyScalar(1 - g * .45);
    // 실제 시정을 끄면 멀리까지 보이되 분위기만 남김 (원래 안개 거리의 35% 아래로는 안 줄임)
    fog.far = Math.min(base.far, api.realVis ? cur.vis * U() : Math.max(cur.vis * U(), base.far * .35)); fog.near = Math.min(base.near, fog.far * .04);
    u.hor.value.copy(base.hor).lerp(cur.tint, ta).multiplyScalar(1 - g * .45);
    u.zenith.value.copy(base.zenith).lerp(tmp.copy(cur.tint).multiplyScalar(.6), ta * .7).multiplyScalar(1 - g * .55);
    u.cover.value = base.cover + g * .45;
    // 하늘 사진 텍스처는 위의 색(hor · zenith) 쪽으로 섞어서 어둡게 · 물들임
    if (u.skyTint) { u.skyTint.value = lerp(base.skyTint, 1, clamp(Math.max(g * 1.1, ta * .8), 0, .92)); u.skyGain.value = base.skyGain * (1 - g * .5); }
    u.cloudLit.value.copy(base.cloudLit).lerp(tmp.set(0x5a636d), g * .8);
    u.cloudDark.value.copy(base.cloudDark).lerp(tmp.set(0x1a1f26), g * .85);
    sun.intensity = base.sunI * (1 - g * .8) * (1 + cur.heat * .45);
    hemi.intensity = base.hemiI * (1 - g * .45);
    renderer.setClearColor(fog.color);

    // 바다: 거칠기 · 수면 높이 · 흙탕물
    w.seaState.value = Math.max(base.seaState, cur.sea);
    let level = cur.water, mud = cur.mud;
    if (tsu && env.tsunami) {
      tsLook.deep.copy(base.deep).lerp(MUD, .55).lerp(STORM, g * .5); tsLook.shallow.copy(base.shallow).lerp(MUD_SHALLOW, .35);
      tsLook.sky.copy(u.hor.value); tsLook.sunDir.copy(sun.position).normalize(); tsLook.sunCol.copy(sun.color); tsLook.sunI = sun.intensity / Math.max(.2, base.sunI);
      tsLook.px = renderer.domElement.height * .5 * camera.projectionMatrix.elements[5];
      const r = tsu.update(dt, playing, tsLook); level = r.level; mud = Math.max(mud * .3, r.mud);
    }
    sea.position.y = o.seaLevel + level * U();
    if (w.uClarity) w.uClarity.value = lerp(base.clarity, 2.5, clamp(mud + g * .4, 0, 1)); // 흙탕물 · 폭풍이면 바닥이 안 보이게
    w.deep.value.copy(base.deep).lerp(MUD, mud * .85).lerp(STORM, g * .55); w.shallow.value.copy(base.shallow).lerp(MUD_SHALLOW, mud * .85).lerp(STORM, g * .65);

    // 비 · 눈
    const u1 = U(), px = renderer.domElement.height * .5 * camera.projectionMatrix.elements[5];
    for (const [m, amt, max, ms] of [[rain, cur.rain / 120, MAXR, RAIN_MS], [snow, cur.snow / 8, MAXS, SNOW_MS]]) {
      const n = Math.round(clamp(amt, 0, 1.3) / 1.3 * max);
      m.visible = n > 20; if (!m.visible) continue;
      const mu = m.material.uniforms;
      mu.t.value = time; mu.cam.value.copy(camera.position); mu.wind.value.set(cur.dx * u1 * .7, cur.dz * u1 * .7); // 빗방울은 바람(실제 m/s)의 약 70%로 밀림
      mu.box.value = BOX_M * u1; mu.speed.value = ms * u1; mu.sway.value = .5 * u1; mu.flake.value = .03 * u1; mu.px.value = px;
      m.geometry.setDrawRange(0, n * (m === rain ? 2 : 1));
    }

    // 산불
    const f = env.fire;
    flames.visible = smoke.visible = ring.visible = !!f && !!fireCenter;
    if (f && fireCenter) {
      if (playing) fireT += dt;
      // 번지는 과정은 30초 타임랩스로 압축 (실제 걸리는 시간은 추정치 칸)
      const grow = clamp(.08 + fireT / 30, 0, 1.25);
      const a = (f.dir || 0) * Math.PI / 180, wx = -Math.sin(a) * f.wind * u1, wz = Math.cos(a) * f.wind * u1;
      for (const [m, life] of [[flames, .4], [smoke, 90]]) {
        const mu = m.material.uniforms; mu.t.value = time; mu.grow.value = grow; mu.px.value = px; mu.drift.value.set(wx * life, wz * life);
        if (mu.dry) mu.dry.value = f.dry;
      }
      fireLight.intensity = 2.2 * grow * (1 - g * .3);
    } else fireLight.intensity = 0;

    // 지진: 감쇠 스프링으로 흔들어 부드럽고 무작위한 흔들림
    // 실제 지반 변위 ≈ PGA·g/(2πf)² (f ≈ 1.5 Hz, 0.5 g면 약 5 cm) + 서 있는 사람 시선이 흔들리는 각도(≈ PGA×0.03 rad)
    if (env.shake && playing) {
      const dur = clamp(env.shakeSec, 3, 60), cyc = dur + 4; quakeT += dt;
      const ph = (quakeT % cyc) / dur, envl = ph > 1 ? 0 : Math.min(1, ph / .12) * Math.pow(1 - ph, .6);
      const pga = clamp(env.shake, 0, 2) * envl, disp = pga * 9.81 / Math.pow(2 * Math.PI * 1.5, 2) * u1, w = 2 * Math.PI * 1.5;
      quakePh += dt * w * (1 + .3 * Math.sin(time * 1.7));
      shakeOff.set(Math.sin(quakePh) * disp, Math.sin(quakePh * 1.31 + 1) * disp * .5, Math.sin(quakePh * .87 + 2) * disp);
      shakeRot.set(Math.sin(quakePh * 1.1) * pga * .03, Math.sin(quakePh * .9 + 3) * pga * .03, Math.sin(quakePh * 1.4 + 5) * pga * .015);
      api.shaking = envl;
    } else { shakeOff.multiplyScalar(Math.exp(-dt * 8)); shakeRot.multiplyScalar(Math.exp(-dt * 8)); api.shaking = 0; }
    camera.position.add(shakeOff); camera.rotation.x += shakeRot.x; camera.rotation.y += shakeRot.y; camera.rotation.z += shakeRot.z;
  }
  const restore = () => { camera.position.sub(shakeOff); camera.rotation.x -= shakeRot.x; camera.rotation.y -= shakeRot.y; camera.rotation.z -= shakeRot.z; }; // 렌더 뒤 되돌려서 비행 위치는 그대로

  const api = {
    set, update, restore, rebase, U, pickGround,
    get: () => (data == null ? { type, params: { ...params } } : { type, params: { ...params }, data }),
    derive: () => TYPES[type].derive(params),
    get playing() { return playing; }, set playing(v) { playing = !!v; },
    focusTsunami: () => !!(tsu && tsu.focus()),
    relocateFire() { fireCenter = pickGround() || anyLand(); retarget(); return !!fireCenter; },
    terrainChanged() { fireCenter = null; fireKey = ''; if (tsu && type === 'tsunami') tsu.start({ ...env.tsunami }); if (type === 'wildfire') { fireCenter = anyLand(); retarget(); } },
    shaking: 0, onchange: null, realVis: true,
  };
  return api;
}

/* ───── 패널 UI ───── */
function mountUI(root, fx) {
  root.innerHTML = `
    <section><h2>재난 종류 <b id="dxName">—</b></h2><div class="grid dx-types" id="dxTypes"></div><p class="dx-desc" id="dxDesc"></p></section>
    <section><h2>입력값</h2><div id="dxParams"></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="dxPlay">⏸ 일시정지</button><button class="btn" id="dxReset">기본값</button><button class="btn" id="dxFire" hidden>여기를 발화점으로</button><button class="btn" id="dxFocus" hidden>해일 가까이 보기</button></div>
      <div class="toggles"><label title="비 · 눈 · 연기로 실제로 보이는 거리만큼 안개를 칩니다. 끄면 멀리까지 보입니다."><input type="checkbox" id="dxVis" checked> 실제 시정 반영</label></div></section>
    <section><h2>추정치 <b class="dx-tag">간이 공식</b></h2><dl class="dx-out" id="dxOut"></dl>
      <p class="dx-note">수치는 시각화용 간이 공식 추정치이고, 화면 효과는 연출입니다. 실제 피해 계산 결과가 아닙니다.</p></section>
    <section><details><summary>파라미터 JSON (API 연동용)</summary>
      <textarea id="dxJson" spellcheck="false" rows="7"></textarea>
      <div class="row"><button class="btn" id="dxApply">JSON 적용</button><button class="btn" id="dxCopy">복사</button><span class="dx-err" id="dxErr"></span></div></details></section>`;
  const $ = id => root.querySelector('#' + id);
  for (const [k, t] of Object.entries(TYPES)) {
    const b = document.createElement('button'); b.className = 'chip dx-chip'; b.dataset.type = k;
    b.innerHTML = `<i></i><span></span>`; b.firstChild.textContent = t.icon; b.lastChild.textContent = t.name;
    b.addEventListener('click', () => fx.set(k)); $('dxTypes').append(b);
  }
  let built = '';
  function buildParams() {
    const { type, params } = fx.get(), def = TYPES[type], box = $('dxParams');
    if (built !== type) {
      built = type; box.innerHTML = def.params.length ? '' : '<p class="dx-note">조정할 값이 없습니다.</p>';
      for (const q of def.params) {
        const wrap = document.createElement('div'); wrap.className = 'dx-param';
        wrap.innerHTML = `<div class="row"><label></label><span class="dx-num"><input type="number"><em></em></span></div><input type="range">`;
        wrap.querySelector('label').textContent = q.label; wrap.querySelector('em').textContent = q.unit;
        const num = wrap.querySelector('input[type=number]'), rng = wrap.querySelector('input[type=range]');
        for (const el of [num, rng]) Object.assign(el, { min: q.min, max: q.max, step: q.step });
        num.id = 'dx_' + q.key; wrap.querySelector('label').htmlFor = num.id;
        const push = v => { const s = fx.get(); s.params[q.key] = v; fx.set(s.type, s.params, s.data); };
        rng.addEventListener('input', () => { num.value = rng.value; push(+rng.value); });
        num.addEventListener('change', () => { if (num.value === '' || !Number.isFinite(+num.value)) { num.value = fx.get().params[q.key]; return; } push(+num.value); });
        num.addEventListener('keydown', e => { if (e.key === 'Enter') num.blur(); });
        box.append(wrap);
      }
    }
    for (const q of def.params) {
      const num = $('dx_' + q.key), rng = num.closest('.dx-param').querySelector('input[type=range]');
      if (document.activeElement !== num) num.value = params[q.key];
      rng.value = params[q.key];
    }
  }
  function render() {
    const s = fx.get();
    $('dxName').textContent = TYPES[s.type].name; $('dxDesc').textContent = TYPES[s.type].desc;
    root.querySelectorAll('.dx-chip').forEach(b => b.classList.toggle('sel', b.dataset.type === s.type));
    buildParams();
    $('dxOut').innerHTML = '';
    for (const [k, v] of fx.derive()) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; $('dxOut').append(dt, dd); }
    if (!fx.derive().length) $('dxOut').innerHTML = '<dd class="dx-note">재난을 고르면 여기에 추정치가 나옵니다.</dd>';
    if (document.activeElement !== $('dxJson')) $('dxJson').value = JSON.stringify(s, null, 2);
    $('dxFire').hidden = s.type !== 'wildfire'; $('dxFocus').hidden = s.type !== 'tsunami';
    $('dxPlay').textContent = fx.playing ? '⏸ 일시정지' : '▶ 재생';
  }
  fx.onchange = render;
  $('dxVis').addEventListener('change', e => { fx.realVis = e.target.checked; });
  $('dxPlay').addEventListener('click', () => { fx.playing = !fx.playing; render(); });
  $('dxReset').addEventListener('click', () => fx.set(fx.get().type));
  $('dxFire').addEventListener('click', () => fx.relocateFire());
  $('dxFocus').addEventListener('click', () => fx.focusTsunami());
  $('dxApply').addEventListener('click', () => {
    try { const j = JSON.parse($('dxJson').value); if (!TYPES[j.type]) throw new Error('type은 ' + Object.keys(TYPES).join(', ') + ' 중 하나'); fx.set(j.type, j.params || {}, j.data); $('dxErr').textContent = ''; }
    catch (e) { $('dxErr').textContent = e.message; }
  });
  $('dxCopy').addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText($('dxJson').value); });
  render();
}

global.DisasterFX = { TYPES, Phys, create, mountUI };
})(window);
