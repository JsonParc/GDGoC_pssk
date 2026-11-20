/* 바다 (index.html 시점유도 sim · carrier.html 함재기 sim 공통)
   FFT 해양 시뮬레이션: Tessendorf 방식 (Elfouhaily 바람 스펙트럼 → GPU 역FFT → 수직 높이 + 수평(choppy) 변위).
   FFT · 스펙트럼 셰이더는 David Li의 WebGL Ocean (https://github.com/dli/waves, MIT License,
   Copyright (c) 2014 David Li)을 three.js r128 렌더 타깃으로 옮기고, 크기가 다른 3단(cascade)으로 나눠
   너울(수백 m)부터 잔물결(수십 cm)까지 반복 무늬 없이 덮음. 법선 · 거품(야코비안)도 GPU에서 굽고 밉맵으로 멀리서도 매끈하게.
   float 렌더 타깃을 못 쓰는 브라우저(WebGL1 등)는 예전 사인파 합 바다로 그림.
   셰이딩: 하늘 · 거울 반사(carrier), 프레넬, 얕은 물빛 · 해안 거품(수심 텍스처), 흰 물거품, 햇빛 반짝임(Beckmann), 태양 그림자 맵 */
(function(root){
'use strict';

const FS_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

// Stockham FFT 한 단계 (dli/waves SUBTRANSFORM). 복소수 두 개(rg, ba)를 함께 변환
const SUBTRANSFORM = `
  uniform sampler2D u_input; uniform float u_transformSize; uniform float u_subtransformSize;
  varying vec2 vUv;
  vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.y*b.x + a.x*b.y); }
  void main(){
  #ifdef HORIZONTAL
    float index = gl_FragCoord.x - .5;
  #else
    float index = gl_FragCoord.y - .5;
  #endif
    float evenIndex = floor(index/u_subtransformSize)*(u_subtransformSize*.5) + mod(index, u_subtransformSize*.5);
  #ifdef HORIZONTAL
    vec4 even = texture2D(u_input, vec2(evenIndex + .5, gl_FragCoord.y)/u_transformSize);
    vec4 odd = texture2D(u_input, vec2(evenIndex + u_transformSize*.5 + .5, gl_FragCoord.y)/u_transformSize);
  #else
    vec4 even = texture2D(u_input, vec2(gl_FragCoord.x, evenIndex + .5)/u_transformSize);
    vec4 odd = texture2D(u_input, vec2(gl_FragCoord.x, evenIndex + u_transformSize*.5 + .5)/u_transformSize);
  #endif
    float a = -6.28318530718*(index/u_subtransformSize);
    vec2 tw = vec2(cos(a), sin(a));
    gl_FragColor = vec4(even.xy + cmul(tw, odd.xy), even.zw + cmul(tw, odd.zw));
  }`;

// 파수 벡터 (화소 → k, 음의 주파수는 감아 돌림)
const WAVE_VECTOR = `
  uniform float u_resolution; uniform float u_size;
  vec2 waveVector(){
    vec2 c = gl_FragCoord.xy - .5;
    float n = c.x < u_resolution*.5 ? c.x : c.x - u_resolution, m = c.y < u_resolution*.5 ? c.y : c.y - u_resolution;
    return 6.28318530718*vec2(n, m)/u_size;
  }
  float omega(float k){ return sqrt(9.81*k*(1. + (k/370.)*(k/370.))); }`;

/* 초기 스펙트럼 h0(k) (dli/waves INITIAL_SPECTRUM: Elfouhaily 외, 1997 방향 스펙트럼) × 가우스 난수.
   이 단(cascade)이 맡는 파수 [u_kMin, u_kMax)만 남김. rg = h0(k), ba = conj(h0(-k)) */
const INITIAL_SPECTRUM = WAVE_VECTOR + `
  uniform vec2 u_wind; uniform sampler2D u_noise; uniform float u_kMin; uniform float u_kMax; uniform float u_swell;
  float sq(float x){ return x*x; }
  float spectrum(vec2 kv){
    float k = length(kv);
    if (k < u_kMin || k >= u_kMax || k == 0.) return 0.;
    float U10 = max(length(u_wind), .5), Omega = .84, kp = 9.81*sq(Omega/U10);
    float c = omega(k)/k, cp = omega(kp)/kp;
    float Lpm = exp(-1.25*sq(kp/k)), gamma = 1.7, sigma = .08*(1. + 4.*pow(Omega, -3.));
    float Gamma = exp(-sq(sqrt(k/kp) - 1.)/2.*sq(sigma)), Jp = pow(gamma, Gamma);
    float Fp = Lpm*Jp*exp(-Omega/sqrt(10.)*(sqrt(k/kp) - 1.)), alphap = .006*sqrt(Omega), Bl = .5*alphap*cp/c*Fp;
    float z0 = .000037*sq(U10)/9.81*pow(U10/cp, .9), uStar = .41*U10/log(10./z0);
    float alpham = .01*(uStar < .23 ? 1. + log(uStar/.23) : 1. + 3.*log(uStar/.23));
    float Fm = exp(-.25*sq(k/370. - 1.)), Bh = .5*alpham*.23/c*Fm*Lpm;
    float a0 = log(2.)/4., am = .13*uStar/.23, Delta = tanh(a0 + 4.*pow(c/cp, 2.5) + am*pow(.23/c, 2.5));
    float cosPhi = dot(normalize(u_wind), kv/k);
    // 바람 반대쪽으로 가는 물결은 거의 없게 (그대로면 앞뒤 대칭이라 물결이 서로 엇갈려 출렁임만 남음)
    float dir = (1. + Delta*(2.*cosPhi*cosPhi - 1.))*(cosPhi < 0. ? .12 : 1.);
    float S = (1./6.28318530718)*pow(k, -4.)*(Bl + Bh)*dir;
    // 먼 바다에서 오는 너울: 바람과 상관없이 긴 파장을 조금 더 (해안 근처에서도 바다가 '살아' 보이게)
    S *= 1. + u_swell*exp(-sq(log(k/.035))*2.);
    float dk = 6.28318530718/u_size;
    return sqrt(S/2.)*dk;
  }
  void main(){
    vec2 kv = waveVector();
    vec2 c = gl_FragCoord.xy - .5, cm = mod(u_resolution - c, u_resolution);
    vec4 g = texture2D(u_noise, (c + .5)/u_resolution), gm = texture2D(u_noise, (cm + .5)/u_resolution);
    vec2 h0 = g.xy*spectrum(kv)*.70710678, h0m = gm.xy*spectrum(-kv)*.70710678;
    gl_FragColor = vec4(h0, h0m.x, -h0m.y);
  }`;

// 시간 t의 스펙트럼: h = h0 e^{iωt} + conj(h0(-k)) e^{-iωt}, 수평 변위 = -i k/|k| h (choppy). 출력 (Dx + i h, Dz)
const SPECTRUM = WAVE_VECTOR + `
  uniform sampler2D u_h0; uniform float u_time; uniform float u_choppiness;
  vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.y*b.x + a.x*b.y); }
  vec2 mulI(vec2 z){ return vec2(-z.y, z.x); }
  void main(){
    vec2 kv = waveVector(); float k = length(kv);
    vec4 s = texture2D(u_h0, gl_FragCoord.xy/u_resolution);
    float ph = mod(omega(k)*u_time, 6.28318530718);
    vec2 e = vec2(cos(ph), sin(ph));
    vec2 h = cmul(s.xy, e) + cmul(s.zw, vec2(e.x, -e.y));
    if (k == 0.) { gl_FragColor = vec4(0.); return; }
    vec2 hX = -mulI(h*(kv.x/k))*u_choppiness, hZ = -mulI(h*(kv.y/k))*u_choppiness;
    gl_FragColor = vec4(hX + mulI(h), hZ);
  }`;

/* 변위 → 기울기 · 야코비안. rg = 높이 기울기 (∂h/∂x, ∂h/∂z, 변위된 면 기준), b = 야코비안 J (<1 이면 물마루가 접힘 → 거품), a = 높이 */
const NORMALS = `
  uniform sampler2D u_disp; uniform float u_resolution; uniform float u_size;
  varying vec2 vUv;
  void main(){
    float t = 1./u_resolution, w = u_size/u_resolution;
    vec3 c = texture2D(u_disp, vUv).rgb;
    vec3 r = texture2D(u_disp, vUv + vec2(t, 0.)).rgb, l = texture2D(u_disp, vUv - vec2(t, 0.)).rgb;
    vec3 u = texture2D(u_disp, vUv + vec2(0., t)).rgb, d = texture2D(u_disp, vUv - vec2(0., t)).rgb;
    vec3 tx = vec3(2.*w, 0., 0.) + r - l, tz = vec3(0., 0., 2.*w) + u - d;
    vec3 n = cross(tz, tx);
    float jxx = 1. + (r.x - l.x)/(2.*w), jzz = 1. + (u.z - d.z)/(2.*w), jxz = (u.x - d.x)/(2.*w), jzx = (r.z - l.z)/(2.*w);
    gl_FragColor = vec4(-n.x/max(n.y, 1e-3), -n.z/max(n.y, 1e-3), jxx*jzz - jxz*jzx, c.y);
  }`;

class OceanFFT {
  /* sizes: 단마다 한 변 길이 (m). 서로 나누어떨어지지 않게 골라 무늬가 겹쳐 반복되지 않음 */
  constructor(THREE, renderer, opt = {}){
    this.THREE = THREE; this.renderer = renderer;
    const N = this.N = opt.resolution || 256;
    this.sizes = opt.sizes || [613, 97.3, 17.9];
    const caps = renderer.capabilities, ext = renderer.extensions;
    this.ok = !!(caps.isWebGL2 && ext.get('EXT_color_buffer_float'));
    if (!this.ok) return;
    const rt = (type, filter, repeat, mip) => {
      const r = new THREE.WebGLRenderTarget(N, N, { type, format: THREE.RGBAFormat, minFilter: mip ? THREE.LinearMipmapLinearFilter : filter, magFilter: filter,
        depthBuffer: false, stencilBuffer: false, wrapS: repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping, wrapT: repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping });
      r.texture.generateMipmaps = !!mip; return r;
    };
    const F = THREE.FloatType, H = THREE.HalfFloatType, NE = THREE.NearestFilter, LI = THREE.LinearFilter;
    this.ping = rt(F, NE); this.pong = rt(F, NE); this.spec = rt(F, NE);
    this.cascades = this.sizes.map((size, i) => {
      // 단마다 따로 뽑은 가우스 난수 (Box-Muller, 4채널)
      const g = new Float32Array(N*N*4);
      for (let j = 0; j < g.length; j += 2) { const u = Math.max(1e-7, Math.random()), v = Math.random(), r = Math.sqrt(-2*Math.log(u));
        g[j] = r*Math.cos(6.2831853*v); g[j + 1] = r*Math.sin(6.2831853*v); }
      const noise = new THREE.DataTexture(g, N, N, THREE.RGBAFormat, THREE.FloatType); noise.minFilter = noise.magFilter = NE; noise.needsUpdate = true;
      return { size, noise, h0: rt(F, NE), disp: rt(H, LI, true), norm: rt(H, LI, true, true), slopeVar: 0 };
    });
    // 단 경계: 한 단이 자기 격자로 충분히 그릴 수 있는 파수까지 맡고, 그보다 짧은 물결은 다음 단으로
    this.cascades.forEach((c, i) => { const next = this.cascades[i + 1];
      c.kMin = i === 0 ? 0 : this.cascades[i - 1].kMax; c.kMax = next ? 6.2832/next.size*6 : 1e9; });
    const mat = (frag, uniforms, defines) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, defines: defines || {}, depthTest: false, depthWrite: false });
    const u = (o) => { const r = {}; for (const k in o) r[k] = { value: o[k] }; return r; };
    this.mInit = mat(INITIAL_SPECTRUM, u({ u_resolution: N, u_size: 1, u_wind: new THREE.Vector2(10, 4), u_noise: null, u_kMin: 0, u_kMax: 1, u_swell: 0 }));
    this.mSpec = mat(SPECTRUM, u({ u_resolution: N, u_size: 1, u_h0: null, u_time: 0, u_choppiness: 1 }));
    this.mH = mat(SUBTRANSFORM, u({ u_input: null, u_transformSize: N, u_subtransformSize: 2 }), { HORIZONTAL: '' });
    this.mV = mat(SUBTRANSFORM, u({ u_input: null, u_transformSize: N, u_subtransformSize: 2 }));
    this.mNorm = mat(NORMALS, u({ u_disp: null, u_resolution: N, u_size: 1 }));
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mInit); this.quad.frustumCulled = false;
    this.fsScene = new THREE.Scene(); this.fsScene.add(this.quad);
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.wind = new THREE.Vector2(); this.choppiness = 1; this.dirty = true;
  }
  pass(material, target){ this.quad.material = material; this.renderer.setRenderTarget(target); this.renderer.render(this.fsScene, this.fsCam); }
  /* 바람 (m/s, x · z), 먼 너울 비중. 바뀌면 다음 update에서 초기 스펙트럼을 다시 구움 (위상은 그대로라 끊기지 않음) */
  setWind(x, z, swell = 0){
    if (Math.abs(x - this.wind.x) + Math.abs(z - this.wind.y) + Math.abs(swell - (this.swell || 0)) < 1e-3) return;
    this.wind.set(x, z); this.swell = swell; this.dirty = true;
    // 단마다 기울기 분산 (밉맵으로 뭉개진 만큼 반짝임을 넓히는 데 씀): CPU에서 같은 스펙트럼을 적분
    for (const c of this.cascades) c.slopeVar = this.slopeVariance(c);
  }
  slopeVariance(c){
    const N = 64, dk = 6.2832/c.size*(this.N/N); let sum = 0;
    const U = Math.max(.5, this.wind.length()), Om = .84, kp = 9.81*(Om/U)**2, om = k => Math.sqrt(9.81*k*(1 + (k/370)**2));
    for (let i = -N/2; i < N/2; i++) for (let j = -N/2; j < N/2; j++) {
      const k = Math.hypot(i, j)*dk; if (!k || k < c.kMin || k >= c.kMax) continue;
      const cc = om(k)/k, cp = om(kp)/kp, Lpm = Math.exp(-1.25*(kp/k)**2), sig = .08*(1 + 4*Om**-3);
      const Jp = 1.7**Math.exp(-((Math.sqrt(k/kp) - 1)**2)/2*sig*sig), Fp = Lpm*Jp*Math.exp(-Om/Math.sqrt(10)*(Math.sqrt(k/kp) - 1));
      const Bl = .5*.006*Math.sqrt(Om)*cp/cc*Fp, z0 = .000037*U*U/9.81*(U/cp)**.9, us = .41*U/Math.log(10/z0);
      const am = .01*(us < .23 ? 1 + Math.log(us/.23) : 1 + 3*Math.log(us/.23)), Bh = .5*am*.23/cc*Math.exp(-.25*(k/370 - 1)**2)*Lpm;
      sum += k*k*(1/6.2832)*k**-4*(Bl + Bh)*dk*dk;
    }
    return sum;
  }
  update(time){
    if (!this.ok) return;
    const r = this.renderer, prevRT = r.getRenderTarget(), prevAC = r.autoClear, prevXR = r.xr && r.xr.enabled, prevSh = r.shadowMap.autoUpdate, prevNeed = r.shadowMap.needsUpdate;
    r.autoClear = false; if (r.xr) r.xr.enabled = false; r.shadowMap.autoUpdate = false;
    const N = this.N, iters = Math.log2(N)*2;
    for (const c of this.cascades) {
      if (this.dirty) {
        const u = this.mInit.uniforms; u.u_size.value = c.size; u.u_wind.value.copy(this.wind); u.u_noise.value = c.noise;
        u.u_kMin.value = c.kMin; u.u_kMax.value = c.kMax; u.u_swell.value = this.swell || 0;
        this.pass(this.mInit, c.h0);
      }
      const s = this.mSpec.uniforms; s.u_size.value = c.size; s.u_h0.value = c.h0.texture; s.u_time.value = time; s.u_choppiness.value = this.choppiness;
      this.pass(this.mSpec, this.spec);
      let src = this.spec;
      for (let i = 0; i < iters; i++) {
        const m = i < iters/2 ? this.mH : this.mV, dst = i === iters - 1 ? c.disp : (i % 2 === 0 ? this.ping : this.pong);
        m.uniforms.u_input.value = src.texture; m.uniforms.u_subtransformSize.value = Math.pow(2, (i % (iters/2)) + 1);
        this.pass(m, dst); src = dst;
      }
      const n = this.mNorm.uniforms; n.u_disp.value = c.disp.texture; n.u_size.value = c.size;
      this.pass(this.mNorm, c.norm);
    }
    this.dirty = false;
    r.setRenderTarget(prevRT); r.autoClear = prevAC; if (r.xr) r.xr.enabled = prevXR; r.shadowMap.autoUpdate = prevSh; r.shadowMap.needsUpdate = prevNeed; // 이번 프레임 그림자 갱신 요청을 FFT 계산이 써 버리지 않게
  }
}

/* 바다 셰이더 (예전 carrier.html 바다 + FFT). uOcOn = 0이면 예전 사인파 40개 합 그대로 */
const SEA_WAVES = `
  uniform float t; uniform vec2 wind; uniform float seaState;
  uniform float uOcOn; uniform vec3 uOcL; uniform float uOcAmp;
  uniform sampler2D uOcD0; uniform sampler2D uOcD1; uniform sampler2D uOcD2;
  uniform sampler2D uOcN0; uniform sampler2D uOcN1; uniform sampler2D uOcN2; uniform vec3 uOcVar;
  uniform sampler2D uDepth; uniform float uDepthOn; uniform vec3 uBox;
  const int NW = 40;
  // 단 1 · 2는 표본 좌표를 살짝 돌려 읽음 (+12° · -9°): 세 단의 반복 주기가 같은 축으로 겹쳐 격자 무늬가 보이지 않게
  const mat2 OR1 = mat2(.9781, .2079, -.2079, .9781), OR2 = mat2(.9877, -.1564, .1564, .9877);
  float h1(float n){ return fract(sin(n*127.1 + 3.7)*43758.5453); }
  void wave(int i, out vec2 dir, out float L, out float A, out float ph0){
    float fi = float(i);
    float ang = atan(wind.y, wind.x) + (h1(fi + 1.3) + h1(fi + 9.1) - 1.)*1.75;
    dir = vec2(cos(ang), sin(ang));
    L = 420.*pow(.845, fi)*(.8 + .4*h1(fi + 7.7));
    A = L*(L > 120. ? .0016 : L > 12. ? .0032 : .0065)*(1. + 1.6*seaState);
    ph0 = h1(fi + 3.1)*6.2832;
  }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3. - 2.*f);
    float a = fract(sin(dot(i, vec2(127.1, 311.7)))*43758.5453), b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7)))*43758.5453);
    float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7)))*43758.5453), d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7)))*43758.5453);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
  float fbm3(vec2 p){ return .55*vn(p) + .3*vn(p*2.07 + 5.3) + .15*vn(p*4.13 + 1.7); }
  // 수심 0(땅) ~ 1(15 m 이상). 지형 데이터 밖은 깊은 바다
  float seaDepth(vec2 p){
    if (uDepthOn < .5) return 1.;
    vec2 duv = (p - uBox.xy)/uBox.z;
    if (duv.x <= 0. || duv.y <= 0. || duv.x >= 1. || duv.y >= 1.) return 1.;
    vec2 eg = min(duv, 1. - duv);
    return mix(1., texture2D(uDepth, duv).r, smoothstep(0., .06, min(eg.x, eg.y)));
  }`;

const VERT = `
  varying vec3 wp; varying vec2 vGrid; varying float vHgt; varying float vSkirt;
  uniform float uCell; uniform float uHalf; attribute float aSkirt;
  #include <fog_pars_vertex>
  void main(){
    vec4 w = modelMatrix*vec4(position, 1.);
    // 단 바깥 가장자리 20%는 한 단 성긴 격자점으로 옮겨(geomorph) 바깥 단과 이음매가 딱 맞게
    float mk = clamp((max(abs(position.x), abs(position.z))/uHalf - .75)/.2, 0., 1.);
    w.xz = mix(w.xz, floor(w.xz/(2.*uCell) + .5)*2.*uCell, mk);
    vGrid = w.xz;
    float r = length(w.xz - cameraPosition.xz);
    vec3 disp = vec3(0.);
    if (uOcOn > .5) {
      // 격자 간격이 물결 길이의 1/10 ~ 1/5보다 크면 그 단은 높이로 그리지 않음 (계단 방지, 법선은 픽셀 셰이더에서 그대로)
      float sp = mix(uCell, 2.*uCell, mk);
      disp += texture2D(uOcD0, w.xz/uOcL.x).rgb*(1. - smoothstep(uOcL.x/10., uOcL.x/5., sp));
      vec3 d1 = texture2D(uOcD1, OR1*w.xz/uOcL.y).rgb, d2 = texture2D(uOcD2, OR2*w.xz/uOcL.z).rgb;
      d1.xz = d1.xz*OR1; d2.xz = d2.xz*OR2; // 돌린 좌표의 수평 변위를 월드 방향으로 되돌림
      disp += d1*(1. - smoothstep(uOcL.y/10., uOcL.y/5., sp));
      disp += d2*(1. - smoothstep(uOcL.z/10., uOcL.z/5., sp));
      // 물가로 갈수록 물결이 낮아짐 (바닥에 걸려 부서지는 곳은 픽셀 셰이더의 해안 거품)
      disp *= uOcAmp*(.25 + .75*smoothstep(.0, .45, seaDepth(w.xz)));
    } else {
      float h = 0.;
      for (int i = 0; i < 4; i++) { vec2 d; float L, A, ph0; wave(i, d, L, A, ph0); float k = 6.2832/L; h += A*sin(dot(d, w.xz)*k - sqrt(9.8*k)*t + ph0); }
      disp.y = h*(1. - smoothstep(1500., 4000., r));
    }
    w.xyz += disp; vHgt = disp.y;
    w.y -= aSkirt*(1.5 + .5*uCell); vSkirt = aSkirt;
    wp = w.xyz; vec4 mvPosition = viewMatrix*w; gl_Position = projectionMatrix*mvPosition;
  #include <fog_vertex>
  }`;

const FRAG = `
  uniform vec3 deep; uniform vec3 shallow; uniform vec3 zenith; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; uniform float glint;
  uniform sampler2D uRefl; uniform mat4 uTexMat; uniform float uReflOn;
  // 점광원 (폭발 섬광 · 미사일 · 엔진 화염 · 가로등): xyz = 월드 위치, w = 닿는 거리 (m) / 색 × 세기 (화면 색). 개수 uPLN
  #define PL_MAX 8
  uniform vec4 uPL[PL_MAX]; uniform vec3 uPLC[PL_MAX]; uniform float uPLN;
  uniform sampler2D uShMap; uniform mat4 uShMat; uniform float uShOn; uniform vec2 uShSize; uniform float uShDark; uniform float uFogLinear;
  varying vec3 wp; varying vec2 vGrid; varying float vHgt; varying float vSkirt;
  // 물 투명도: uSeeThru = 0(불투명, 예전) ~ 1, uClarity = 1 m당 빛이 줄어드는 정도 (작을수록 맑아서 깊은 바닥까지 보임)
  // 출력은 미리 곱한 알파 (ONE, ONE_MINUS_SRC_ALPHA): 반사 · 반짝임 · 거품은 그대로 더하고, 물빛만 바닥이 비치는 만큼 덜어냄
  uniform float uSeeThru; uniform float uClarity; uniform float uCaps; uniform float uMinDepth;
  uniform vec3 uInner; // 한 단 촘촘한 격자가 덮는 사각형 (중심 xz, 반 변). 그 안은 그리지 않음
  // 게임 원본 물 질감 (terrain/textures/water, texture_map/Texture2D/bubble/wave): 다 읽기 전엔 uTexOn = 0 (예전 그대로)
  uniform sampler2D uWake; uniform vec3 uWakeBox; uniform float uWakeOn; // 항적 농도 (waterFX): 중심 xz · 한 변
  uniform float uTexOn; uniform sampler2D uFoamT; uniform sampler2D uFoam2; uniform sampler2D uBump; uniform sampler2D uSpark; uniform sampler2D uCaus;
  #include <packing>
  #include <fog_pars_fragment>
  // 태양 그림자 맵 (DirectionalLight.shadow): 섬 · 함선 · 나무 그림자가 물에 드리움. 3×3 PCF
  float sunShadow(vec3 p){
    if (uShOn < .5) return 1.;
    vec4 sc = uShMat*vec4(p, 1.); vec3 c = sc.xyz/sc.w;
    if (c.x <= 0. || c.y <= 0. || c.x >= 1. || c.y >= 1. || c.z >= 1.) return 1.;
    vec2 tx = 1./uShSize; float s = 0.;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
      s += step(c.z - .0006, unpackRGBAToDepth(texture2D(uShMap, c.xy + vec2(float(i), float(j))*tx)));
    vec2 eg = min(c.xy, 1. - c.xy);
    return mix(1., s/9., smoothstep(0., .04, min(eg.x, eg.y)));
  }
  // 줄무늬 거품 결: 거품 사진(FoamMask)을 흐름 방향 d로 st배 길게 늘여 읽음 (점 무늬 → 결을 따라 늘어진 줄기). 평균 ≈ 0.62
  float streakTex(vec2 q, vec2 d, float st){
    vec2 s = vec2(dot(q, d)/st, dot(q, vec2(-d.y, d.x)));
    return texture2D(uFoamT, s/9.).r*.6 + texture2D(uFoamT, OR1*s/3.4 + .37).r*.4;
  }
  void main(){
    vec2 p = vGrid;
    if (uInner.z > 0. && abs(p.x - uInner.x) < uInner.z && abs(p.y - uInner.y) < uInner.z) discard;
    float fw = max(length(fwidth(p)), .001), dist = length(cameraPosition - wp);
    float gust = .75 + .5*smoothstep(.3, .75, fbm3(p/2600. + wind*t*.003));
    vec2 slope = vec2(0.); float h = vHgt, lost = 0., fold = 1., foldL = 1., fold2 = 0., fold1 = 0., hz1 = 0., hz2 = 0.;
    if (uOcOn > .5) {
      vec4 n0 = texture2D(uOcN0, p/uOcL.x), n1 = texture2D(uOcN1, OR1*p/uOcL.y), n2 = texture2D(uOcN2, OR2*p/uOcL.z);
      n1.xy = n1.xy*OR1; n2.xy = n2.xy*OR2;
      float dep = seaDepth(p), damp = uOcAmp*(.25 + .75*smoothstep(.0, .45, dep));
      slope = (n0.xy + n1.xy + n2.xy*(.85 + .3*gust))*damp;
      // 밉맵으로 뭉개진 잔물결 기울기 → 햇빛 반사를 넓게 (멀리서 반짝임 · 계단 없이 윤슬 띠가 퍼짐)
      // 실제 바다 기울기 분산 (Cox-Munk: 0.003 + 0.00512 × 풍속) 중 화면 한 픽셀보다 작아 안 그려진 몫. 단마다 픽셀 크기 대비로 덜어냄
      // (작게 잡으면 먼 바다 햇빛 반사가 픽셀마다 켜졌다 꺼지며 지글거림)
      float cm = .003 + .00512*(7. + 12.*seaState);
      vec3 texel = uOcL/256.;
      lost = cm*(.25*smoothstep(.3, 3., fw/texel.x) + .3*smoothstep(.3, 3., fw/texel.y) + .45*smoothstep(.3, 3., fw/texel.z))*damp*damp;      // 야코비안: 1보다 작을수록 물마루가 접혀 부서지는 곳
      fold = min(min(n0.z, n1.z), 1.) - (1. - n2.z)*.6;
      foldL = min(n0.z, n1.z); // 큰 물결 두 단만: 부서진 뒤 거품이 남는 넓은 자리
      // 짧은 물결 단 (17.9 m) 가파름 ÷ 그 단의 평균 기울기 (바다 거칠기와 상관없이 가장 가파른 몇 % = 잔 물마루 끝)
      fold2 = length(n2.xy)/sqrt(max(uOcVar.z, 1e-6));
      fold1 = length(n1.xy)/sqrt(max(uOcVar.y, 1e-6)); // 중간 물결 단 (97 m): 몇 m 길이 흰 끝 (멀리서도 보임)
      // 물마루 높이 ÷ 그 단의 대략 높이 표준편차 (기울기 표준편차 ÷ 대표 파수: 중간 단 ≈ 2π/25 m, 짧은 단 ≈ 2π/5 m)
      hz1 = texture2D(uOcD1, OR1*p/uOcL.y).g*.25/sqrt(max(uOcVar.y, 1e-6));
      hz2 = texture2D(uOcD2, OR2*p/uOcL.z).g*1.25/sqrt(max(uOcVar.z, 1e-6));
    } else {
      for (int i = 0; i < NW; i++) {
        vec2 d; float L, A, ph0; wave(i, d, L, A, ph0);
        float k = 6.2832/L, a = A*(i > 4 ? gust : 1.);
        float f = smoothstep(2.5*fw, 9.*fw, L);
        float ph = dot(d, p)*k - sqrt(9.8*k)*t + ph0;
        slope += d*(a*k*cos(ph))*f; h += a*sin(ph)*f;
        lost += (1. - f)*.5*(a*k)*(a*k);
      }
    }
    // 가까운 수면 잔물결 (water_bump 법선 맵 두 겹, 서로 다른 크기 · 방향으로 흐름). 멀면 꺼짐 (지글거림 방지)
    // (법선 맵 기울기는 표준편차 ~0.1로 작아서 크게 키움)
    float nb = uTexOn*(1. - smoothstep(60., 700., dist));
    if (nb > 0.) {
      vec2 b1 = texture2D(uBump, p/7. + wind*t*.03).xy*2. - 1., b2 = texture2D(uBump, OR1*p/2.6 - vec2(wind.y, -wind.x)*t*.045).xy*2. - 1.;
      slope += (b1 + b2*.6)*.7*nb*(.7 + .6*seaState);
    }
    vec3 N = normalize(vec3(-slope.x, 1., -slope.y));
    vec3 V = normalize(cameraPosition - wp);
    float NV = max(dot(N, V), .001);
    float fres = .02 + .98*pow(1. - NV, 5.);
    vec3 R = reflect(-V, N); R.y = abs(R.y);
    vec3 skyRef = mix(hor, zenith, pow(R.y, .45));
    if (uReflOn > .5) {
      vec4 tc = uTexMat*vec4(wp.x, 0., wp.z, 1.);
      vec2 ruv = tc.xy/tc.w + slope*vec2(.18, .06)*(1. - smoothstep(300., 5000., dist));
      // 거울 반사는 하늘빛과 반쯤만 섞음 (물결 · 거품이 있는 실제 바다처럼 섬 · 함선 반사가 너무 또렷하지 않게)
      skyRef = mix(skyRef, texture2D(uRefl, clamp(ruv, .002, .998)).rgb, .6);
    }
    skyRef = mix(skyRef, sunCol, pow(max(dot(R, sunDir), 0.), 5.)*.3*min(glow, 2.5));
    float shade = sunShadow(wp);
    // 물빛: 깊은 곳은 짙은 남색. 물마루 · 햇빛을 받는 물결 옆면은 빛이 물속으로 들어가 퍼진 밝은 청록 (해를 등진 쪽에서 봐도 물결 높낮이가 보이게)
    float graze = 1. - smoothstep(.15, .7, V.y);
    float hk = uOcOn > .5 ? clamp(h/(.6 + 1.6*seaState), -1., 1.) : clamp(h*.25, -1., 1.);
    vec3 body = mix(deep, shallow, clamp(graze*.6 + .35*hk + .15, 0., 1.)*(1. - smoothstep(800., 6000., dist)*.6));
    float sss = pow(max(dot(V, -sunDir + N*.6), 0.), 4.)*max(hk + .3, 0.)*(1. - smoothstep(600., 4000., dist));
    body += shallow*vec3(.6, 1., .9)*sss*.55*shade*clamp(sunDir.y*3., 0., 1.);
    body *= .55 + .45*max(dot(N, sunDir), 0.)*mix(1., shade, .8) + .25*N.y;
    float dep = seaDepth(p);
    float shoal = (1. - smoothstep(.02, .5, dep))*smoothstep(0., .02, dep);
    // 바닥까지 빛이 들어갔다 나오는 비율 (수심 = dep × 15 m, 비스듬히 볼수록 물속 길이가 길어짐). 15 m 이상은 바닥 없음 (불투명)
    // uMinDepth: 해저판이 그보다 얕지 않은 맵 (실제 게임 메시 맵은 높이장 해저판을 수면 몇 m 아래로 내림)
    float Tb = uSeeThru*exp(-max(dep*15., uMinDepth)*uClarity*(1. + 1./max(V.y, .12)))*(1. - smoothstep(.85, .99, dep));
    // 치마(단 사이 틈 메움)는 비치는 물에서 겹쳐 보이므로 버림
    if (vSkirt > .001 && Tb > .02) discard;
    body = mix(body, shallow*1.7 + vec3(.02, .09, .08), shoal*.55*(1. - .6*uSeeThru));
    // 얕은 물 바닥의 빛무늬 (Caustics 두 장을 엇갈려 흘리고 작은 쪽만: 그물 무늬가 일렁임). 위에서 내려다볼 때 (프레넬 반사가 약할 때)만
    float ck = uTexOn*(1. - smoothstep(.04, .45, dep))*smoothstep(0., .03, dep)*(1. - smoothstep(150., 1800., dist));
    if (ck > 0.) {
      float cs = min(texture2D(uCaus, p/6.5 + vec2(t*.031, t*.017)).r, texture2D(uCaus, p/7.3 - vec2(t*.022, -t*.027) + .37).r);
      body += shallow*vec3(.8, 1., .95)*cs*1.6*ck*(1. - fres)*shade*clamp(sunDir.y*3., 0., 1.);
    }
    float refl = min(fres*1.1, .75)*(1. - shoal*.3), tb = Tb*(1. - refl);
    vec3 c = body*(1. - refl - tb) + skyRef*refl;
    float sAlpha = 1. - tb;
    // 비치는 바닥 위 빛무늬 (바닥에 닿는 빛이라 투명한 만큼 더함)
    if (tb > .01 && uTexOn > .5) {
      float cs2 = min(texture2D(uCaus, p/6.5 + vec2(t*.031, t*.017)).r, texture2D(uCaus, p/7.3 - vec2(t*.022, -t*.027) + .37).r);
      c += sunCol*cs2*.5*tb*shade*clamp(sunDir.y*3., 0., 1.)*(1. - smoothstep(150., 2500., dist));
    }
    vec3 foamCol = mix(hor, vec3(1.), .6)*(.5 + .55*clamp(sunDir.y*2., 0., 1.))*mix(1., shade, .5);
    // 물가 거품 띠: 수심 ~0.15 ~ 0.6 m만 (넓으면 완만한 모래톱 전체가 흰 띠가 됨)
    float shore = smoothstep(.0, .01, dep)*(1. - smoothstep(.015, .04, dep));
    // 거품 무늬: 게임 거품 사진(FoamMask)을 두 크기로 흘림 (잡음보다 실제 거품 결 · 구멍 · 줄기가 보임). 값 분포를 예전 잡음과 비슷하게 펴서 문턱은 그대로
    float fT = .5 + (texture2D(uFoamT, p/13. + wind*t*.02).r*.6 + texture2D(uFoamT, OR2*p/4.7 - wind*t*.04).r*.4 - .64)*1.15;
    float sT = .5 + (texture2D(uFoam2, p/8. + wind*t*.06).g - .7)*1.2;
    float surf = shore*smoothstep(.4, .7, mix(fbm3(p/4. + wind*t*.06), sT, uTexOn) + .35*sin(t*1.4 - dep*160.));
    float wcN = mix(fbm3(p/9. + wind*t*.02)*.55 + fbm3(p/2.2 - wind*t*.05)*.45, fT, uTexOn);
    // 거품 자체 명암 (사진의 밝은 거품 · 사이로 비치는 물)
    foamCol *= mix(1., .7 + .5*clamp(fT, 0., 1.), uTexOn);
    float wc;
    if (uOcOn > .5) {
      // 흰 물마루: FFT 물결이 실제로 접혀 부서지는 곳(야코비안 < 1)에만 → 물결 모양 · 움직임을 따라 생기고 사라짐.
      // 거품 사진은 밝기 결로만 섞음 (문턱으로 자르면 점점이 뚫린 스티커처럼 보임). uCaps = 맵별로 문턱을 낮춤 (잔잔한 맵에도 조금)
      float s2 = clamp(seaState + .12*uCaps, 0., 1.);
      float core = smoothstep(.9 - .3*s2, .5 - .3*s2, fold + .12*(wcN - .5));
      wc = core*(.3 + .6*s2)*mix(.55, 1., smoothstep(.2, .75, wcN));
      // 잔 물마루 흰 끝 (바람 물결): 바다 전체에 촘촘히 흩어진 작은 흰 거품. 짧은 물결 단이 살짝 접히는 물마루 선을 따라 생겨 물결과 함께 움직이고,
      // 거품 사진으로 부드럽게 끊어 작은 조각 · 줄기로. 큰 얼룩(돌풍)마다 양이 다름. 멀어서 선이 화소보다 가늘면 평균 밝기로 (지글거림 방지)
      {
        float amt = clamp(.45 + .5*uCaps + .4*seaState, 0., 1.2)*mix(.45, 1.15, smoothstep(.3, .75, fbm3(OR2*p/170. + wind*t*.008)));
        float g4 = .4*(gust - .75);
        // 작은 끝 (짧은 물결 단, 0.5 ~ 2 m): 가까이서 촘촘한 흰 점 · 줄기
        // 물마루 = 높고 가파른 곳 (높이 + 가파름을 함께): 물결 윤곽(마루 선)을 따라 흰 줄이 생김
        float tipS = uOcVar.z > 0. ? smoothstep(1.5 - .3*s2, 2.2 - .3*s2, hz2 + .45*(fold2 - 1.) + g4) : 0.;
        float flS = uTexOn > .5 ? texture2D(uFoamT, OR2*p/3.1 + wind*t*.05).r : fbm3(p/1.6 + wind*t*.1);
        float capS = mix(tipS*mix(.25, 1.2, smoothstep(.3, .9, flS)), .06, smoothstep(.25, 1.1, fw));
        // 큰 끝 (중간 물결 단, 3 ~ 10 m): 바람 물결 마루가 부서진 흰 조각. 멀리까지 보임
        float tipB = uOcVar.y > 0. ? smoothstep(1.4 - .3*s2, 2.1 - .3*s2, hz1 + .5*(fold1 - 1.) + g4) : 0.;
        float flB = uTexOn > .5 ? texture2D(uFoamT, OR1*p/9.5 + wind*t*.03).r : fbm3(p/5. + wind*t*.05);
        float capB = mix(tipB*mix(.3, 1.2, smoothstep(.3, .9, flB)), .05, smoothstep(1.5, 6., fw));
        wc = max(wc, max(capS, capB)*amt*.4);
      }
      // 부서진 물마루 뒤에 남아 바람결로 길게 늘어진 줄무늬 거품 (큰 물결 두 단이 접힌 넓은 자리에서만, 물결 기울기 · 느린 소용돌이로 휘어짐)
    } else {
      float crest = clamp(h/(.5 + .8*seaState), -1., 1.);
      float patchy = smoothstep(.42, .7, fbm3(p/60. + wind*t*.01));
      wc = seaState*patchy*smoothstep(.66, .8, wcN*.85 + crest*.12 + (gust - .75)*.25);
    }
    wc *= (1. - shoal)*(1. - smoothstep(1200., 9000., dist)*.7);
    // 함선 항적 거품: 농도가 진할수록 문턱이 낮아져 거품 결(FoamMask)이 넓게 덮이고, 옅어지면 줄기 · 레이스만 남음. 오래된 거품은 조금 투명
    if (uWakeOn > .5) {
      vec2 wuv = vec2((p.x - uWakeBox.x)/uWakeBox.z + .5, (uWakeBox.y - p.y)/uWakeBox.z + .5);
      if (wuv.x > 0. && wuv.y > 0. && wuv.x < 1. && wuv.y < 1.) {
        vec4 wt = texture2D(uWake, wuv);
        // 판 하나 농도 ≈ 0.5 × 가우스라 키워서 씀 (선미 바로 뒤 겹친 곳 ≈ 1)
        float wk = wt.r*1.8, wAge = clamp(wt.g/max(wt.r, 1e-3), 0., 1.);
        // 큰 얼룩 잡음으로 농도를 흔들어 띠 경계가 곧은 선이 아니라 들쭉날쭉 (안쪽은 농도가 넘쳐 그대로 꽉 참)
        wk *= .55 + .9*fbm3(p/35. + vec2(t*.01, 0.));
        vec2 eg = min(wuv, 1. - wuv); wk *= smoothstep(0., .05, min(eg.x, eg.y));
        if (wk > .01) {
          // 거품 사진을 월드 좌표에 그대로 크게 씌움 (한 장 ≈ 140 m · 60 m). 물결 기울기 · 소용돌이 · 흐름 방향으로 좌표를 비틀면
          // 가까이서 지글거리고 대리석처럼 휘어 보여서 비틀지 않음. 아주 느리게만 흘러 살아 있는 느낌
          vec2 sq = p + wind*t*.4;
          float tex = uTexOn > .5 ? texture2D(uFoamT, sq/140.).r*.65 + texture2D(uFoamT, OR1*sq/60. + .37).r*.35 : fbm3(sq/30.);
          tex = smoothstep(.28, .8, tex); // 명암 대비를 키움 (밉맵으로 회색이 된 사진에서도 골 · 줄기가 보이게)
          // 덮는 정도: 사진이 (1 - 농도)보다 밝은 곳만 거품. 가장 진한 곳도 어두운 골은 열려 물이 비침,
          // 오래될수록 밝은 줄기 · 레이스만 남고 사라짐
          // V자 안 · 선미 물살 안쪽(농도 진한 곳)은 거품 사진이 거의 통째로 덮임. 농도가 옅은 가장자리 · 오래된 꼬리에서만
          // 사진의 밝은 결만 남아 경계가 들쭉날쭉하게 풀림
          float cov = clamp(wk*1.05, 0., .8)*(1. - .25*wAge);
          float wf = clamp((tex - (1. - cov))*3., 0., 1.)*smoothstep(.03, .2, wk);
          // 거품 밝기 = 사진 명암 (덮인 안쪽도 평평한 흰 판이 아니라 휘저은 결 · 줄기가 보임)
          c = mix(c, foamCol*(.42 + .8*tex), wf*.85); sAlpha = mix(sAlpha, 1., wf*.85); wf = 0.;
          // 거품 밑 공기 섞인 물: 아주 옅게만 (뿌연 판처럼 보이지 않게)
          float churn = clamp(wk, 0., 1.)*(1. - .8*wAge)*.1;
          c = mix(c, mix(shallow*1.4 + vec3(.05, .1, .1), foamCol, .45), churn); sAlpha = mix(sAlpha, 1., churn);
          wc = max(wc, wf);
        }
      }
    }
    float foamK = clamp(surf*.8 + wc*.85, 0., 1.);
    c = mix(c, foamCol, foamK); sAlpha = mix(sAlpha, 1., foamK);
    float r2 = lost + .0012*gust + .0004;
    vec3 H = normalize(sunDir + V); float NH = max(dot(N, H), .001), NL = max(dot(N, sunDir), 0.);
    float tan2 = (1. - NH*NH)/(NH*NH);
    float D = exp(-tan2/r2)/(3.1416*r2*NH*NH*NH*NH);
    float FH = .02 + .98*pow(1. - max(dot(V, H), 0.), 5.);
    c += sunCol*min(D*FH*NL/(4.*NV), 3.)*1.1*glint*shade;
    c += sunCol*pow(max(dot(R, sunDir), 0.), 40.)*.22*glint*clamp(sunDir.y*4., 0., 1.)*shade;
    // 햇빛 길의 반짝이는 점 (SparkNoise 두 장을 엇갈려 흘려 곱함 → 점이 켜졌다 꺼짐). 가까운 물만
    float sk = uTexOn*(1. - smoothstep(60., 900., dist));
    if (sk > 0.) {
      float sp = texture2D(uSpark, p/2.7 + wind*t*.11).r*texture2D(uSpark, OR1*p/1.9 - wind*t*.14 + .5).r;
      c += sunCol*smoothstep(.25, .7, sp)*pow(max(dot(R, sunDir), 0.), 6.)*2.2*glint*sk*shade*clamp(sunDir.y*4., 0., 1.);
    }
    // 그림자 속 물은 하늘빛 반사만 남고 조금 어두움
    c *= mix(1., 1. - uShDark, 1. - shade);
    // 점광원: 물결 법선으로 반사한 반짝임 (해보다 거친 면 → 물결 따라 세로로 늘어진 빛기둥) + 가까운 수면을 비추는 빛
    float r2p = r2 + .006;
    for (int i = 0; i < PL_MAX; i++) {
      if (float(i) >= uPLN) break;
      vec3 Lv = uPL[i].xyz - wp; float ld = length(Lv); if (Lv.y <= 0.) continue;
      vec3 Ld = Lv/ld; float att = 1./(1. + ld*ld/(uPL[i].w*uPL[i].w));
      vec3 Hp = normalize(Ld + V); float NHp = max(dot(N, Hp), .001), NLp = max(dot(N, Ld), 0.);
      float t2 = (1. - NHp*NHp)/(NHp*NHp);
      float Dp = exp(-t2/r2p)/(3.1416*r2p*NHp*NHp*NHp*NHp);
      float Fp = .02 + .98*pow(1. - max(dot(V, Hp), 0.), 5.);
      c += uPLC[i]*att*(min(Dp*Fp*NLp/(4.*NV), 4.)*.7 + NLp*(1. - fres)*.05 + wc*NLp*.2);
    }
    // 하이라이트 어깨 (톤매핑과 같은 역할, 화면 색 기준): 0.78 위는 1로 부드럽게 눌러 해 반사가 넓은 흰 판으로 포화되지 않고 물결 결이 남음.
    // 채널마다 따로라 햇빛 색(노을이면 주황)이 살아 있음
    c = mix(c, .78 + .22*(1. - exp(-(c - .78)/.22)), step(.78, c));
      gl_FragColor = vec4(c, 1.);
    gl_FragColor.a = sAlpha;
  // 안개: 바다는 화면 색(sRGB)으로 바로 그리므로, 렌더러가 선형 색 공간이면 안개 색(선형)을 화면 색으로 바꿔 섞음
  #ifdef USE_FOG
    float fogD = -(viewMatrix*vec4(wp, 1.)).z;
    #ifdef FOG_EXP2
      float fogK = 1. - exp(-fogDensity*fogDensity*fogD*fogD);
    #else
      float fogK = smoothstep(fogNear, fogFar, fogD);
    #endif
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogLinear > .5 ? pow(max(fogColor, 0.), vec3(1./2.2)) : fogColor, fogK);
    gl_FragColor.a = mix(gl_FragColor.a, 1., fogK);
  #endif
  }`;

/* opts: { zenith, horizon, sunDir, sunCol (THREE.Color/Vector3 — 하늘 셰이더와 같은 객체를 넘기면 함께 바뀜), deep, shallow } */
/* 물 질감 (한 번만 읽고 모든 바다 재질이 같은 uniform 객체를 씀). 경로는 페이지 기준 */
const WATER_BASE = 'data/textures/water/';
/* foam · foam2 = FoamMask_v1 · v2 (거품 결), bump = water_bump, spark = SparkNoise, caus = Caustics (바다 셰이더)
   drops = WaterSplashes (4×4 물방울, 물보라 입자),
   jet = BigSplashJetTextureSheet (8×8 물기둥 애니메이션), ring = BigSplashWakeTextureSheet (8×8 수면 고리 애니메이션) — 미사일 착수 */
const WATER = { on: { value: 0 }, foam: { value: null }, foam2: { value: null }, bump: { value: null }, spark: { value: null }, caus: { value: null },
  drops: { value: null }, jet: { value: null }, ring: { value: null }, started: false };
function loadWater(THREE){
  if (WATER.started) return; WATER.started = true;
  const L = new THREE.TextureLoader();
  const list = [['foam', 'foam.jpg', 1], ['foam2', 'foam2.jpg', 1], ['bump', 'bump.jpg', 1], ['spark', 'spark.jpg', 1], ['caus', 'caustics.jpg', 1],
    ['drops', 'splash_drops.png', 0], ['jet', 'splash_jet.png', 0], ['ring', 'splash_ring.png', 0]];
  let left = list.length;
  list.forEach(([k, f, rep]) => {
    const tex = L.load(WATER_BASE + f, () => { if (!--left) WATER.on.value = 1; }, undefined, () => console.warn('물 질감을 읽지 못함: ' + f));
    // 반복 무늬는 반복 · 이방성, 스프라이트 시트는 칸 경계 밖을 읽지 않게 가장자리 고정
    if (rep) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4; } else { tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; }
    WATER[k].value = tex;
  });
}
/* 물 효과 (두 시뮬 공통): 항적 거품 · 물보라 입자 재질, 미사일 착수 물기둥 · 수면 고리.
   색 = 바다와 같은 수평선 색 · 해 높이로 밝기 (이 지형 · 밤 맵에서 거품만 하얗게 뜨지 않게). seaMat의 uniform 객체를 그대로 공유 */
const FX_LIT = `vec3 fxLit(){ return mix(hor, vec3(1.), .6)*(.5 + .55*clamp(sunDir.y*2., 0., 1.)); }`;
// 8×8 시트의 f번째 칸 (왼쪽 위부터 가로로). uv는 칸 안 0 ~ 1
const FX_CELL = `vec2 fxCell(float f, vec2 uv, float n){ return (vec2(mod(f, n), n - 1. - floor(f/n)) + clamp(uv, .004, .996))/n; }`;
function waterFX(THREE, scene, seaMat, renderer){
  loadWater(THREE);
  const su = seaMat.uniforms;
  /* 항적 거품: 판을 화면에 그대로 찍으면 덩어리가 줄지어 보이므로,
     ① 판(InstancedMesh, instanceColor r = 불투명도, g = 나이 0 ~ 1)은 카메라 주변 수면을 위에서 본 "항적 농도" 텍스처에 부드러운 농도로만 더하고 (테두리 없음, 겹치면 진해짐)
     ② 바다 셰이더가 그 농도를 읽어 FoamMask 사진 결을 문턱으로 잘라 거품을 그림 → 물결과 같은 면에 이어진 줄기 · 레이스 거품,
        진한 곳(함수 · 선미 바로 뒤)은 하얗게 덮이고 옅어질수록 갈라지며 사라짐.
     R = 농도 합, G = 농도 × 나이 (평균 나이 = G / R) */
  const WAKE_N = 1024, WAKE_S = 2400; // 텍스처 한 변 화소 · 덮는 범위 (m) → 한 화소 ≈ 2.3 m
  const wakeMaterial = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `varying vec2 vUv; varying vec3 vC;
      void main(){ vUv = uv; vC = vec3(1., 0., 0.);
      #ifdef USE_INSTANCING_COLOR
        vC = instanceColor;
      #endif
        gl_Position = projectionMatrix*viewMatrix*modelMatrix*instanceMatrix*vec4(position, 1.); }`,
    fragmentShader: `varying vec2 vUv; varying vec3 vC;
      void main(){ float r = length(vUv - .5)*2.; float g = exp(-r*r*2.6)*(1. - smoothstep(.75, 1., r)); float d = vC.r*g; gl_FragColor = vec4(d, d*vC.g, 0., 1.); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  let wakeRT = null;
  const wakeScene = new THREE.Scene(), wakeCam = new THREE.OrthographicCamera(-WAKE_S/2, WAKE_S/2, WAKE_S/2, -WAKE_S/2, -2000, 2000);
  wakeCam.up.set(0, 0, -1);
  if (renderer) {
    // 겹친 농도가 1을 넘어도 잘리지 않게 반정밀 실수 (못 쓰면 8비트: 1에서 잘림)
    const half = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
    wakeRT = new THREE.WebGLRenderTarget(WAKE_N, WAKE_N, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
    wakeRT.texture.generateMipmaps = false;
    su.uWake.value = wakeRT.texture;
  }
  // 카메라 주변을 덮도록 한 화소 단위로 붙여 옮김 (흔들림 방지) 후 농도를 그림
  function renderWake(camera){
    if (!wakeRT) return;
    const px = WAKE_S/WAKE_N, cx = Math.round(camera.position.x/px)*px, cz = Math.round(camera.position.z/px)*px;
    wakeCam.position.set(cx, 500, cz); wakeCam.lookAt(cx, 0, cz); wakeCam.updateMatrixWorld();
    const prev = renderer.getRenderTarget(), ac = renderer.autoClear, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    const sh = renderer.shadowMap.autoUpdate, need = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(wakeRT); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
    renderer.render(wakeScene, wakeCam);
    renderer.setRenderTarget(prev); renderer.setClearColor(cc, ca); renderer.autoClear = ac;
    renderer.shadowMap.autoUpdate = sh; renderer.shadowMap.needsUpdate = need;
    su.uWakeBox.value.set(cx, cz, WAKE_S); su.uWakeOn.value = 1;
  }
  /* 항적 띠 (ribbon): 둥근 판을 띄엄띄엄 찍으면 구슬 꿰듯 동그라미가 줄지어 보이므로, 지나온 자리를 하나로 이어진 띠로 그림.
     표본(배가 일정 거리 갈 때마다 하나) = 출발점 · 옆으로 흘러가는 속도 · 폭 · 진하기 · 수명. 나이에 따라 바깥으로 밀려나고 넓어지고 옅어짐
     → 뱃머리 두 갈래가 V자로 벌어지고, 선미 띠는 뒤로 갈수록 넓게 퍼짐. 농도 텍스처에 그려서 바다 셰이더가 덩어리 전체에 거품 결을 씌움 */
  const RIB_MAX = 240;
  const ribbonMaterial = new THREE.ShaderMaterial({
    vertexShader: `attribute float aSide; attribute float aA; attribute float aAge; varying float vS; varying float vA; varying float vAge;
      void main(){ vS = aSide; vA = aA; vAge = aAge; gl_Position = projectionMatrix*viewMatrix*vec4(position, 1.); }`,
    // 가로 단면: 가운데 진하고 가장자리로 부드럽게 (띠 두 개가 겹치면 이어진 한 덩어리)
    fragmentShader: `varying float vS; varying float vA; varying float vAge;
      // 단면: 안쪽은 평평하게 꽉 차고 가장자리 35%에서만 부드럽게 줄어듦 (V자 삼각형 안이 통째로 거품, 경계만 자연스럽게)
      // (가장자리 넓게 줄어듦 → 바다 셰이더가 옅은 곳을 거품 사진 결로 잘라 경계가 직선이 아니라 들쭉날쭉하게 풀림)
      void main(){ float d = vA*(1. - smoothstep(.3, 1., abs(vS))); gl_FragColor = vec4(d, d*vAge, 0., 1.); }`,
    // 띠 삼각형 감김 방향이 진행 방향에 따라 바뀌므로 양면 (위에서 내려다보는 농도 카메라에 뒷면이 걸려 안 그려지지 않게).
    // 더하지 않고 큰 값만 남김: 넓은 띠가 휠 때 단면끼리 겹쳐 접힌 삼각형이 두 번 더해져 번개 모양으로 밝아지는 것 · 띠끼리 겹쳐 하얗게 포화되는 것 방지
    side: THREE.DoubleSide, transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation });
  const ribIndex = []; for (let i = 0; i < RIB_MAX - 1; i++) { const a = i*2; ribIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const ribSide = new Float32Array(RIB_MAX*2); for (let i = 0; i < RIB_MAX; i++) { ribSide[i*2] = -1; ribSide[i*2 + 1] = 1; }
  function Ribbon(){
    const g = new THREE.BufferGeometry(), pos = new Float32Array(RIB_MAX*6), al = new Float32Array(RIB_MAX*2), ag = new Float32Array(RIB_MAX*2);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSide', new THREE.BufferAttribute(ribSide, 1));
    g.setAttribute('aA', new THREE.BufferAttribute(al, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAge', new THREE.BufferAttribute(ag, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(ribIndex); g.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(g, ribbonMaterial); mesh.frustumCulled = false;
    const S = []; // 표본: 오래된 것 → 새것
    const C = []; // 이번 프레임 중심점 (x, z, 폭, 진하기, 나이 비율)
    // 옆 흐름은 damp(1/s)로 줄어듦: 뱃머리 두 갈래는 거의 안 줄어 켈빈 각(약 19°)으로 계속 벌어짐
    const at = (s, a, out) => { const dp = s.damp ?? .4, k = dp > 1e-4 ? (1 - Math.exp(-dp*a))/dp : a; out.x = s.ox + s.vx*k; out.z = s.oz + s.vz*k;
      // fin = 처음 진해지는 데 걸리는 시간 (선미 띠만: 시작 끝이 칼로 자른 듯 보이지 않게). 뱃머리 · 선체 띠는 바로 진함
      // 폭 = 처음 폭 + 나이에 비례해 넓어짐(wl, V자 안쪽 채움) + 퍼짐(wg × √나이)
      out.w = s.w0 + (s.wl || 0)*a + s.wg*Math.sqrt(a); const u = a/s.life;
      // 수명 대부분은 진하게 유지하다 끝에서 사라짐 (V자 삼각형이 끝까지 꽉 찬 채로, 꼬리에서만 풀림)
      out.a = s.a0*(s.fin ? Math.min(1, .25 + a/s.fin) : 1)*Math.max(0, 1 - Math.pow(Math.min(u, 1), s.hold || 2)); out.u = u; return out; }; // hold: 클수록 끝까지 진하다 꼬리에서 사라짐
    return {
      mesh, S,
      push(s){ if (S.length >= RIB_MAX - 1) S.shift(); s.age = 0; S.push(s); },
      clear(){ S.length = 0; g.setDrawRange(0, 0); },
      // head = 지금 배 위치의 표본 (아직 넣지 않은 맨 앞 끝을 이어 그림 → 띠 끝이 배에 붙어 있음)
      step(dt, head){
        for (const s of S) s.age += dt;
        while (S.length && S[0].age >= S[0].life) S.shift();
        const list = head ? S.concat([Object.assign(head, { age: 0 })]) : S, n = list.length;
        if (n < 2) { g.setDrawRange(0, 0); return; }
        for (let i = 0; i < n; i++) C[i] = at(list[i], list[i].age, C[i] || {});
        for (let i = 0; i < n; i++) {
          // 단면 방향 = 표본을 만들 때 배의 옆 방향 (경로 접선으로 구하면 선회할 때 넓은 띠의 단면이 휘둘려 뾰족한 가시가 생김)
          const sm = list[i]; let tx, tz;
          if (sm.nx !== undefined) { tx = sm.nz; tz = -sm.nx; }
          else { const p0 = C[Math.max(0, i - 1)], p1 = C[Math.min(n - 1, i + 1)]; tx = p1.x - p0.x; tz = p1.z - p0.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl; }
          const c = C[i], hw = c.w*.5, j = i*6;
          pos[j] = c.x - tz*hw; pos[j + 1] = 0; pos[j + 2] = c.z + tx*hw;
          pos[j + 3] = c.x + tz*hw; pos[j + 4] = 0; pos[j + 5] = c.z - tx*hw;
          al[i*2] = al[i*2 + 1] = c.a; ag[i*2] = ag[i*2 + 1] = Math.min(1, c.u);
        }
        g.attributes.position.needsUpdate = g.attributes.aA.needsUpdate = g.attributes.aAge.needsUpdate = true;
        g.setDrawRange(0, (n - 1)*6);
      },
    };
  }
  /* 함선 항적 (두 시뮬 공통): 매 프레임 shipWake(배 객체, 위치, 방위, 길이, 반폭, 기준 속도, dt, 물보라 함수)를 부름.
     띠 = 뱃머리 좌우 두 갈래(켈빈 V자) · 선체 옆 흰 물 좌우 · 선미 물살. 물보라 함수 spray(x, y, z, vx, vy, vz, 크기, 수명)로 뱃머리 · 선미 물방울 */
  const ships = new Map();
  function shipWake(key, p, heading, len, half, ref, dt, spray, seaY = 0){
    if (!(dt > 0)) return;
    let w = ships.get(key);
    if (!w) {
      w = { x: p.x, z: p.z, acc: 0, spray: 0, prop: 0, edge: 0, rib: [Ribbon(), Ribbon(), Ribbon(), Ribbon(), Ribbon(), Ribbon()], head: [] };
      for (const r of w.rib) (wakeRT ? wakeScene : scene).add(r.mesh);
      ships.set(key, w);
    }
    w.seen = 0;
    const vx = (p.x - w.x)/dt, vz = (p.z - w.z)/dt; w.x = p.x; w.z = p.z;
    const fx = -Math.sin(heading), fz = -Math.cos(heading), rx = -fz, rz = fx;
    const speed = vx*fx + vz*fz, sp = Math.abs(speed);
    // 순간이동(재배치)만 띠를 끊음. 함선이 미사일만큼(초속 수 km) 빨라도 항적이 사라지지 않게 문턱을 크게 (재배치는 한 프레임에 수 km 이상 뜀)
    if (Math.hypot(vx, vz) > 20000) { for (const r of w.rib) r.clear(); w.head.length = 0; return; }
    if (sp < .6) { w.head.length = 0; return; }                                                     // 정지: 띠는 그대로 사라져 감
    const k = Math.min(1.5, sp/ref), kk = Math.min(1, k), dir = Math.sign(speed);
    const ss = Math.sqrt(Math.min(8, half/12)), sd = Math.min(ss, 1.6);
    const bx = p.x + fx*dir*len*.5, bz = p.z + fz*dir*len*.5, sx = p.x - fx*dir*len*.5, sz = p.z - fz*dir*len*.5;
    // 띠 표본 (출발점 · 옆 흐름 · 폭 · 진하기 · 수명). 0 · 1 = 뱃머리 좌우, 2 · 3 = 선체 옆 좌우, 4 = 선미, 5 = V자 안쪽 채움
    // 수명은 초가 아니라 "배 길이 몇 개만큼 뒤까지 보이나"로 (빠른 배가 수 km짜리 항적을 남겨 기름띠처럼 보이지 않게). T = 배 길이만큼 가는 시간
    const T = len/Math.max(sp, 3), lim = (v, a, b) => Math.max(a, Math.min(b, v));
    // 세기는 속력에 비례해 0부터 (느리게 움직이거나 후진할 때 배 주변에 거품이 쌓여 기름띠처럼 퍼지지 않게)
    const kf = Math.min(1, k*1.6);
    const mk = () => [-1, 1].map(side => ({ ox: bx - fx*dir*len*.04 + rx*side*half*.6, oz: bz - fz*dir*len*.04 + rz*side*half*.6,
        vx: rx*side*sp*.34, vz: rz*side*sp*.34, damp: .03, w0: half*.35, wg: half*.3, a0: .55*kf, life: lim(.22*T, .1, 12) })) // 뱃머리 갈래: V자 테두리로 길게 남기지 않고 함수 뾰족한 부분 길이(배 길이 약 1/5)만큼만
      .concat([-1, 1].map(side => ({ ox: p.x + rx*side*half*1.05, oz: p.z + rz*side*half*1.05,
        vx: rx*side*sp*.06, vz: rz*side*sp*.06, w0: half*.45, wg: half*.12, a0: 0, life: lim(.5*T, .2, 8) }))) // 선체 옆 띠: 안 씀 (V자 채움이 덮음, 겹치면 계단 모양 경계)
      // 선미 띠: 안 씀 (뒤로 길게 "-"자로 남는 줄). V자 안쪽 채움이 선미 뒤를 덮음
      .concat([{ ox: sx, oz: sz, vx: 0, vz: 0, w0: half*1.7, wg: half*.8, a0: 0, life: lim(2.5*T, .4, 90), fin: Math.min(.3, .3*T) }])
      // V자 안쪽 채움: 뱃머리에서 출발해 두 갈래와 같은 각도로 넓어짐 (폭 = 0.68 × 속력 × 나이) → 두 갈래 사이가 거품으로 참
      .concat([{ ox: bx - fx*dir*len*.04, oz: bz - fz*dir*len*.04, vx: 0, vz: 0, w0: half*1.2, wl: sp*.68, wg: 0, a0: .9*kf, life: lim(1.3*T, .3, 60), hold: 2.2 }]); // 삼각형 = 배 길이 약 1.1개 뒤까지 (밑변 ≈ 0.75 × 배 길이)
    const mkN = () => mk().map(o => Object.assign(o, { nx: rx, nz: rz })); // 단면 방향 = 지금 배의 옆 방향
    w.head = mkN();
    w.acc += sp*dt;
    if (w.acc >= Math.max(2, half*.2)) { w.acc = 0; const s = mkN(); s.forEach((x, i) => w.rib[i].push(x)); }
    if (!spray) return;
    // 뱃머리 물보라: 함수가 물을 가르는 자리에서 작은 물방울이 옆 · 위로 튐. 흰 덩어리(구름)가 되지 않게 양 · 크기 · 수명을 작게 —
    // 뱃머리의 흰 물은 띠(거품)가 맡고, 물보라는 그 위에 흩날리는 물방울만
    // 물방울이 배 속도를 물려받는 정도: 아주 빠른 배(초속 수 km)에서 물방울이 함께 날아가지 않게 앞으로 최대 25 m/s
    const cf = Math.min(.9, 25/Math.max(sp, 1)), cp = Math.min(.3, 8/Math.max(sp, 1));
    w.spray += 45*k*dt;
    for (; w.spray >= 1; w.spray--) {
      const side = Math.random() < .5 ? -1 : 1, back = Math.pow(Math.random(), 1.6)*.1*len;
      const lat = half*(.3 + .7*back/(.1*len) + Math.random()*.1), out = (2 + Math.random()*4)*k*ss;
      spray(bx - fx*dir*back + rx*side*lat, seaY + .4 + Math.random()*ss, bz - fz*dir*back + rz*side*lat,
        vx*cf + rx*side*out, (2.5 + Math.random()*5)*kk*sd, vz*cf + rz*side*out, (.8 + Math.random()*1.4)*sd, .7 + Math.random()*.7);
    }
    // 거품 경계 물보라: V자 두 갈래 바깥 가장자리를 따라 작은 물방울이 튀어 띠 경계가 매끈한 선으로 보이지 않게 (배 가까운 쪽일수록 많이)
    w.edge += 70*k*dt;
    for (; w.edge >= 1; w.edge--) {
      const side = Math.random() < .5 ? -1 : 1, d = Math.pow(Math.random(), 1.5)*len*.2, lat = half*.6 + .34*d + half*.25*Math.random();
      spray(bx - fx*dir*(len*.04 + d) + rx*side*lat, seaY + .3, bz - fz*dir*(len*.04 + d) + rz*side*lat,
        rx*side*(1 + Math.random()*2)*ss, (1 + Math.random()*2.5)*kk*sd, rz*side*(1 + Math.random()*2)*ss, (.7 + Math.random()*1.1)*sd, .5 + Math.random()*.6);
    }
    // 선미 물살: 프로펠러가 휘저어 낮게 튀는 작은 물방울
    w.prop += 15*k*dt;
    for (; w.prop >= 1; w.prop--) {
      const lat = (Math.random() - .5)*half*1.2, back = Math.random()*half;
      spray(sx - fx*dir*back + rx*lat, seaY + .3, sz - fz*dir*back + rz*lat,
        vx*cp + (Math.random() - .5)*3*ss, (1 + Math.random()*2)*kk*sd, vz*cp + (Math.random() - .5)*3*ss, (.8 + Math.random()*1.2)*sd, .6 + Math.random()*.5);
    }
  }
  function stepShips(dt){
    for (const [key, w] of ships) {
      w.seen = (w.seen || 0) + dt;
      w.rib.forEach((r, i) => r.step(dt, w.seen < .5 && w.head[i] ? Object.assign({}, w.head[i]) : null));
      // 한동안 안 불린 배(침몰 · 사라짐)는 띠가 다 사라진 뒤 정리
      if (w.seen > 1 && w.rib.every(r => !r.S.length)) { for (const r of w.rib) { r.mesh.parent && r.mesh.parent.remove(r.mesh); r.mesh.geometry.dispose(); } ships.delete(key); }
    }
  }
  /* 물보라 입자 (Points): 색 속성 r = 불투명도, g = 무작위 값 → WaterSplashes 16칸 중 하나. scale = 화면 높이 / tan(시야각/2) (페이지가 매 프레임) */
  const sprayMaterial = new THREE.ShaderMaterial({
    uniforms: { uOn: WATER.on, uDrops: WATER.drops, scale: { value: 1 }, hor: su.hor, sunDir: su.sunDir },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float scale; uniform float uOn;
      void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position, 1.); gl_PointSize = max(1.5, size*(uOn > .5 ? 1.7 : 1.)*scale/-mv.z); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uOn; uniform sampler2D uDrops; uniform vec3 hor; uniform vec3 sunDir; varying vec3 vC;
      ${FX_LIT} ${FX_CELL}
      void main(){
        vec2 pc = vec2(gl_PointCoord.x, 1. - gl_PointCoord.y);
        float t = uOn > .5 ? texture2D(uDrops, fxCell(floor(vC.g*15.99), pc, 4.)).a : 1. - smoothstep(.2, .5, length(pc - .5));
        gl_FragColor = vec4(fxLit()*1.05, clamp(vC.r*t*1.7, 0., 1.));
      }`,
    transparent: true, depthWrite: false });
  /* 미사일 착수: 물기둥 (세운 판, 카메라 쪽으로 돌림) 세 개 + 수면 고리 하나. 시트 64칸을 수명 동안 재생 (이웃 칸끼리 섞어 부드럽게) */
  const SHEET_FS = `uniform sampler2D map; uniform float frame; uniform float alpha; uniform float uOn; uniform vec3 hor; uniform vec3 sunDir; varying vec2 vUv;
    ${FX_LIT} ${FX_CELL}
    void main(){
      if (uOn < .5) discard;
      float f = floor(frame);
      vec4 c = mix(texture2D(map, fxCell(f, vUv, 8.)), texture2D(map, fxCell(min(f + 1., 63.), vUv, 8.)), fract(frame));
      gl_FragColor = vec4(c.rgb*fxLit()*1.3, c.a*alpha);
    }`;
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.); }';
  const jetGeo = new THREE.PlaneGeometry(1, 1).translate(0, .5, 0), ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI/2);
  const live = [];
  const make = (geo, tex, renderOrder) => {
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: { map: tex, frame: { value: 0 }, alpha: { value: 1 }, uOn: WATER.on, hor: su.hor, sunDir: su.sunDir },
      vertexShader: VS, fragmentShader: SHEET_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = renderOrder; m.frustumCulled = false; scene.add(m); return m;
  };
  const api = {
    wakeMaterial, sprayMaterial, wakeTarget: () => wakeRT, // 점검용
    // 항적 거품 판 메시를 농도 장면에 넣음 (화면 장면이 아니라). renderer가 없으면 예전처럼 화면에
    addWake(mesh){ mesh.material = wakeMaterial; (wakeRT ? wakeScene : scene).add(mesh); },
    /* pos: 착수 지점, size: 물기둥 높이 (m), seaY: 수면 높이 */
    splash(pos, size = 50, seaY = 0){
      const ring = make(ringGeo, WATER.ring, 2); ring.position.set(pos.x, seaY + .6, pos.z); ring.rotation.y = Math.random()*Math.PI*2;
      // 재생 시간: 고리 1.6 s · 물기둥 1.1 s (64칸 → 약 40 ~ 58 fps)
      live.push({ m: ring, age: 0, life: 1.6, s0: size*1.2, s1: size*2.6, jet: false });
      for (let i = 0; i < 3; i++) {
        const j = make(jetGeo, WATER.jet, 4), a = Math.random()*Math.PI*2, off = i ? size*.18 : 0, k = i ? .55 + Math.random()*.2 : 1;
        j.position.set(pos.x + Math.cos(a)*off, seaY, pos.z + Math.sin(a)*off);
        live.push({ m: j, age: -i*.05, life: 1.1*Math.sqrt(k), s0: size*k, s1: size*k, jet: true, flip: Math.random() < .5 });
      }
    },
    shipWake,
    update(dt, camera){
      stepShips(dt || 0); // 항적 띠를 먼저 새로 만든 뒤 농도 텍스처에 그림
      renderWake(camera);
      for (let i = live.length - 1; i >= 0; i--) {
        const e = live[i]; e.age += dt; const u = Math.max(0, e.age)/e.life, m = e.m, U = m.material.uniforms;
        if (u >= 1) { scene.remove(m); m.material.dispose(); live.splice(i, 1); continue; }
        m.visible = e.age >= 0;
        U.frame.value = Math.min(63.999, u*64); U.alpha.value = 1 - Math.max(0, (u - .8)/.2);
        const s = e.s0 + (e.s1 - e.s0)*Math.sqrt(u);
        if (e.jet) { m.scale.set(s*(e.flip ? -1 : 1), s, 1); m.rotation.y = Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z); }
        else m.scale.set(s, 1, s);
      }
    },
  };
  return api;
}
function material(THREE, o){
  loadWater(THREE);
  const m = new THREE.ShaderMaterial({
    fog: true, side: THREE.DoubleSide,
    extensions: { derivatives: true },
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      t: { value: 0 }, wind: { value: new THREE.Vector2(.94, .34).normalize() },
      deep: { value: new THREE.Color(o.deep ?? 0x0f3a63) }, shallow: { value: new THREE.Color(o.shallow ?? 0x1f6672) },
      zenith: { value: o.zenith }, hor: { value: o.horizon }, sunDir: { value: o.sunDir }, sunCol: { value: o.sunCol }, glow: { value: 1 }, glint: { value: 1 },
      seaState: { value: .15 }, uRefl: { value: null }, uTexMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 },
      uDepth: { value: null }, uDepthOn: { value: 0 }, uBox: { value: new THREE.Vector3(0, 0, 1) },
      uOcOn: { value: 0 }, uOcL: { value: new THREE.Vector3(1, 1, 1) }, uOcAmp: { value: 1 }, uOcVar: { value: new THREE.Vector3() },
      uOcD0: { value: null }, uOcD1: { value: null }, uOcD2: { value: null }, uOcN0: { value: null }, uOcN1: { value: null }, uOcN2: { value: null },
      uCell: { value: GRID.cell }, uHalf: { value: GRID.cell*GRID.m }, uInner: { value: new THREE.Vector3(0, 0, 0) },
      uFogLinear: { value: 0 }, uShMap: { value: null }, uShMat: { value: new THREE.Matrix4() }, uShOn: { value: 0 }, uShSize: { value: new THREE.Vector2(1, 1) }, uShDark: { value: .35 },
      uWake: { value: null }, uWakeBox: { value: new THREE.Vector3(0, 0, 1) }, uWakeOn: { value: 0 } }]),    vertexShader: SEA_WAVES + VERT,
    fragmentShader: SEA_WAVES + FRAG,
  });
  // 점광원 배열 (UniformsUtils.merge가 배열을 복제하지 않게 따로 붙임)
  m.uniforms.uPL = { value: Array.from({ length: PL_MAX }, () => new THREE.Vector4(0, -1e5, 0, 1)) };
  m.uniforms.uPLC = { value: Array.from({ length: PL_MAX }, () => new THREE.Vector3()) };
  m.uniforms.uPLN = { value: 0 };
  // 투명한 물 (uSeeThru): 기본은 불투명. 켜는 페이지는 transparent = true · 바다 메시 renderOrder를 다른 투명 물체보다 앞으로
  Object.assign(m.uniforms, { uSeeThru: { value: 0 }, uClarity: { value: .2 }, uCaps: { value: .6 }, uMinDepth: { value: 0 } });
  m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  Object.assign(m.uniforms, { uTexOn: WATER.on, uFoamT: WATER.foam, uFoam2: WATER.foam2, uBump: WATER.bump, uSpark: WATER.spark, uCaus: WATER.caus });
  return m;
}
/* 바다에 비치는 점광원 모으기: 매 프레임 begin → add(위치, 색, 세기, 닿는 거리 m) 여러 번 → end(카메라 위치).
   카메라에서 밝게 보일 순서로 PL_MAX개만 셰이더에 넘김. 색은 THREE.Color (화면 색), 세기 1 ≈ 은은한 빛기둥 */
const PL_MAX = 8;
function pointLights(seaMat){
  const U = seaMat.uniforms, pool = [], live = [];
  let n = 0;
  return {
    begin(){ n = 0; },
    add(p, color, strength, reach){
      if (!(strength > .01)) return;
      const e = pool[n] || (pool[n] = { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, s: 0, reach: 1, score: 0 });
      e.x = p.x; e.y = p.y; e.z = p.z; e.r = color.r; e.g = color.g; e.b = color.b; e.s = strength; e.reach = reach; n++;
    },
    end(cam){
      live.length = 0;
      for (let i = 0; i < n; i++) {
        const e = pool[i], dx = e.x - cam.x, dy = e.y - cam.y, dz = e.z - cam.z;
        e.score = e.s*e.reach*e.reach/(dx*dx + dy*dy + dz*dz + e.reach*e.reach); live.push(e);
      }
      live.sort((a, b) => b.score - a.score);
      const k = Math.min(PL_MAX, live.length);
      for (let i = 0; i < k; i++) {
        const e = live[i];
        U.uPL.value[i].set(e.x, e.y, e.z, Math.max(1, e.reach)); U.uPLC.value[i].set(e.r*e.s, e.g*e.s, e.b*e.s);
      }
      U.uPLN.value = k;
    },
  };
}
/* 바다 격자 (clipmap): 크기가 두 배씩 커지는 정사각 격자 단 LEVELS개. 단마다 자기 칸 두 배 단위로만 카메라를 따라 옮겨서
   정점이 늘 같은 월드 위치에 놓임 → 날아가도 물결을 읽는 점이 미끄러지지 않아 지글거림이 없음.
   각 단은 안쪽(한 단 촘촘한 격자가 덮는 곳)을 그리지 않고, 가장자리는 바깥 단 격자점으로 옮겨 이음매가 맞음 */
const GRID = { cell: 1, m: 64, levels: 11 };
function levelGeometry(THREE, cell, hollow){
  const M = GRID.m, n = 2*M + 1, edge = [];
  // 바깥 테두리를 한 바퀴 (치마: 테두리에서 아래로 늘어뜨린 띠 → 단 사이 미세한 틈이 보이지 않게)
  for (let i = 0; i < n - 1; i++) edge.push(i);
  for (let j = 0; j < n - 1; j++) edge.push(j*n + n - 1);
  for (let i = n - 1; i > 0; i--) edge.push((n - 1)*n + i);
  for (let j = n - 1; j > 0; j--) edge.push(j*n);
  const pos = new Float32Array((n*n + edge.length)*3), skirt = new Float32Array(n*n + edge.length), idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const o = (j*n + i)*3; pos[o] = (i - M)*cell; pos[o + 2] = (j - M)*cell; }
  edge.forEach((v, k) => { const s = n*n + k; pos[s*3] = pos[v*3]; pos[s*3 + 2] = pos[v*3 + 2]; skirt[s] = 1; });
  edge.forEach((v, k) => { const w = edge[(k + 1) % edge.length], s = n*n + k, t = n*n + (k + 1) % edge.length; idx.push(v, w, s, w, t, s); });
  // 안쪽 구멍: 촘촘한 단이 확실히 덮는 칸 (가장자리 2칸 여유는 남기고 픽셀 셰이더가 정확히 잘라냄)
  const hole = hollow ? M/2 - 2 : -1;
  for (let j = 0; j < 2*M; j++) for (let i = 0; i < 2*M; i++) {
    if (hole > 0 && Math.max(Math.abs(i + .5 - M), Math.abs(j + .5 - M)) < hole) continue;
    const a = j*n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSkirt', new THREE.BufferAttribute(skirt, 1)); g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), cell*M*1.5);
  return g;
}
// 가장 촘촘한 단 (페이지가 만드는 바다 메시). 나머지 단은 attach()가 자식으로 붙임
function geometry(THREE){ return levelGeometry(THREE, GRID.cell, false); }
/* 바다를 붙임: FFT를 만들어 바다 재질에 연결. 이후 매 프레임 sea.update(시간) · 카메라 이동 때 sea.follow(camera)
   바람: seaState 0 ~ 1 → 풍속 7 ~ 19 m/s (물결 높이 ≈ 0.6 ~ 4.5 m), 방향 = wind uniform */
function attach(THREE, renderer, seaMat, opt = {}){
  const u = seaMat.uniforms;
  let fft = null;
  try { fft = new OceanFFT(THREE, renderer, opt); if (!fft.ok) fft = null; } catch (e) { console.warn('FFT 바다를 쓸 수 없어 예전 바다로 그림', e); fft = null; }
  if (fft) {
    u.uOcOn.value = 1; u.uOcL.value.set(...fft.sizes);
    ['uOcD0', 'uOcD1', 'uOcD2'].forEach((k, i) => u[k].value = fft.cascades[i].disp.texture);
    ['uOcN0', 'uOcN1', 'uOcN2'].forEach((k, i) => u[k].value = fft.cascades[i].norm.texture);
  }
  const api = {
    fft, enabled: !!fft,
    setEnabled(on){ u.uOcOn.value = on && fft ? 1 : 0; this.enabled = !!(on && fft); },
    update(time){
      if (!fft || !this.enabled) return;
      const s = Math.max(0, Math.min(1, u.seaState.value)), U = 7 + 12*s, w = u.wind.value;
      fft.setWind(w.x*U, w.y*U, .6 + 1.2*s);
      fft.choppiness = .85 + .35*s;
      u.uOcVar.value.set(fft.cascades[0].slopeVar, fft.cascades[1].slopeVar, fft.cascades[2].slopeVar);
      fft.update(time);
    },
    levels: [],
    // 단마다 자기 칸 두 배 단위로 카메라를 따라 옮김. mesh = 페이지의 바다 메시(가장 촘촘한 단), 나머지 단은 그 자식
    follow(mesh, camera){
      if (!this.levels.length) this.build(mesh);
      const cx = camera.position.x, cz = camera.position.z, snap = c => [Math.floor(cx/(2*c) + .5)*2*c, Math.floor(cz/(2*c) + .5)*2*c];
      const [x0, z0] = snap(GRID.cell); mesh.position.x = x0; mesh.position.z = z0;
      let prev = [x0, z0];
      for (let l = 1; l < GRID.levels; l++) {
        const c = GRID.cell*2**l, [x, z] = snap(c), m = this.levels[l - 1];
        m.position.set(x - x0, 0, z - z0);
        // 촘촘한 단 가장자리 한 칸(이 단 칸 크기)만큼 겹쳐 그림: 경계를 딱 맞대면 계산 오차로 머리카락 같은 틈(점선)이 보임.
        // 겹친 곳은 두 단 모두 같은 격자점이라 모양이 같고, 이 단은 깊이를 조금 뒤로 밀어(polygonOffset) 촘촘한 단이 보임
        m.material.uniforms.uInner.value.set(prev[0], prev[1], GRID.cell*2**(l - 1)*GRID.m - c);
        prev = [x, z];
      }
    },
    build(mesh){
      for (let l = 1; l < GRID.levels; l++) {
        const c = GRID.cell*2**l;
        // 셰이더 · 값은 바다 재질과 같이 씀 (uniform 객체를 공유하니 바다 색 · 시간 · 그림자가 함께 바뀜). 단마다 다른 값만 따로
        const uniforms = Object.assign({}, seaMat.uniforms, { uCell: { value: c }, uHalf: { value: c*GRID.m }, uInner: { value: new THREE.Vector3() } });
        const mat = new THREE.ShaderMaterial({ fog: true, side: THREE.DoubleSide, extensions: { derivatives: true }, uniforms, vertexShader: seaMat.vertexShader, fragmentShader: seaMat.fragmentShader,
          polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2*l });
        const m = new THREE.Mesh(levelGeometry(THREE, c, true), mat); m.frustumCulled = false;
        mesh.add(m); this.levels.push(m);
      }
    },
    // 태양 그림자 맵을 물에 연결 (DirectionalLight, 그림자 맵이 만들어진 뒤 매 프레임)
    shadow(light, on){
      const sh = light.shadow;
      if (!on || !light.castShadow || !sh.map) { u.uShOn.value = 0; return; }
      u.uShOn.value = 1; u.uShMap.value = sh.map.texture; u.uShMat.value.copy(sh.matrix); u.uShSize.value.set(sh.mapSize.x, sh.mapSize.y);
    },
  };
  return api;
}
root.MapOcean = { OceanFFT, material, geometry, attach, GRID, waterFX, WATER, pointLights };
})(typeof window !== 'undefined' ? window : globalThis);
