/* 지도 위 재난 · 기후변화 패널 (왼쪽, 접을 수 있음)
   탭 [재난]: 재난 종류 · 발생 지점(지도 클릭) · 영역 그리기(산불 · 홍수) · 입력값(숫자 칸 + 슬라이더) · 추정치 · JSON
   탭 [하늘 · 물]: 하늘 템플릿(템플릿 뷰어의 하늘 15종) · 바다 색 템플릿 · 바다/강 물 표면
   재난 정의 · 간이 공식은 js/disaster.js(window.DisasterFX), 하늘 · 바다 값은 js/atmosphere.js(window.MapAtmosphere)
   API: window.koreaDisaster.set(type, params, { longitude, latitude }, data) · .stop() · .get() · .sky(id) · .sea(id) */
import { registerDisasterEffects } from './fx.js';

const CSS = `
#dx-panel.closed,#dx-open.closed{display:none!important}
#dx-panel{position:absolute;z-index:3;top:60px;left:12px;width:min(300px,calc(100vw - 24px));max-height:calc(100dvh - 190px);display:flex;flex-direction:column;
  background:#0f1c19f2;color:#e9f2ef;border:1px solid #35524a;border-radius:12px;font:12.5px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px #0006;box-sizing:border-box}
#dx-panel *{box-sizing:border-box}
#dx-panel [hidden]{display:none!important}
#dx-panel header{display:flex;align-items:center;gap:6px;padding:10px 12px 0}
#dx-panel header b{flex:1;font-size:14px}
#dx-panel header button{background:none;border:0;color:#a9bdb6;cursor:pointer;font-size:16px;padding:0 2px;width:auto}
#dx-panel .tabs{display:flex;gap:4px;padding:8px 12px 0}
#dx-panel .tabs button{flex:1;background:none;border:1px solid #35524a;color:#a9bdb6;border-radius:7px;padding:5px 0;font:inherit;cursor:pointer;width:auto}
#dx-panel .tabs button.on{background:#1f4740;border-color:#5ee6d0;color:#fff}
#dx-panel .body{overflow:auto;padding:8px 12px 12px}
#dx-panel h3{margin:10px 0 5px;font-size:11px;font-weight:600;color:#8fa9a1;letter-spacing:.04em}
#dx-panel .types{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
#dx-panel .types button{background:#182b27;color:#e9f2ef;border:1px solid #2c4740;border-radius:7px;padding:5px 1px 4px;font:inherit;font-size:11px;cursor:pointer;line-height:1.2;width:auto;margin:0}
#dx-panel .types button i{display:block;font-style:normal;font-size:15px}
#dx-panel .types button.on{border-color:#5ee6d0;background:#1f4740}
#dx-panel .desc{color:#a9bdb6;font-size:11.5px;margin:6px 0 0}
#dx-panel .site{display:flex;align-items:center;gap:6px;margin-top:8px;padding:6px 8px;border-radius:7px;background:#182b27;font-size:12px}
#dx-panel .site span{flex:1;color:#ffd58a}
#dx-panel .btns{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}
#dx-panel .btns button{background:#182b27;color:#fff;border:1px solid #35524a;border-radius:6px;padding:5px 9px;font:inherit;cursor:pointer;width:auto;margin:0}
#dx-panel .btns button.primary{background:#5ee6d0;color:#06231e;border-color:transparent;font-weight:600}
#dx-panel .row{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:7px}
#dx-panel .row label{color:#c9d8d3;font-size:12px}
#dx-panel .row span{display:flex;align-items:center;gap:3px}
#dx-panel input[type=number]{width:66px;background:#0a1412;color:#fff;border:1px solid #35524a;border-radius:5px;padding:2px 5px;text-align:right;font:12px ui-monospace,monospace;margin:0}
#dx-panel input[type=number]:disabled{opacity:.55}
#dx-panel em{font-style:normal;color:#8fa9a1;font-size:11px;min-width:26px}
#dx-panel input[type=range]{width:100%;accent-color:#5ee6d0;margin:2px 0 0;padding:0;height:16px}
#dx-panel dl{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:3px 8px;margin:0;font-size:12px;word-break:keep-all}
#dx-panel dt{color:#a9bdb6} #dx-panel dd{margin:0;text-align:right}
#dx-panel .note{font-size:11px;color:#7f978f;margin:8px 0 0}
#dx-panel details{margin-top:8px} #dx-panel summary{cursor:pointer;color:#a9bdb6;font-size:12px}
#dx-panel textarea{width:100%;background:#0a1412;color:#e9f2ef;border:1px solid #35524a;border-radius:6px;font:11px ui-monospace,monospace;margin-top:6px}
#dx-panel select{width:100%;background:#0a1412;color:#fff;border:1px solid #35524a;border-radius:6px;padding:5px;font:inherit;margin:0}
#dx-panel label.check{display:flex;gap:6px;align-items:center;margin-top:8px;color:#c9d8d3}
#dx-panel label.check input{width:auto;margin:0}
#dx-panel .tag{font-size:10px;color:#ffb547;border:1px solid #ffb54766;border-radius:4px;padding:0 4px;margin-left:4px;font-weight:500}
#dx-open{position:absolute;z-index:3;top:60px;left:12px;background:#0f1c19f2;color:#fff;border:1px solid #35524a;border-radius:9px;padding:7px 11px;cursor:pointer;font:600 13px system-ui;width:auto}
`;

export function attachDisasterPanel({ viewer, Cesium, disasters }) {
  if (!window.DisasterFX) { console.warn('js/disaster.js가 없어 재난 패널을 만들지 않습니다.'); return null; }
  const { TYPES } = window.DisasterFX, MA = window.MapAtmosphere;
  const S = registerDisasterEffects(disasters, viewer, Cesium);
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const root = document.createElement('section'); root.id = 'dx-panel'; root.setAttribute('aria-label', '재난 · 기후변화');
  root.innerHTML = `
    <header><b>재난 · 기후변화</b><button type="button" id="dx-close" aria-label="패널 접기" title="접기">‹</button></header>
    <div class="tabs"><button type="button" class="on" data-tab="dx-tab-disaster">재난</button><button type="button" data-tab="dx-tab-env">하늘 · 물</button></div>
    <div class="body">
      <div id="dx-tab-disaster">
        <div class="types" id="dx-types"></div>
        <p class="desc" id="dx-desc"></p>
        <div class="site"><span id="dx-site">발생 지점: 지도를 클릭하세요 (없으면 화면 가운데)</span></div>
        <div class="btns"><button type="button" class="primary" id="dx-apply">적용</button><button type="button" id="dx-stop">끄기</button>
          <button type="button" id="dx-draw" hidden>영역 그리기</button><button type="button" id="dx-draw-done" hidden>완료</button><button type="button" id="dx-draw-cancel" hidden>취소</button><button type="button" id="dx-draw-clear" hidden>영역 지우기</button></div>
        <p class="note" id="dx-draw-note" hidden></p>
        <div id="dx-base-row" hidden><h3>물 기준</h3><select id="dx-base"><option value="sea">근처 바다에서 들어옴 (해수면 기준)</option><option value="point">이 지점에서 차오름 (선택 지점 지면 기준)</option></select>
          <p class="note">이어진 낮은 땅만 잠깁니다. 둑 · 언덕 너머 막힌 곳은 안 잠깁니다.</p></div>
        <h3>입력값</h3><div id="dx-params"></div>
        <h3>추정치 <span class="tag">간이 공식</span></h3><dl id="dx-out"></dl>
        <p class="note">수치는 시각화용 간이 공식 추정치이고 화면 효과는 연출입니다. 산불 번짐 · 해일 · 눈 쌓임은 타임랩스로 압축합니다.</p>
        <details><summary>파라미터 JSON (API 연동용)</summary><textarea id="dx-json" rows="6" spellcheck="false"></textarea>
          <div class="btns"><button type="button" id="dx-json-apply">JSON 적용</button></div></details>
      </div>
      <div id="dx-tab-env" hidden>
        <h3>하늘</h3><select id="dx-sky"><option value="">브이월드 기본 하늘</option></select>
        <label class="check"><input type="checkbox" id="dx-skyauto" checked> 재난에 맞는 하늘로 자동 바꾸기</label>
        <p class="note">템플릿 뷰어의 하늘 사진을 지도 하늘에 입힙니다. 사진 속 해는 실제 해 방향에 맞춰 돌립니다.</p>
        <h3>날씨 보이기</h3>
        <label class="check"><input type="checkbox" id="dx-realvis"> 실제 시정 (비 · 눈으로 실제 보이는 거리만큼 뿌옇게)</label>
        <p class="note">끄면 6배 멀리까지 보입니다. 비 · 구름 · 안개는 카메라가 약 3 km보다 높아지면 옅어지고 8 km 위에선 사라집니다.</p>
        <h3>바다 · 강</h3>
        <label class="check"><input type="checkbox" id="dx-water" checked> 물 표면 (실제 바다 · 강 · 호수 다각형)</label>
        <select id="dx-sea" style="margin-top:8px"><option value="">기본 바다 색</option></select>
        <p class="note" id="dx-sea-note">OpenFreeMap(OpenStreetMap) 물 다각형을 받아 바다는 해수면, 강 · 호수는 그 자리 지형 높이에 물결 · 반짝임이 있는 물로 덮습니다. 기후변화 · 해일 · 폭풍해일이면 바다가 그만큼 올라갑니다.</p>
      </div>
    </div>`;
  const opener = document.createElement('button'); opener.id = 'dx-open'; opener.type = 'button'; opener.textContent = '재난 · 기후변화 ›'; opener.classList.add('closed');
  document.body.append(root, opener);
  const $ = id => root.querySelector('#' + id);
  // 접기 / 펴기 (hidden 속성은 display 규칙에 덮여서 클래스로)
  $('dx-close').onclick = () => { root.classList.add('closed'); opener.classList.remove('closed'); };
  opener.onclick = () => { root.classList.remove('closed'); opener.classList.add('closed'); };
  root.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    root.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    for (const id of ['dx-tab-disaster', 'dx-tab-env']) $(id).hidden = id !== b.dataset.tab;
  });

  let type = 'typhoon', params = {}, site = null, running = null, data = null;
  // 재난 → 하늘 템플릿 (템플릿 뷰어의 하늘 사진). 지진 · 해일은 하늘을 바꾸지 않음
  const DISASTER_SKY = { typhoon: 'thunder-storm', flood: 'slate-overcast', snow: 'blizzard-gray', heatwave: 'golden-dusk', wildfire: 'amber-dawn', sealevel: 'cumulus-blue', tsunami: 'sea-fog' };
  const defaults = t => Object.fromEntries(TYPES[t].params.map(q => [q.key, q.value]));
  params = defaults(type);

  for (const [k, t] of Object.entries(TYPES)) {
    if (k === 'none') continue;
    const b = document.createElement('button'); b.type = 'button'; b.dataset.type = k;
    b.innerHTML = '<i></i><span></span>'; b.firstChild.textContent = t.icon; b.lastChild.textContent = t.name.replace(' · ', '·');
    b.onclick = () => { if (type !== k) { type = k; params = defaults(k); clearPreview(); if (drawing) setDrawing(false); } render(true); if (running) start(); };
    $('dx-types').append(b);
  }

  function centerSite() {
    const c = viewer.scene.canvas, ray = viewer.camera.getPickRay(new Cesium.Cartesian2(c.clientWidth / 2, c.clientHeight / 2));
    const p = ray && viewer.scene.globe.pick(ray, viewer.scene); if (!p) return null;
    const g = Cesium.Cartographic.fromCartesian(p);
    return { longitude: Cesium.Math.toDegrees(g.longitude), latitude: Cesium.Math.toDegrees(g.latitude) };
  }
  const siteText = (at, extra = '') => `발생 지점: ${at.latitude.toFixed(4)}°, ${at.longitude.toFixed(4)}°${extra}`;
  async function start() {
    const at = site || centerSite();
    if (!at) { $('dx-site').textContent = '지도를 클릭해 발생 지점을 고르세요.'; return; }
    for (const t of Object.keys(TYPES)) if (t !== type && disasters.isActive(t)) disasters.stop(t);
    running = type; render();
    if ($('dx-skyauto').checked && DISASTER_SKY[type] && api.sky) api.sky(DISASTER_SKY[type]);
    await disasters.start({ type, longitude: at.longitude, latitude: at.latitude, intensity: 1, params: { ...params } });
    $('dx-site').textContent = siteText(at, site ? '' : ' (화면 가운데)');
  }
  function stop() { for (const t of Object.keys(TYPES)) if (disasters.isActive(t)) disasters.stop(t); running = null; render(); }

  /* 영역 그리기 (산불 · 홍수): 지도 클릭마다 꼭짓점, 완료하면 그 다각형이 피해 영역 */
  const DRAWABLE = ['wildfire', 'flood'];
  let drawing = false, verts = [], preview = [];
  const clearPreview = () => { for (const e of preview) e.destroy ? e.destroy() : viewer.entities.remove(e); preview = []; };
  function showPreview(list, closed) {
    clearPreview(); if (!list.length) return;
    const pos = list.map(([lo, la]) => Cesium.Cartesian3.fromDegrees(lo, la));
    for (const q of pos) preview.push(viewer.entities.add({ position: q, point: { pixelSize: 7, color: Cesium.Color.fromCssColorString('#ffd58a'), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
    if (pos.length > 1) preview.push(S.groundLine({ positions: closed ? [...pos, pos[0]] : pos, color: Cesium.Color.fromCssColorString('#ffd58a'), width: 3, dash: true }));
  }
  // 다각형 면적 (ha): 경위도를 그 자리 m로 펴서 신발끈 공식
  const polygonHa = poly => { const k = 111320 * Math.cos(poly[0][1] * Math.PI / 180); let a = 0; poly.forEach(([x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; a += (x * k) * (y2 * 110540) - (x2 * k) * (y * 110540); }); return Math.abs(a) / 2 / 1e4; };
  function setDrawing(on) {
    drawing = on; if (on) verts = [];
    $('dx-draw-note').hidden = !on; $('dx-draw-note').textContent = '지도를 클릭해 영역의 꼭짓점을 차례로 찍고 완료를 누르세요 (3개 이상).';
    if (!on) showPreview(params.polygon || [], true);
    render();
  }
  $('dx-draw').onclick = () => setDrawing(true);
  $('dx-draw-cancel').onclick = () => setDrawing(false);
  $('dx-draw-done').onclick = () => {
    if (verts.length < 3) { $('dx-draw-note').textContent = '꼭짓점을 3개 이상 찍어 주세요.'; return; }
    params.polygon = verts.slice();
    if (type === 'wildfire') params.area = Math.round(polygonHa(verts));
    if (!site) site = { longitude: verts.reduce((a, v) => a + v[0], 0) / verts.length, latitude: verts.reduce((a, v) => a + v[1], 0) / verts.length };
    setDrawing(false); render(true); start();
  };
  $('dx-draw-clear').onclick = () => { delete params.polygon; clearPreview(); render(true); if (running) start(); };

  window.addEventListener('korea-site-selected', e => {
    if (drawing) { verts.push([e.detail.longitude, e.detail.latitude]); showPreview(verts, false); $('dx-draw-note').textContent = `꼭짓점 ${verts.length}개` + (verts.length >= 3 ? ` · 약 ${polygonHa(verts).toFixed(1)} ha` : ''); return; }
    site = { longitude: e.detail.longitude, latitude: e.detail.latitude };
    $('dx-site').textContent = siteText(site, running ? '' : ' (적용을 누르세요)');
    if (running) start(); // 켜져 있으면 클릭한 곳으로 옮김 (산불 발화점 등)
  });

  let built = '';
  function render(rebuild) {
    const t = TYPES[type];
    root.querySelectorAll('.types button').forEach(b => b.classList.toggle('on', b.dataset.type === type));
    $('dx-desc').textContent = t.desc;
    if (rebuild || built !== type) {
      built = type; $('dx-params').innerHTML = '';
      for (const q of t.params) {
        const w = document.createElement('div');
        w.innerHTML = `<div class="row"><label></label><span><input type="number"><em></em></span></div><input type="range">`;
        const num = w.querySelector('input[type=number]'), rng = w.querySelector('input[type=range]');
        w.querySelector('label').textContent = q.label; w.querySelector('em').textContent = q.unit;
        for (const el of [num, rng]) Object.assign(el, { min: q.min, max: q.max, step: q.step, value: params[q.key] });
        num.id = 'dx-p-' + q.key; rng.id = 'dx-r-' + q.key; w.querySelector('label').htmlFor = num.id;
        const push = v => { params[q.key] = Math.min(q.max, Math.max(q.min, v)); num.value = rng.value = params[q.key]; if (running === type) disasters.setParams(type, { ...params }); render(); };
        rng.oninput = () => push(+rng.value);
        num.onchange = () => { if (num.value !== '' && Number.isFinite(+num.value)) push(+num.value); else num.value = params[q.key]; };
        $('dx-params').append(w);
      }
    }
    $('dx-out').innerHTML = '';
    for (const [k, v] of t.derive(params)) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; $('dx-out').append(dt, dd); }
    if (document.activeElement !== $('dx-json')) $('dx-json').value = JSON.stringify(data == null ? { type, params } : { type, params, data }, null, 2);
    $('dx-apply').textContent = running === type ? '다시 적용' : '적용';
    const WATERY = ['typhoon', 'tsunami', 'sealevel', 'flood'];
    $('dx-base-row').hidden = !WATERY.includes(type) || (type === 'flood' && !!params.polygon);
    $('dx-base').value = params.waterBase || (type === 'flood' ? 'point' : 'sea');
    const canDraw = DRAWABLE.includes(type);
    $('dx-draw').hidden = !canDraw || drawing; $('dx-draw-done').hidden = !drawing; $('dx-draw-cancel').hidden = !drawing; $('dx-draw-clear').hidden = !canDraw || !params.polygon || drawing;
    const areaIn = root.querySelector('#dx-p-area');
    if (areaIn) { const locked = !!params.polygon; areaIn.disabled = locked; root.querySelector('#dx-r-area').disabled = locked; areaIn.title = locked ? '그린 영역의 면적' : ''; }
  }
  $('dx-apply').onclick = start; $('dx-stop').onclick = stop;
  $('dx-base').onchange = e => { params.waterBase = e.target.value; if (running === type) disasters.setParams(type, { ...params }); render(); };
  $('dx-json-apply').onclick = () => {
    try { const j = JSON.parse($('dx-json').value); if (!TYPES[j.type] || j.type === 'none') throw new Error('type 오류'); api.set(j.type, j.params, j.site, j.data); }
    catch (e) { alert('JSON을 읽지 못했습니다: ' + e.message); }
  };
  // 효과가 진행 상황을 알려줌 (대설 경과 시간 등): 슬라이더 · 추정치만 갱신
  let lastProg = 0;
  S.onProgress = (key, v) => {
    if (running !== type || !(key in params)) return;
    params[key] = Math.round(v);
    const n = root.querySelector('#dx-p-' + key), r = root.querySelector('#dx-r-' + key);
    if (n && document.activeElement !== n) n.value = params[key];
    if (r && document.activeElement !== r) r.value = params[key];
    const now = performance.now(); if (now - lastProg > 400) { lastProg = now; render(); }
  };
  render(true);

  /* 하늘 · 물 탭 */
  const W = S.W;
  if (W) W.setEnabled(true);
  $('dx-realvis').onchange = e => { S.opt.realVis = e.target.checked; };
  $('dx-water').onchange = e => W && W.setEnabled(e.target.checked);
  fetch('../data/catalog.json').then(r => r.json()).then(cat => {
    for (const s2 of cat.skies) $('dx-sky').append(new Option(s2.name, s2.id));
    for (const s2 of cat.seas) $('dx-sea').append(new Option(s2.name, s2.id));
    const seaSky = Object.fromEntries(Object.values(cat.pairs).map(p2 => [p2.sea, p2.sky]));
    api.sky = id => { $('dx-sky').value = id || ''; S.setSky(id || null); };
    api.sea = id => {
      $('dx-sea').value = id || '';
      if (!W || !MA) return;
      const pr = id ? MA.get(seaSky[id]) : null, toC = h => Cesium.Color.fromCssColorString('#' + h.toString(16).padStart(6, '0'));
      if (pr && pr.deep != null) W.setColors(toC(pr.deep), toC(pr.shallow)); else W.setColors(new Cesium.Color(.04, .2, .27, 1), new Cesium.Color(.08, .32, .38, 1));
    };
    $('dx-sky').onchange = e => api.sky(e.target.value);
    $('dx-sea').onchange = e => api.sea(e.target.value);
  }).catch(e => console.warn('템플릿 목록', e));

  const api = {
    set(t, p = {}, at, extra) {
      type = t; params = { ...defaults(t), ...p }; if (at) site = at; if (extra !== undefined) data = extra;
      if (params.polygon && t === 'wildfire') params.area = Math.round(polygonHa(params.polygon)); // 그린 영역 면적
      showPreview(params.polygon || [], true);
      render(true); return start();
    },
    stop, get: () => ({ type: running, params: { ...params }, site, data }), effects: S,
    // 백엔드 구름: [{ id, longitude, latitude, base | baseAboveGround, width, height, depth?, speed, direction, precip?, rate?, darkness? }]
    clouds: { load: (list, origin) => S.C && S.C.load(list, origin), update: list => S.C && S.C.update(list), clear: () => S.C && S.C.clear() },
    sky: id => S.setSky(id || null), sea: () => {},
  };
  window.koreaDisaster = api;
  return api;
}
