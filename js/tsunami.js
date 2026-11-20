/* 지진해일 (DisasterFX가 씀)
   실제 쓰나미처럼 "물 언덕 하나"가 아니라 해수면 전체가 시간에 따라 오르내리는 현상으로 다룸.
   지형을 128×128 칸으로 나눠 칸마다:
   - 도착 시간 T: 해일이 오는 쪽 가장자리에서 출발해 칸 사이를 c = √(g·d) 속도로 가는 최단 시간 (다익스트라).
     얕은 곳에서 느려지고 섬을 돌아 들어가므로 굴절 · 회절이 저절로 나옴
   - 높이 A: Green 법칙 A = H₁₀·(10/d)^¼ (H₁₀ = 수심 10 m에서의 파고, 입력값). 섬 뒤(해일 오는 쪽이 높은 땅에 막힘)는 낮아짐
   - 육지: 처오름 높이(H₁₀ × 배율)보다 낮은 땅까지 물이 느리게 타고 올라감. 더 높은 땅은 안 잠김
   - 시간 변화 η(τ), τ = 지금 - T: 먼저 물이 빠지고(해저 드러남) → 빠르게 차오름 → 잠김 → 빠짐 → 두 번째 파
   - 흰 물살(보어): 얕은 곳 · 육지에서 수면이 빠르게 오르는 곳. 육지에 찬 물은 흙탕물
   결과를 텍스처(R 수면 높이, G 흰 물살, B 흙탕물)로 만들어 바다 셰이더가 그 높이만큼 바다를 올리고 내림.
   그래서 땅보다 높아진 곳만 물에 잠겨 보이고, 경계는 지형 모양 그대로 나옴.
   모두 시각화용 근사. 실제 단위(m · s)로 계산, 진행은 배속(speed)만큼 빠르게. */
(function (global) {
'use strict';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), sm = x => x * x * (3 - 2 * x);
const G = 9.81, NG = 128, PERIOD = 720; // 주기 12분 (실제 쓰나미 10~60분)

// 한 칸의 수면 변화 (A = 그 칸의 파고, τ 초). 첫 파 앞에 물 빠짐, 0.55배 두 번째 파
function eta(tau, A) {
  if (tau <= 0) return 0;
  const x = tau / PERIOD;
  if (x < .25) return -.4 * A * Math.sin(Math.PI * x / .25);
  if (x < .85) { const y = (x - .25) / .6; return A * (y < .25 ? Math.sin(Math.PI / 2 * y / .25) : Math.cos(Math.PI / 2 * (y - .25) / .75)); }
  if (x < 1.05) return -.25 * A * Math.sin(Math.PI * (x - .85) / .2);
  if (x < 1.6) return .55 * A * Math.sin(Math.PI * (x - 1.05) / .55);
  return 0;
}

function create(THREE, o) {
  // o: { getTerrain, U, seaLevel, seaMat, setView(pos, target) }
  const data = new Uint8Array(NG * NG * 4);
  const tex = new THREE.DataTexture(data, NG, NG, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  const sea = o.seaMat;
  Object.assign(sea.uniforms, { uTsu: { value: tex }, uTsuOn: { value: 0 }, uTsuBox: { value: new THREE.Vector3(0, 0, 1e4) }, uTsuS: { value: 1 },
    uTsuMud: { value: new THREE.Color(0x5e4c33) }, uTsuDir: { value: new THREE.Vector2(1, 0) } });
  // 바다 셰이더에 끼워 넣음 (바다 격자 단들이 처음 그려지기 전에 해야 같은 셰이더 · 값을 씀)
  const DECL = 'uniform sampler2D uTsu; uniform float uTsuOn; uniform vec3 uTsuBox; uniform float uTsuS; uniform vec3 uTsuMud; uniform vec2 uTsuDir;\n';
  const VKEY = 'w.xyz += disp; vHgt = disp.y;', FKEY = 'c = mix(c, foamCol, foamK); sAlpha = mix(sAlpha, 1., foamK);';
  let patched = false;
  if (sea.vertexShader.includes(VKEY) && sea.fragmentShader.includes(FKEY)) {
    sea.vertexShader = DECL + sea.vertexShader.replace(VKEY, VKEY + '\n    if (uTsuOn > .5) w.y += (texture2D(uTsu, (w.xz - uTsuBox.xy)/(2.*uTsuBox.z) + .5).r - .4)/.6*uTsuS;');
    sea.fragmentShader = DECL + sea.fragmentShader.replace(FKEY, FKEY + `
    if (uTsuOn > .5) {
      vec4 tsu = texture2D(uTsu, (p - uTsuBox.xy)/(2.*uTsuBox.z) + .5);
      float mud = tsu.b*.9;
      c = mix(c, uTsuMud*(.5 + .5*clamp(sunDir.y*2., 0., 1.)), mud); sAlpha = mix(sAlpha, 1., mud);
      float tn = mix(.62, streakTex(p/1.6, uTsuDir, 3.), uTexOn);
      // 흰 물살: 흙과 섞인 누런 흰색, 결이 끊어지게
      float tf = smoothstep(.3, .85, tsu.g*(.25 + 1.2*tn*tn));
      vec3 boreCol = mix(foamCol, uTsuMud*1.6 + vec3(.12), .3 + .3*mud);
      c = mix(c, boreCol, tf); sAlpha = mix(sAlpha, 1., tf);
    }`);
    sea.needsUpdate = true; patched = true;
  }

  const N2 = NG * NG, elev = new Float32Array(N2), T = new Float32Array(N2), A = new Float32Array(N2), wet = new Uint8Array(N2);
  let prm = null, on = false, simT = 0, endT = 0, pause = 0, S = 1, half = 1e4, cellM = 1;
  const from = new THREE.Vector3();

  function start(p) {
    const t = o.getTerrain(); if (!t || !patched) return;
    prm = { ...p }; on = true; simT = 0; pause = 0;
    const U = o.U(); half = t.size / 2; const cell = t.size / NG; cellM = cell / U;
    const a = p.dir * Math.PI / 180; from.set(Math.sin(a), 0, -Math.cos(a));
    const H = p.height, run = p.height * p.runup;
    for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
      const x = -half + (i + .5) * cell, z = -half + (j + .5) * cell, h = t.fieldHeight(x, z);
      elev[j * NG + i] = Number.isFinite(h) ? (h - o.seaLevel) / U : -50;
    }
    // 칸 속도 (m/s): 바다 √(g·d), 처오름보다 낮은 땅은 물이 타고 오르는 느린 속도, 높은 땅은 못 감
    const speedAt = k => { const e = elev[k]; return e < -.5 ? Math.sqrt(G * Math.max(-e, 2)) : e < run ? .45 * Math.sqrt(G * Math.max(run - e, .3)) : 0; };
    // 다익스트라 (이진 힙). 시작: 해일이 오는 쪽 가장자리 바다 칸, 평면파가 닿는 시간
    T.fill(Infinity);
    const heap = [], push = (k, v) => { heap.push([v, k]); let n = heap.length - 1; while (n) { const q = (n - 1) >> 1; if (heap[q][0] <= heap[n][0]) break; [heap[q], heap[n]] = [heap[n], heap[q]]; n = q; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let n = 0; for (;;) { const l = 2 * n + 1, r = l + 1; let m = n; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === n) break; [heap[m], heap[n]] = [heap[n], heap[m]]; n = m; } } return top; };
    const dotC = (i, j) => (from.x * (i + .5 - NG / 2) + from.z * (j + .5 - NG / 2)) * cellM; // 해일 오는 쪽으로 갈수록 큼 (m)
    let maxDot = -Infinity, cRef = 0, nRef = 0;
    for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) if (i === 0 || j === 0 || i === NG - 1 || j === NG - 1) { maxDot = Math.max(maxDot, dotC(i, j)); const c = speedAt(j * NG + i); if (c > 0 && elev[j * NG + i] < -.5) { cRef += c; nRef++; } }
    cRef = nRef ? cRef / nRef : 30;
    for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
      if (!(i === 0 || j === 0 || i === NG - 1 || j === NG - 1)) continue;
      const k = j * NG + i, dd = dotC(i, j);
      if (dd < 0 || elev[k] >= -.5) continue; // 해일 오는 쪽 절반의 바다 가장자리만
      T[k] = (maxDot - dd) / cRef; push(k, T[k]);
    }
    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (heap.length) {
      const [tk, k] = pop(); if (tk > T[k]) continue;
      const i = k % NG, j = (k - i) / NG, ck = speedAt(k);
      for (const [di, dj, w] of NB) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= NG || nj >= NG) continue;
        const n = nj * NG + ni, cn = speedAt(n); if (!cn) continue;
        const v = tk + w * cellM / ((ck + cn) / 2); if (v < T[n]) { T[n] = v; push(n, v); }
      }
    }
    // 높이: Green 법칙 + 섬 그림자 (해일 오는 쪽 3 km 안에 처오름보다 높은 땅이 있으면 낮아짐)
    endT = 0;
    for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
      const k = j * NG + i, e = elev[k];
      let shade = 1;
      for (let s = 1; s * cellM < 3000; s++) {
        const si = Math.round(i + from.x * s), sj = Math.round(j + from.z * s); if (si < 0 || sj < 0 || si >= NG || sj >= NG) break;
        if (elev[sj * NG + si] > run) { shade = .45 + .55 * clamp(s * cellM / 3000, 0, 1); break; }
      }
      A[k] = e < -.5 ? Math.min(H * Math.pow(10 / Math.max(-e, 2), .25), run) * shade : run * shade;
      wet[k] = Number.isFinite(T[k]) ? 1 : 0;
      if (wet[k]) endT = Math.max(endT, T[k]);
    }
    endT += 1.7 * PERIOD;
    S = run * 1.3 + 1;
    const U1 = o.U();
    sea.uniforms.uTsuBox.value.set(0, 0, half); sea.uniforms.uTsuS.value = S * U1; sea.uniforms.uTsuDir.value.set(-from.x, -from.z);
    sea.uniforms.uTsuOn.value = 1;
    fill(0);
  }
  function stop() { on = false; sea.uniforms.uTsuOn.value = 0; }

  // 칸마다 텍스처 값 갱신 (R 수면 높이, G 흰 물살, B 흙탕물)
  function fill(tNow) {
    let k4 = 0;
    for (let k = 0; k < N2; k++, k4 += 4) {
      let h = 0, foam = 0, mud = 0;
      if (wet[k]) {
        const tau = tNow - T[k], a = A[k], e = elev[k];
        h = eta(tau, a);
        const rise = (h - eta(tau - 20, a)) / Math.max(a * .14, .2);  // 20초 동안 오른 정도 (빠르게 차오르는 앞쪽만)
        const shallow = e > -.5 ? 1 : clamp(1 - (-e - 5) / 40, 0, 1);  // 수심 45 m보다 얕을수록
        foam = clamp(rise, 0, 1.4) * (.15 + .85 * shallow);
        if (e > -.5) { const depth = h - e; if (depth > .05) { mud = clamp(depth / .8, 0, 1); foam = Math.max(foam, clamp(rise, 0, 1) * .9); } }
        else mud = clamp(h / Math.max(a, .1), 0, 1) * (.35 + .5 * shallow); // 차오르는 물은 바닥 흙을 휘저어 탁함
      }
      if (elev[k] > -.5 && h < elev[k]) h = Math.min(h, elev[k] - .3); // 마른 땅 밑으로 숨김 (경계 보간이 땅 위로 새지 않게)
      data[k4] = clamp(Math.round((.4 + .6 * h / S) * 255), 0, 255);
      data[k4 + 1] = clamp(Math.round(foam * 180), 0, 255);
      data[k4 + 2] = clamp(Math.round(mud * 255), 0, 255);
      data[k4 + 3] = 255;
    }
    tex.needsUpdate = true;
  }

  function update(dt, playing) {
    if (!on) return { level: 0, mud: 0 };
    if (playing) {
      if (simT < endT) simT += dt * prm.speed;
      else if ((pause += dt) > 4) { simT = 0; pause = 0; } // 다 빠지면 4초 쉬고 다시
    }
    fill(simT);
    return { level: 0, mud: .2 };
  }

  // 아직 해일이 안 온 해안을 골라, 땅 위에서 바다 쪽(해일 오는 쪽)을 바라보게 카메라를 옮김
  function focus() {
    if (!on) return false;
    const U = o.U(), cell = half * 2 / NG, run = prm.height * prm.runup;
    let best = -1, bt = Infinity;
    for (let j = 2; j < NG - 2; j++) for (let i = 2; i < NG - 2; i++) {
      const k = j * NG + i, e = elev[k];
      if (!(e > .5 && e < run * .8) || !wet[k]) continue;
      const seaE = elev[k + Math.round(from.z) * NG + Math.round(from.x)]; if (!(seaE < -.5)) continue; // 해일 오는 쪽 바로 옆이 바다
      const lead = T[k] - simT; if (lead > PERIOD * .15 && lead < bt) { bt = lead; best = k; }
    }
    if (best < 0) for (let k = 0; k < N2; k++) if (elev[k] > .5 && wet[k] && (best < 0 || T[k] > T[best])) best = k;
    if (best < 0) return false;
    const i = best % NG, j = (best - i) / NG, x = -half + (i + .5) * cell, z = -half + (j + .5) * cell;
    // 해안선이 화면을 비스듬히 지나가게: 땅 쪽 뒤 · 옆에서 바다 쪽 아래를 내려다봄
    const side = new THREE.Vector3(-from.z, 0, from.x);
    const cam = new THREE.Vector3(x - from.x * 300 * U + side.x * 250 * U, 0, z - from.z * 300 * U + side.z * 250 * U);
    const t = o.getTerrain(); cam.y = Math.max(o.seaLevel, t ? t.height(cam.x, cam.z) : 0) + Math.max(40, run * 3) * U;
    o.setView(cam, new THREE.Vector3(x + from.x * 450 * U - side.x * 150 * U, o.seaLevel, z + from.z * 450 * U - side.z * 150 * U));
    return true;
  }

  return { start, stop, update, focus, setSpeed(v) { if (prm) prm.speed = v; }, get running() { return on; }, get patched() { return patched; } };
}

global.DisasterTsunami = { create };
})(window);
