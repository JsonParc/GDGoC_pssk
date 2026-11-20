/* 실제 높이 · 크기의 3D 구름 + 구름에서 내리는 비 · 눈
   구름 하나 = 부드러운 구름 덩어리(puff) 여러 장을 구름 크기 안에 모아 놓은 것 (실제 m 크기, 위는 밝고 밑은 어두운 결을 텍스처에 구움).
   Cesium 기본 CumulusCloud는 크고 어두운 비구름에서 털 뭉치처럼 보여 쓰지 않음
   구름 종류별 실제 값 (WMO 구름 분류 기준 대략):
   - 난층운 · 적란운 (태풍 · 호우): 구름 밑면 지면 위 500~1,200 m, 한 덩이 폭 2~5 km, 두께 1~3 km (태풍은 탑 모양 적란운 5~8 km)
   - 층적운 (눈): 밑면 400~900 m, 폭 1.5~3 km, 두께 0.4~1 km
   구름은 바람(실제 m/s)대로 흘러가고, 영역(발생 지점 둘레 반경 R) 밖으로 나가면 반대편에서 다시 들어옴.
   비 · 눈: 구름 밑면에서 땅까지 세로로 선 줄기(빗줄기 결이 흘러내리는 반투명 판)로 그리고,
   카메라가 영역 안 구름 밑에 있으면 화면 비 · 눈(fx.js)을 켤 수 있게 precipHere()로 알려줌

   백엔드 연동: load(list)로 구름마다 실제 값을 받아 그대로 띄움 (자동 생성 대신). 구름 하나:
     { id?, longitude, latitude,           // 구름 중심 (°)
       base,                                // 구름 밑면 높이 (m, 해발). baseAboveGround를 주면 그 자리 지면 기준
       width, height, depth?,               // 가로 · 두께 · 세로 (m)
       speed, direction,                    // 이동 속도 (m/s), 이동하는 방향 (°, 북 = 0, 시계 방향)
       precip?: 'rain' | 'snow', rate?,     // 비 · 눈과 세기 (0~1)
       darkness? }                          // 구름 어두움 (0 = 흰 뭉게구름 ~ 1 = 시커먼 비구름)
   update(list)는 같은 id의 구름을 새 값으로 옮기고(부드럽게), 없던 건 추가 · 빠진 건 지움 */
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 구름 덩어리 텍스처: 값 잡음(fbm)을 둥근 틀로 자르고, 위는 밝게 · 밑은 어둡게 (햇빛은 위에서)
function puffTextures(n = 4) {
  const out = [];
  for (let v = 0; v < n; v++) {
    const S = 192, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), seed = v * 37.7;
    const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453; return h - Math.floor(h); };
    const noise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
      const a = hash(xi, yi), b = hash(xi + 1, yi), c2 = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c2 - a) * w + (a - b - c2 + d) * u * w; };
    const fbm = (x, y) => { let t = 0, a = .5; for (let o = 0; o < 5; o++) { t += a * noise(x, y); x *= 2.03; y *= 2.03; a *= .5; } return t; };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const nx = x / S * 2 - 1, ny = y / S * 2 - 1, r = Math.hypot(nx, ny * 1.15);
      const n2 = fbm(x / S * 4 + seed, y / S * 4), m = Math.max(0, 1 - r) ** .8;
      const a = Math.max(0, Math.min(1, (n2 * 1.3 * m - .2) * 4.2)); // 속은 꽉 차게, 가장자리 좁게
      const shade = .62 + .38 * Math.max(0, Math.min(1, .5 - ny * .7 + (n2 - .5) * .6)); // 위(ny<0) 밝게
      const k = (y * S + x) * 4; img.data[k] = img.data[k + 1] = 255 * shade; img.data[k + 2] = 255 * Math.min(1, shade * 1.03); img.data[k + 3] = 255 * a;
    }
    g.putImageData(img, 0, 0); out.push(c);
  }
  return out;
}

// 빗줄기 · 눈발 결 (세로로 흐르는 줄무늬, 위 · 아래 · 양옆은 흐려짐). FRAMES장을 아래로 밀어 가며 바꿔 흘러내리게
const FRAMES = 6;
function shaftFrames(snow) {
  const W = 96, H = 256, base = document.createElement('canvas'); base.width = W; base.height = H * 2;
  const g = base.getContext('2d');
  for (let i = 0; i < (snow ? 900 : 260); i++) {
    const x = Math.random() * W, y = Math.random() * H * 2, a = snow ? rnd(.25, .7) : rnd(.15, .45);
    g.fillStyle = snow ? `rgba(240,244,250,${a})` : `rgba(190,205,220,${a})`;
    if (snow) { g.beginPath(); g.arc(x, y, rnd(.6, 1.5), 0, 7); g.fill(); } else g.fillRect(x, y, 1, rnd(14, 34));
  }
  g.drawImage(base, 0, 0, W, H, 0, H, W, H); // 아래 절반 = 위 절반 (이어지게)
  const out = [];
  for (let f = 0; f < FRAMES; f++) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const k = c.getContext('2d'), off = H - f / FRAMES * H;
    k.drawImage(base, 0, off, W, H, 0, 0, W, H);
    // 가장자리 흐림 + 전체 엷은 막 (멀리서 보이는 빗줄기 커튼)
    k.globalCompositeOperation = 'source-over';
    k.fillStyle = snow ? 'rgba(230,235,242,.22)' : 'rgba(120,135,150,.28)'; k.fillRect(0, 0, W, H);
    k.globalCompositeOperation = 'destination-in';
    const gx = k.createLinearGradient(0, 0, W, 0); gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(.25, 'rgba(0,0,0,1)'); gx.addColorStop(.75, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
    k.fillStyle = gx; k.fillRect(0, 0, W, H);
    const gy = k.createLinearGradient(0, 0, 0, H); gy.addColorStop(0, 'rgba(0,0,0,.2)'); gy.addColorStop(.12, 'rgba(0,0,0,1)'); gy.addColorStop(.85, 'rgba(0,0,0,1)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
    k.fillStyle = gy; k.fillRect(0, 0, W, H);
    out.push(c);
  }
  return out;
}

export function createCloudLayer(viewer, Cesium) {
  const scene = viewer.scene;
  const clouds = scene.primitives.add(new Cesium.BillboardCollection({ scene, blendOption: Cesium.BlendOption.OPAQUE_AND_TRANSLUCENT })); // 속은 불투명(깊이 정렬), 가장자리만 반투명
  const PUFF = puffTextures();
  const shafts = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
  const frames = { rain: shaftFrames(false), snow: shaftFrames(true) };
  let items = [], state = null, enu = null, frame = 0, lastFrame = 0, last = null;

  function clear() { clouds.removeAll(); shafts.removeAll(); items = []; state = null; }
  // 구름 하나 추가 (로컬 동 · 북 · 위 m 좌표): it = { x, y, baseH(지면 위 밑면), w, h, d, vx, vy, precip, rate, dark }
  function addItem(it) {
    it.z = it.baseH + it.h / 2;
    makePuffs(it);
    if (it.precip) it.shaft = shafts.add({
      position: toWorld({ x: it.x, y: it.y, z: it.baseH }), image: frames[it.precip][0], sizeInMeters: true,
      width: it.w * .55, height: it.baseH + 40, verticalOrigin: Cesium.VerticalOrigin.TOP,
      alignedAxis: Cesium.Matrix4.multiplyByPointAsVector(enu, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()),
      color: new Cesium.Color(1, 1, 1, clamp(.35 + .6 * (it.rate ?? .5), .3, .95)),
    });
    items.push(it); return it;
  }
  // 구름 크기(가로 w, 두께 h) 안에 덩어리를 흩어 놓음. 밑면은 평평하게 (덩어리 중심이 밑면 아래로 안 내려감)
  function makePuffs(it) {
    if (it.puffs) for (const q of it.puffs) clouds.remove(q.bb);
    const g = .95 - .55 * it.dark, n = Math.round(clamp(it.w / 700, 5, 14) * clamp(it.h / 1200, .8, 2));
    it.puffs = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * it.w * .36, size = rnd(.55, 1) * Math.min(it.w * .55, it.h * 1.5 + 600);
      const q = { ox: Math.cos(a) * r, oy: Math.sin(a) * r, oz: rnd(-.25, .35) * it.h + size * .3 };
      const tone = g * rnd(.92, 1.05);
      q.bb = clouds.add({ position: toWorld({ x: it.x + q.ox, y: it.y + q.oy, z: it.baseH + it.h * .3 + q.oz }), image: PUFF[i % PUFF.length], sizeInMeters: true,
        width: size * rnd(1.1, 1.5), height: size, color: new Cesium.Color(tone, tone * 1.01, tone * 1.04, 1) });
      it.puffs.push(q);
    }
  }
  function removeItem(it) { for (const q of it.puffs || []) clouds.remove(q.bb); if (it.shaft) shafts.remove(it.shaft); items = items.filter(x => x !== it); }
  const local = (lon, lat, h = 0) => Cesium.Matrix4.multiplyByPoint(Cesium.Matrix4.inverse(enu, new Cesium.Matrix4()), Cesium.Cartesian3.fromDegrees(lon, lat, h), new Cesium.Cartesian3());
  // 백엔드 구름 한 개 → 로컬 항목
  function fromApi(c) {
    const p = local(c.longitude, c.latitude, 0);
    const ground = state.groundHeight || 0, baseH = c.baseAboveGround != null ? c.baseAboveGround : (c.base != null ? c.base - ground : 800);
    const dir = (c.direction || 0) * Math.PI / 180, v = c.speed || 0;
    return { id: c.id, x: p.x, y: p.y, baseH: Math.max(50, baseH), w: c.width || 2500, h: c.height || 1200, d: c.depth, vx: Math.sin(dir) * v, vy: Math.cos(dir) * v,
      precip: c.precip === 'rain' || c.precip === 'snow' ? c.precip : null, rate: c.rate ?? .5, dark: clamp(c.darkness ?? (c.precip ? .6 : .1), 0, 1) };
  }
  /* 백엔드 구름 목록으로 바꿈. 기준점(동 · 북 좌표 원점)은 목록 가운데 (또는 origin = { longitude, latitude, groundHeight }) */
  function load(list, origin) {
    clear(); if (!list || !list.length) return;
    const o = origin || { longitude: list.reduce((a, c) => a + c.longitude, 0) / list.length, latitude: list.reduce((a, c) => a + c.latitude, 0) / list.length, groundHeight: 0 };
    state = { ...o, api: true, precip: list.some(c => c.precip) ? 'mixed' : null, radius: Infinity };
    enu = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(o.longitude, o.latitude, o.groundHeight || 0));
    for (const c of list) addItem(fromApi(c));
  }
  /* 같은 id는 새 위치 · 크기 · 속도로 (위치는 3초 동안 부드럽게), 새 id는 추가, 빠진 id는 지움 */
  function update(list) {
    if (!state || !state.api) return load(list);
    const seen = new Set();
    for (const c of list) {
      const n = fromApi(c), it = c.id != null && items.find(x => x.id === c.id); seen.add(c.id);
      if (!it) { addItem(n); continue; }
      Object.assign(it, { tx: n.x, ty: n.y, vx: n.vx, vy: n.vy, baseH: n.baseH, w: n.w, h: n.h, dark: n.dark, z: n.baseH + n.h / 2 });
      if (Math.abs(it.pw - n.w) > 50 || Math.abs(it.ph - n.h) > 50 || it.pd !== n.dark) { it.pw = n.w; it.ph = n.h; it.pd = n.dark; makePuffs(it); }
      if (!!it.shaft !== !!n.precip || it.precip !== n.precip) { removeItem(it); addItem(Object.assign(n, { id: c.id })); }
    }
    for (const it of [...items]) if (it.id != null && !seen.has(it.id)) removeItem(it);
  }

  /* o: { longitude, latitude, groundHeight, kind: 'storm'|'rain'|'snow', amount 0~1, gloom 0~1, wind m/s, dir °(불어오는 방향), precip: 'rain'|'snow'|null, rate 0~1, radius m } */
  function set(o) {
    clear();
    state = { ...o, radius: o.radius || 14000 };
    enu = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(o.longitude, o.latitude, o.groundHeight || 0));
    const R = state.radius, storm = o.kind === 'storm', snow = o.kind === 'snow';
    // 개수: 영역 넓이에 맞춰 (태풍 반경 25 km면 약 200개)
    const n = Math.round(clamp(R * R / 5e6, 30, 160) * (.4 + .6 * clamp(o.amount, 0, 1)));
    const dark = clamp(o.gloom, 0, 1), to = (o.dir + 180) * Math.PI / 180, vx = Math.sin(to) * o.wind, vy = Math.cos(to) * o.wind;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
      const tower = storm && Math.random() < .18;                    // 탑처럼 솟은 적란운
      addItem({ x: Math.cos(a) * r, y: Math.sin(a) * r, vx, vy, dark,
        w: tower ? rnd(3000, 5000) : snow ? rnd(2500, 4500) : rnd(4000, 7500),
        h: tower ? rnd(5000, 8000) : snow ? rnd(500, 1000) : rnd(1000, 2200),
        baseH: snow ? rnd(400, 900) : rnd(500, 1200),                 // 구름 밑면 (지면 위 m)
        precip: o.precip && Math.random() < .45 + .45 * clamp(o.rate, 0, 1) ? o.precip : null, rate: o.rate });   // 비 · 눈 줄기: 구름 일부에서
    }
  }
  const toWorld = it => Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(it.x, it.y, it.z), new Cesium.Cartesian3());

  function tick(now) {
    if (!state || !items.length) { last = now; return; }
    const dt = last == null ? 0 : Math.min(.2, now - last); last = now;
    const R = state.radius;
    for (const it of items) {
      it.x += it.vx * dt; it.y += it.vy * dt;
      if (it.tx != null) { const k = Math.min(1, dt / 3); it.x += (it.tx + it.vx * 0 - it.x) * k; it.y += (it.ty - it.y) * k; it.tx += it.vx * dt; it.ty += it.vy * dt; } // 백엔드 새 위치로 부드럽게
      if (it.x * it.x + it.y * it.y > R * R) { it.x = -it.x * .98; it.y = -it.y * .98; } // (자동 생성) 영역 밖 → 반대편에서 다시
      for (const q of it.puffs) q.bb.position = toWorld({ x: it.x + q.ox, y: it.y + q.oy, z: it.baseH + it.h * .3 + q.oz });
      if (it.shaft) it.shaft.position = toWorld({ x: it.x, y: it.y, z: it.baseH });
    }
    if (now - lastFrame > .07) { // 빗줄기 결 흘러내림
      lastFrame = now; frame = (frame + 1) % FRAMES;
      for (const it of items) if (it.shaft) it.shaft.setImage(it.precip + frame, frames[it.precip][frame]);
    }
  }

  // 카메라가 영역 안 · 구름 밑면 아래에 있으면 1 (화면 비 · 눈을 켬), 밖이나 구름 위면 0
  // 카메라 위에 비 · 눈 구름이 있고 카메라가 그 밑면 아래면 1 (가까운 구름일수록), 아니면 0. 종류도 돌려줌
  function precipHere() {
    if (!state) return { k: 0 };
    const inv = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4()), p = Cesium.Matrix4.multiplyByPoint(inv, viewer.camera.positionWC, new Cesium.Cartesian3());
    let best = { k: 0 };
    for (const it of items) {
      if (!it.precip) continue;
      const d = Math.hypot(p.x - it.x, p.y - it.y), k = clamp((it.w * .9 - d) / (it.w * .4), 0, 1) * clamp((it.baseH - p.z) / 300 + 1, 0, 1) * (it.rate ?? .5);
      if (k > best.k) best = { k, kind: it.precip };
    }
    return best;
  }
  function setPrecip(on) { if (!state) return; shafts.show = on; state.precipOn = on; }

  return { set, load, update, clear, tick, precipHere: () => (state && state.precipOn === false ? { k: 0 } : precipHere()), setPrecip, get active() { return !!state; }, get api() { return !!(state && state.api); } };
}
