/* 지도 위 재난 · 기후변화 패널
   - 재난 종류 · 입력값(숫자 칸 + 슬라이더 연동) · 간이 공식 추정치는 js/disaster.js(window.DisasterFX)를 그대로 씀
   - 발생 지점: 지도를 클릭한 곳 (korea-site-selected). 효과가 켜져 있으면 클릭한 곳으로 바로 옮김
   - API: window.koreaDisaster.set(type, params, { longitude, latitude }) · .stop() · .get() */
import { registerDisasterEffects } from './fx.js';

const CSS = `
#dx-panel [hidden]{display:none!important}
#dx-panel label.dx-check input{width:auto;margin:0;padding:0}
#dx-panel{position:absolute;z-index:3;top:12px;right:64px;width:min(320px,calc(100vw - 24px));max-height:calc(100dvh - 90px);overflow:auto;
  background:#101e1bf0;color:#e9f2ef;border:1px solid #3d5a51;border-radius:10px;padding:12px;font:13px/1.45 system-ui,sans-serif;box-sizing:border-box}
#dx-panel h2{margin:0 0 6px;font-size:14px}
#dx-panel .dx-sub{margin:0 0 8px;color:#a9bdb6;font-size:12px}
#dx-panel .dx-types{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
#dx-panel .dx-types button{background:#1b2f2a;color:#e9f2ef;border:1px solid #3d5a51;border-radius:7px;padding:6px 2px;font:inherit;font-size:12px;cursor:pointer}
#dx-panel .dx-types button i{display:block;font-style:normal;font-size:16px;line-height:1.2}
#dx-panel .dx-types button.on{border-color:#5ee6d0;background:#1f4740}
#dx-panel .dx-desc{color:#a9bdb6;font-size:12px;margin:8px 0}
#dx-panel .dx-row{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:6px}
#dx-panel .dx-row label{color:#c9d8d3;font-size:12px}
#dx-panel .dx-row span{display:flex;align-items:center;gap:4px}
#dx-panel input[type=number]{width:74px;background:#0b1513;color:#fff;border:1px solid #3d5a51;border-radius:5px;padding:3px 5px;text-align:right;font:12px ui-monospace,monospace;margin:0}
#dx-panel em{font-style:normal;color:#a9bdb6;font-size:11px;min-width:28px}
#dx-panel input[type=range]{width:100%;accent-color:#5ee6d0;margin:2px 0 0}
#dx-panel dl{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:4px 8px;margin:8px 0 0;font-size:12px;word-break:keep-all}
#dx-panel dt{color:#a9bdb6} #dx-panel dd{margin:0;text-align:right}
#dx-panel .dx-btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
#dx-panel .dx-btns button{background:#1b2f2a;color:#fff;border:1px solid #3d5a51;border-radius:6px;padding:5px 9px;font:inherit;cursor:pointer}
#dx-panel .dx-btns button.primary{background:#5ee6d0;color:#06231e;border-color:transparent;font-weight:600}
#dx-panel .dx-site{font-size:12px;color:#ffd58a;margin-top:6px}
#dx-panel .dx-note{font-size:11px;color:#8ea69e;margin:8px 0 0}
#dx-panel label.dx-check{display:flex;gap:6px;align-items:center;margin-top:8px;font-size:12px;color:#c9d8d3}
#dx-panel textarea{width:100%;box-sizing:border-box;background:#0b1513;color:#e9f2ef;border:1px solid #3d5a51;border-radius:6px;font:11px ui-monospace,monospace;margin-top:6px}
#dx-panel details summary{cursor:pointer;color:#a9bdb6;font-size:12px;margin-top:8px}
#dx-toggle{position:absolute;z-index:3;top:12px;right:64px;display:none;background:#101e1bf0;color:#fff;border:1px solid #3d5a51;border-radius:8px;padding:6px 10px;cursor:pointer;font:13px system-ui}
#dx-panel.closed{display:none} #dx-panel.closed + #dx-toggle{display:block}
`;

export function attachDisasterPanel({ viewer, Cesium, disasters }) {
  if (!window.DisasterFX) { console.warn('js/disaster.js가 없어 재난 패널을 만들지 않습니다.'); return null; }
  const { TYPES } = window.DisasterFX;
  const S = registerDisasterEffects(disasters, viewer, Cesium);
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const root = document.createElement('section'); root.id = 'dx-panel'; root.setAttribute('aria-label', '재난 · 기후변화');
  root.innerHTML = `<h2>재난 · 기후변화 <button type="button" id="dx-close" style="float:right;background:none;border:0;color:#a9bdb6;cursor:pointer;font-size:15px" aria-label="닫기">×</button></h2>
    <p class="dx-sub">지도를 클릭해 발생 지점을 고르고 재난을 선택하세요.</p>
    <div class="dx-types" id="dx-types"></div>
    <p class="dx-desc" id="dx-desc"></p>
    <div id="dx-params"></div>
    <div class="dx-site" id="dx-site">발생 지점: 화면 가운데</div>
    <div class="dx-btns" id="dx-draw-row" hidden><button type="button" id="dx-draw">영역 그리기</button><button type="button" id="dx-draw-done" hidden>완료</button><button type="button" id="dx-draw-cancel" hidden>취소</button><button type="button" id="dx-draw-clear" hidden>그린 영역 지우기</button></div>
    <p class="dx-note" id="dx-draw-note" hidden></p>
    <div class="dx-btns"><button type="button" class="primary" id="dx-apply">이 지점에 적용</button><button type="button" id="dx-stop">끄기</button></div>
    <label class="dx-check"><input type="checkbox" id="dx-ocean"> 바다 물결 (실제 해수면 높이)</label>
    <dl id="dx-out"></dl>
    <p class="dx-note" id="dx-sea"></p>
    <p class="dx-note">수치는 시각화용 간이 공식 추정치이고 화면 효과는 연출입니다. 실제 피해 계산이 아닙니다. 산불 확산 · 해일 · 눈 쌓임은 타임랩스로 압축합니다.</p>
    <details><summary>파라미터 JSON (API 연동용)</summary><textarea id="dx-json" rows="6" spellcheck="false"></textarea>
      <div class="dx-btns"><button type="button" id="dx-json-apply">JSON 적용</button></div></details>`;
  const toggle = document.createElement('button'); toggle.id = 'dx-toggle'; toggle.type = 'button'; toggle.textContent = '재난 · 기후변화';
  document.body.append(root, toggle);
  const $ = id => root.querySelector('#' + id);
  $('dx-close').onclick = () => root.classList.add('closed'); toggle.onclick = () => root.classList.remove('closed');

  let type = 'typhoon', params = {}, site = null, running = null, data = null;
  const defaults = t => Object.fromEntries(TYPES[t].params.map(q => [q.key, q.value]));
  params = defaults(type);

  for (const [k, t] of Object.entries(TYPES)) {
    if (k === 'none') continue;
    const b = document.createElement('button'); b.type = 'button'; b.dataset.type = k;
    b.innerHTML = '<i></i><span></span>'; b.firstChild.textContent = t.icon; b.lastChild.textContent = t.name;
    b.onclick = () => { if (type !== k) { type = k; params = defaults(k); clearPreview(); if (drawing) setDrawing(false); } render(true); if (running) start(); };
    $('dx-types').append(b);
  }

  function centerSite() {
    const c = viewer.scene.canvas, ray = viewer.camera.getPickRay(new Cesium.Cartesian2(c.clientWidth / 2, c.clientHeight / 2));
    const p = ray && viewer.scene.globe.pick(ray, viewer.scene); if (!p) return null;
    const g = Cesium.Cartographic.fromCartesian(p);
    return { longitude: Cesium.Math.toDegrees(g.longitude), latitude: Cesium.Math.toDegrees(g.latitude) };
  }
  async function start() {
    const at = site || centerSite();
    if (!at) { $('dx-site').textContent = '지도를 클릭해 발생 지점을 고르세요.'; return; }
    for (const t of Object.keys(TYPES)) if (t !== type && disasters.isActive(t)) disasters.stop(t);
    running = type;
    await disasters.start({ type, longitude: at.longitude, latitude: at.latitude, intensity: 1, params: { ...params } });
    $('dx-site').textContent = `발생 지점: ${at.latitude.toFixed(4)}°, ${at.longitude.toFixed(4)}°` + (site ? '' : ' (화면 가운데)');
    setTimeout(showSea, 800);
  }
  function stop() { for (const t of Object.keys(TYPES)) if (disasters.isActive(t)) disasters.stop(t); running = null; render(); }
  const showSea = () => { $('dx-sea').textContent = S.seaLevel == null ? '' : `해수면 기준: 지도 높이 ${S.seaLevel.toFixed(1)} m (선택 지점 둘레 바다의 지도 높이)`; };

  /* 영역 그리기 (산불 · 홍수): 지도 클릭마다 꼭짓점, 완료하면 그 다각형이 피해 영역 */
  const DRAWABLE = ['wildfire', 'flood'];
  let drawing = false, verts = [], preview = [];
  const clearPreview = () => { for (const e of preview) viewer.entities.remove(e); preview = []; };
  function showPreview(list, closed) {
    clearPreview(); if (!list.length) return;
    const pos = list.map(([lo, la]) => Cesium.Cartesian3.fromDegrees(lo, la));
    for (const q of pos) preview.push(viewer.entities.add({ position: q, point: { pixelSize: 7, color: Cesium.Color.fromCssColorString('#ffd58a'), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
    if (pos.length > 1) preview.push(viewer.entities.add({ polyline: { positions: closed ? [...pos, pos[0]] : pos, clampToGround: true, width: 3, material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString('#ffd58a') }) } }));
  }
  // 다각형 면적 (ha): 경위도를 그 자리 m로 펴서 신발끈 공식
  const polygonHa = poly => { const la0 = poly[0][1] * Math.PI / 180, k = 111320 * Math.cos(la0); let a = 0; poly.forEach(([x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; a += (x * k) * (y2 * 110540) - (x2 * k) * (y * 110540); }); return Math.abs(a) / 2 / 1e4; };
  function setDrawing(on) {
    drawing = on; if (on) verts = [];
    $('dx-draw').hidden = on; $('dx-draw-done').hidden = !on; $('dx-draw-cancel').hidden = !on;
    $('dx-draw-note').hidden = !on; $('dx-draw-note').textContent = '지도를 클릭해 영역의 꼭짓점을 차례로 찍고 완료를 누르세요 (3개 이상).';
    if (!on) showPreview(params.polygon || [], true);
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
    $('dx-site').textContent = `발생 지점: ${site.latitude.toFixed(4)}°, ${site.longitude.toFixed(4)}°` + (running ? '' : ' (적용을 누르세요)');
    if (running) start(); // 켜져 있으면 클릭한 곳으로 옮김 (산불 발화점 등)
  });

  let built = '';
  function render(rebuild) {
    const t = TYPES[type];
    root.querySelectorAll('.dx-types button').forEach(b => b.classList.toggle('on', b.dataset.type === type));
    $('dx-desc').textContent = t.desc;
    if (rebuild || built !== type) {
      built = type; $('dx-params').innerHTML = '';
      for (const q of t.params) {
        const w = document.createElement('div');
        w.innerHTML = `<div class="dx-row"><label></label><span><input type="number"><em></em></span></div><input type="range">`;
        const num = w.querySelector('input[type=number]'), rng = w.querySelector('input[type=range]');
        w.querySelector('label').textContent = q.label; w.querySelector('em').textContent = q.unit;
        for (const el of [num, rng]) Object.assign(el, { min: q.min, max: q.max, step: q.step, value: params[q.key] });
        num.id = 'dx-p-' + q.key; w.querySelector('label').htmlFor = num.id;
        const push = v => { params[q.key] = Math.min(q.max, Math.max(q.min, v)); num.value = rng.value = params[q.key]; if (running === type) disasters.setParams(type, { ...params }); render(); };
        rng.oninput = () => push(+rng.value);
        num.onchange = () => { if (num.value !== '' && Number.isFinite(+num.value)) push(+num.value); else num.value = params[q.key]; };
        $('dx-params').append(w);
      }
    }
    $('dx-out').innerHTML = '';
    for (const [k, v] of t.derive(params)) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; $('dx-out').append(dt, dd); }
    if (document.activeElement !== $('dx-json')) $('dx-json').value = JSON.stringify(data == null ? { type, params } : { type, params, data }, null, 2);
    $('dx-apply').textContent = running === type ? '다시 적용' : '이 지점에 적용';
    $('dx-draw-row').hidden = !DRAWABLE.includes(type); $('dx-draw-clear').hidden = !params.polygon || drawing;
    const areaIn = root.querySelector('#dx-p-area');
    if (areaIn) { const locked = !!params.polygon; areaIn.disabled = locked; areaIn.closest('div').nextElementSibling.disabled = locked; if (locked) areaIn.title = '그린 영역의 면적'; }
  }
  $('dx-apply').onclick = start; $('dx-stop').onclick = stop;
  $('dx-ocean').onchange = e => S.setOcean(e.target.checked);
  $('dx-json-apply').onclick = () => {
    try { const j = JSON.parse($('dx-json').value); if (!TYPES[j.type] || j.type === 'none') throw new Error('type 오류'); api.set(j.type, j.params, j.site, j.data); }
    catch (e) { alert('JSON을 읽지 못했습니다: ' + e.message); }
  };
  render(true);

  const api = {
    set(t, p = {}, at, extra) {
      type = t; params = { ...defaults(t), ...p }; if (at) site = at; if (extra !== undefined) data = extra;
      if (params.polygon && t === 'wildfire') params.area = Math.round(polygonHa(params.polygon)); // 그린 영역 면적
      showPreview(params.polygon || [], true);
      render(true); return start();
    },
    stop, get: () => ({ type: running, params: { ...params }, site, data }), effects: S,
  };
  window.koreaDisaster = api;
  return api;
}
