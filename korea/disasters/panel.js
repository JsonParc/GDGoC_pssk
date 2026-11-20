/* 지도 위 재난 · 기후변화 패널 (왼쪽, 접을 수 있음)
   탭 [재난]: 재난 종류 · 발생 지점(지도 클릭) · 영역 그리기(산불 · 홍수) · 입력값(숫자 칸 + 슬라이더) · 추정치 · JSON
   탭 [하늘 · 물]: 하늘 템플릿(템플릿 뷰어의 하늘 15종) · 바다 색 템플릿 · 바다/강 물 표면
   재난 정의 · 간이 공식은 js/disaster.js(window.DisasterFX), 하늘 · 바다 값은 js/atmosphere.js(window.MapAtmosphere)
   API: window.koreaDisaster.set(type, params, { longitude, latitude }, data) · .stop() · .get() · .sky(id) · .sea(id) */
import { registerDisasterEffects } from './fx.js';
import { attachCardList } from './cards.js';
import { makeDraggable, makeWindow } from './draggable.js';

const CSS = `
#dx-panel.closed,#dx-open.closed{display:none!important}
#dx-panel{position:absolute;z-index:3;top:var(--map-panel-top,60px);left:12px;width:min(300px,calc(100vw - 24px));max-height:calc(100dvh - 190px);display:flex;flex-direction:column;
  background:#202c2c;color:#f1f5f0;border:1px solid #425552;border-radius:12px;font-size:13.75px;line-height:1.45;box-shadow:0 6px 24px #0006;box-sizing:border-box}
#dx-panel *{box-sizing:border-box}
#dx-panel [hidden]{display:none!important}
#dx-panel header{display:flex;align-items:center;gap:6px;padding:10px 12px 0}
#dx-panel header b{flex:1;font-size:15.5px}
#dx-panel header button{background:none;border:0;color:#b5c5bf;cursor:pointer;font-size:16px;padding:0 2px;width:auto}
#dx-panel #dx-close{min-width:38px;min-height:38px;border-radius:8px;font:26px/1 system-ui,sans-serif}
#dx-panel #dx-close:hover{background:#314440}
#dx-panel .tabs{display:flex;gap:4px;padding:8px 12px 0}
#dx-panel .tabs button{flex:1;background:none;border:1px solid #425552;color:#b5c5bf;border-radius:7px;padding:5px 0;font:inherit;cursor:pointer;width:auto}
#dx-panel .tabs button.on{background:#314440;border-color:#92d5bb;color:#fff}
#dx-panel .body{overflow:auto;padding:8px 12px 12px}
#dx-panel h3{margin:10px 0 5px;font-size:11px;font-weight:600;color:#acbeb6;letter-spacing:.04em}
#dx-panel .types{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
#dx-panel .types button{background:#293a37;color:#f1f5f0;border:1px solid #41534e;border-radius:7px;padding:5px 1px 4px;font:inherit;font-size:11px;cursor:pointer;line-height:1.2;width:auto;margin:0}
#dx-panel .types button i{display:block;font-style:normal;font-size:15px}
#dx-panel .types button.on{border-color:#92d5bb;background:#314440}
#dx-panel .site{display:flex;align-items:center;gap:6px;margin-top:8px;padding:6px 8px;border-radius:7px;background:#293a37;font-size:12px}
#dx-panel .site span{flex:1;color:#e9f1ec}
#dx-panel .btns{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}
#dx-panel .btns button{background:#293a37;color:#fff;border:1px solid #425552;border-radius:6px;padding:5px 9px;font:inherit;cursor:pointer;width:auto;margin:0}
#dx-panel .btns button.primary{background:#92d5bb;color:#152e27;border-color:transparent;font-weight:600}
#dx-panel .row{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:7px}
#dx-panel .row label{color:#dae6df;font-size:12px}
#dx-panel .row span{display:flex;align-items:center;gap:3px}
#dx-panel input[type=number]{width:73px;background:#182624;color:#fff;border:1px solid #425552;border-radius:5px;padding:2px 5px;text-align:right;font:13px ui-monospace,monospace;margin:0}
#dx-panel input[type=number]:disabled{opacity:.55}
#dx-panel em{font-style:normal;color:#acbeb6;font-size:11px;min-width:26px}
#dx-panel input[type=range]{width:100%;accent-color:#92d5bb;margin:2px 0 0;padding:0;height:16px}
#dx-panel dl{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:3px 8px;margin:0;font-size:12px;word-break:keep-all}
#dx-panel dt{color:#b5c5bf} #dx-panel dd{margin:0;text-align:right}
#dx-panel .note{font-size:11px;color:#a9bbb3;margin:8px 0 0}
#dx-panel details{margin-top:8px} #dx-panel summary{cursor:pointer;color:#b5c5bf;font-size:12px}
#dx-panel textarea{width:100%;background:#182624;color:#f1f5f0;border:1px solid #425552;border-radius:6px;font:11px ui-monospace,monospace;margin-top:6px}
#dx-panel select{width:100%;background:#182624;color:#fff;border:1px solid #425552;border-radius:6px;padding:5px;font:inherit;margin:0}
#dx-panel label.check{display:flex;gap:6px;align-items:center;margin-top:8px;color:#dae6df}
#dx-panel label.check input{width:auto;margin:0}
#dx-panel .tag{font-size:10px;color:#ffb547;border:1px solid #ffb54766;border-radius:4px;padding:0 4px;margin-left:4px;font-weight:500}
#dx-open{position:absolute;z-index:5;top:var(--map-panel-top,60px);left:12px;background:#202c2c;color:#fff;border:1px solid #425552;border-radius:9px;padding:7px 11px;cursor:pointer;font:inherit;font-size:13px;font-weight:600;width:auto;min-height:36px}
#dx-panel{--accent:linear-gradient(90deg,#b4d29a,#99d2ad 55%,#7fc3b6);color-scheme:dark;width:min(var(--map-side-panel-width,337px),calc(100vw - 24px));max-height:calc(100dvh - 108px);border-radius:15px}
#dx-panel header{padding:15px 18px 5px}
#dx-panel .tabs{gap:0;margin:8px 18px 0;padding:0;border-bottom:1px solid #425552}
#dx-panel .tabs button{position:relative;border:0;border-radius:0;padding:11px 0 13px}
#dx-panel .tabs button.on{background:none;color:#fff;font-weight:700}
#dx-panel .tabs button.on::after{content:"";position:absolute;inset:auto 0 -1px;height:2px;background:var(--accent)}
#dx-panel .body{flex:1 1 auto;min-height:0;padding:0 18px 15px;scrollbar-width:none}
#dx-panel h3{margin:15px 0 9px;font-weight:700;letter-spacing:normal}
#dx-panel .types{grid-template-columns:repeat(2,minmax(0,1fr))}
#dx-panel .types button{position:relative;display:flex;align-items:center;gap:8px;min-height:40px;padding:9px 10px;text-align:left;background:none;border:0;font:inherit}
#dx-panel .types button i{min-width:20px;text-align:center}
#dx-panel .types button:hover,#dx-panel .types button.on{background:#314440;color:#fff}
#dx-panel .types button.on{font-weight:700}
#dx-panel .types button.on::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:2px;background:linear-gradient(#b4d29a,#7fc3b6);border-radius:2px}
#dx-panel .group{margin-top:15px;padding-top:1px;border-top:1px solid #364943}
#dx-panel .site{margin:0;padding:11px 13px;border-radius:9px;background:#182624;overflow-wrap:anywhere}
#dx-tap-hint{display:none;position:fixed;z-index:5;top:50%;left:50%;pointer-events:none}
#dx-tap-hint::before,#dx-tap-hint::after{content:"";position:absolute;inset:-14px auto auto -14px;width:28px;height:28px;
  box-sizing:border-box;border:2px solid #b9f5e2;border-radius:50%;box-shadow:0 0 4px #13231c80;opacity:0}
#dx-tap-hint svg{position:absolute;z-index:1;top:-7px;left:-16px;width:44px;height:50px;
  transform-origin:16px 7px;filter:drop-shadow(0 2px 3px #13231cd9);opacity:0}
.dx-site-ripple{display:none;position:fixed;z-index:5;width:44px;height:44px;box-sizing:border-box;translate:-50% -50%;
  border:2px solid #b9f5e2;border-radius:50%;box-shadow:0 0 0 1px #13231c80;pointer-events:none}
@media(prefers-reduced-motion:no-preference){
  #dx-tap-hint:not([hidden]){display:block}
  #dx-tap-hint:not([hidden]) svg{animation:dx-tap-gesture 1.5s ease-in-out .25s 2}
  #dx-tap-hint:not([hidden])::before{animation:dx-tap-ripple 1.5s ease-out .25s 2}
  #dx-tap-hint:not([hidden])::after{animation:dx-tap-ripple 1.5s ease-out .38s 2}
  .dx-site-ripple{display:block;animation:dx-site-confirm 440ms cubic-bezier(.18,.65,.25,1) both}
}
@keyframes dx-site-confirm{
  0%{opacity:1;scale:.25;background:#b9f5e266}
  40%{opacity:.9;background:transparent}
  100%{opacity:0;scale:1.45;background:transparent}
}
@keyframes dx-tap-gesture{
  0%,100%{opacity:0;transform:translate(9px,13px) rotate(-8deg)}
  20%,74%{opacity:1;transform:translate(4px,7px) rotate(-4deg)}
  42%,51%{opacity:1;transform:scale(.94)}
}
@keyframes dx-tap-ripple{
  0%,40%,100%{opacity:0;transform:scale(.36)}
  44%{opacity:.88;transform:scale(.5)}
  78%{opacity:0;transform:scale(1.85)}
}
#dx-panel .btns button{background:transparent;border-radius:999px;padding:7px 12px}
#dx-panel .actions{flex-shrink:0;margin:0;padding:12px 18px;border-top:1px solid #425552;gap:8px}
#dx-panel .btns button.primary{flex:1;background:var(--accent);font-weight:750}
#dx-panel input[type=range]{appearance:none;margin:10px 0 5px;padding:0;height:4px;border:0;border-radius:5px;background:var(--accent) left/var(--progress,0%) 100% no-repeat,#435950;cursor:pointer}
#dx-panel input[type=range]::-webkit-slider-thumb{appearance:none;width:13px;height:13px;border:2px solid #81c6ad;border-radius:50%;background:#fff;box-shadow:0 0 0 3px #81c6ad3a}
#dx-panel input[type=range]::-moz-range-thumb{width:10px;height:10px;border:2px solid #81c6ad;border-radius:50%;background:#fff}
#dx-panel :is(button,input,select,summary):focus-visible{outline:2px solid #a5e2cc;outline-offset:2px}
@media(max-width:860px){#dx-panel{max-height:calc(48dvh - 70px)}}
`;

export function attachDisasterPanel({ viewer, Cesium, disasters, eventRegion }) {
  if (!window.DisasterFX) { console.warn('js/disaster.js가 없어 재난 패널을 만들지 않습니다.'); return null; }
  const { TYPES } = window.DisasterFX, MA = window.MapAtmosphere;
  const S = registerDisasterEffects(disasters, viewer, Cesium);
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const root = document.createElement('section'); root.id = 'dx-panel'; root.setAttribute('aria-label', '재난 · 기후변화');
  root.innerHTML = `
    <header><b>재난·기후변화 시뮬레이션</b><button type="button" id="dx-close" aria-label="패널 접기" title="접기">‹</button></header>
    <div class="tabs"><button type="button" class="on" data-tab="dx-tab-disaster">재난</button><button type="button" data-tab="dx-tab-env">하늘 · 물</button></div>
    <div class="body">
      <div id="dx-tab-disaster">
        <h3>재난 종류</h3><div class="types" id="dx-types"></div>
        <div class="group"><h3>발생 지점</h3><div class="site"><span id="dx-site" role="status">지도에서 지점 선택</span></div></div>
        <div class="btns">
          <button type="button" id="dx-draw" hidden>영역 그리기</button><button type="button" id="dx-draw-done" hidden>완료</button><button type="button" id="dx-draw-cancel" hidden>취소</button><button type="button" id="dx-draw-clear" hidden>영역 지우기</button></div>
        <p class="note" id="dx-draw-note" hidden></p>
        <div class="group" id="dx-base-row" hidden><h3>물 기준</h3><select id="dx-base" aria-label="물 기준"><option value="sea">근처 해수면 기준</option><option value="point">선택 지점 지면 기준</option></select>
          <p class="note" id="dx-base-note" hidden></p>
        </div>
        <div class="group"><h3>입력값</h3><div id="dx-params"></div></div>
        <div class="group"><h3>추정치 <span class="tag">간이 공식</span></h3><dl id="dx-out"></dl></div>
        <details><summary>파라미터 JSON</summary><textarea id="dx-json" rows="6" spellcheck="false"></textarea>
          <div class="btns"><button type="button" id="dx-json-apply">JSON 적용</button></div></details>
      </div>
      <div id="dx-tab-env" hidden>
        <h3>하늘</h3><select id="dx-sky" aria-label="하늘"><option value="">브이월드 기본 하늘</option></select>
        <label class="check"><input type="checkbox" id="dx-skyauto" checked> 재난에 맞는 하늘로 자동 바꾸기</label>
        <h3>날씨 보이기</h3>
        <label class="check"><input type="checkbox" id="dx-realvis"> 실제 시정 적용</label>
        <h3>바다 · 강</h3>
        <label class="check"><input type="checkbox" id="dx-water" checked> 물 표면 표시</label>
        <select id="dx-sea" aria-label="바다 색" style="margin-top:8px"><option value="">기본 바다 색</option></select>
        <p class="note">물 데이터 © OpenMapTiles · © OpenStreetMap contributors</p>
      </div>
    </div>
    <div class="btns actions" id="dx-actions"><button type="button" class="primary" id="dx-apply">적용</button><button type="button" id="dx-pause" hidden aria-pressed="false" title="쌓임 · 번짐 · 파도 진행만 멈춤 (눈 · 비는 계속 내림)">⏸ 멈춤</button><button type="button" id="dx-stop">끄기</button></div>`;
  const opener = document.createElement('button'); opener.id = 'dx-open'; opener.type = 'button';
  opener.innerHTML = '재난 · 기후변화 <span aria-hidden="true">›</span>'; opener.classList.add('closed');
  const tapHint = document.createElement('div'); tapHint.id = 'dx-tap-hint'; tapHint.hidden = true;
  tapHint.setAttribute('aria-hidden', 'true');
  tapHint.innerHTML = `<svg viewBox="0 0 44 50" focusable="false">
    <path d="M12 31V11a4 4 0 0 1 8 0v13a3.8 3.8 0 0 1 7.6 0v2a3.6 3.6 0 0 1 7.2 0v2a3.3 3.3 0 0 1 6.6 0v6c0 8.4-5.8 13.5-13.8 13.5h-2.8c-4.4 0-7.4-1.6-10.3-4.5L4 33a4 4 0 0 1 5.5-5.8L12 31Z"
      fill="#18312d" fill-opacity=".78" stroke="#f3fff9" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
  document.body.append(root, opener, tapHint);
  const $ = id => root.querySelector('#' + id);
  makeWindow(root, root.querySelector('header'), 'dx-panel-pos'); // 안쪽을 끌어 옮기고 테두리를 끌어 크기 조절 (앱 창처럼)
  makeDraggable(opener, opener, 'dx-opener-pos');
  // 접기 / 펴기 (hidden 속성은 display 규칙에 덮여서 클래스로)
  function setOpen(open) {
    root.classList.toggle('closed', !open);
    opener.classList.toggle('closed', open);
    if (!open) stopTapHint();
  }
  $('dx-close').onclick = () => {
    setOpen(false);
    opener.focus({ preventScroll: true });
  };
  opener.onclick = () => {
    setOpen(true);
    $('dx-close').focus({ preventScroll: true });
  };
  root.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    root.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    for (const id of ['dx-tab-disaster', 'dx-tab-env']) $(id).hidden = id !== b.dataset.tab;
    $('dx-actions').hidden = b.dataset.tab !== 'dx-tab-disaster';
    if (b.dataset.tab !== 'dx-tab-disaster') stopTapHint();
  });

  let type = 'typhoon', params = {}, site = null, running = null, data = null;
  let activeCard = null, runRequest = null;
  let automaticSky = null, previousSky = null;
  // 재난 → 하늘 템플릿 (템플릿 뷰어의 하늘 사진). 지진 · 해일은 하늘을 바꾸지 않음
  const TIMELAPSE = ['snow', 'wildfire', 'tsunami', 'quake']; // 진행 멈춤 버튼을 보이는 재난
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
  function stopTapHint() { tapHint.hidden = true; }
  const siteText = (at, extra = '') => `발생 지점: ${at.latitude.toFixed(4)}°, ${at.longitude.toFixed(4)}°${extra}`;
  async function start(card = null) {
    const at = site || centerSite();
    if (!at) { $('dx-site').textContent = '지도를 클릭해 발생 지점을 고르세요.'; return; }
    stopTapHint(); S.setPaused?.(false); // 새로 적용하면 진행 멈춤 풀림
    for (const t of Object.keys(TYPES)) if (t !== type) disasters.stop(t);
    const request = {};
    runRequest = request;
    running = type;
    activeCard = card ? { ...card, pending: true } : null;
    render(); api.cards?.syncSimulation();
    if ($('dx-skyauto').checked && DISASTER_SKY[type]) {
      if (!automaticSky || S.sky !== automaticSky) previousSky = S.sky;
      automaticSky = DISASTER_SKY[type];
      api.sky(automaticSky);
    }
    const runType = type;
    try {
      await disasters.start({ type: runType, longitude: at.longitude, latitude: at.latitude, intensity: 1, params: { ...params } });
    } catch (error) {
      if (runRequest !== request) return false;
      stop();
      throw error;
    }
    if (runRequest !== request || !disasters.isActive(runType)) return false;
    if (activeCard) activeCard.pending = false;
    api.cards?.syncSimulation();
    $('dx-site').textContent = siteText(at, site ? '' : ' (화면 가운데)');
    return true;
  }
  function stop() {
    runRequest = null; S.setPaused?.(false);
    for (const t of Object.keys(TYPES)) disasters.stop(t);
    if (automaticSky && S.sky === automaticSky) api.sky(previousSky);
    automaticSky = null;
    running = null; activeCard = null;
    render(); api.cards?.syncSimulation();
  }

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
    if (on) stopTapHint();
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

  let siteRipple;
  window.addEventListener('korea-site-selected', e => {
    const { screen } = e.detail;
    if (screen && matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      siteRipple?.remove();
      const ripple = document.createElement('span');
      ripple.className = 'dx-site-ripple';
      ripple.setAttribute('aria-hidden', 'true');
      ripple.style.left = screen.x + 'px';
      ripple.style.top = screen.y + 'px';
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
      ripple.addEventListener('animationcancel', () => ripple.remove(), { once: true });
      document.body.append(ripple);
      siteRipple = ripple;
    }
    if (drawing) { verts.push([e.detail.longitude, e.detail.latitude]); showPreview(verts, false); $('dx-draw-note').textContent = `꼭짓점 ${verts.length}개` + (verts.length >= 3 ? ` · 약 ${polygonHa(verts).toFixed(1)} ha` : ''); return; }
    selectSite(e.detail);
  });
  function selectSite({ longitude, latitude }) {
    site = { longitude, latitude };
    stopTapHint();
    $('dx-site').textContent = siteText(site, running ? '' : ' (적용을 누르세요)');
    if (running) start(activeCard); // 켜져 있으면 클릭한 곳으로 옮김 (산불 발화점 등)
  }

  let built = '';
  function render(rebuild) {
    const t = TYPES[type];
    root.querySelectorAll('.types button').forEach(b => b.classList.toggle('on', b.dataset.type === type));
    if (rebuild || built !== type) {
      built = type; $('dx-params').innerHTML = '';
      for (const q of t.params) {
        if (params.snowDepthCm != null && ['rate', 'hours', 'melt', 'time'].includes(q.key)) continue;
        if (params.waterDepthM != null && ['hours', 'drain'].includes(q.key)) continue;
        const w = document.createElement('div');
        w.innerHTML = `<div class="row"><label></label><span><input type="number"><em></em></span></div><input type="range">`;
        const num = w.querySelector('input[type=number]'), rng = w.querySelector('input[type=range]');
        w.querySelector('label').textContent = q.label; w.querySelector('em').textContent = q.unit;
        for (const el of [num, rng]) Object.assign(el, { min: q.min, max: q.max, step: q.step, value: params[q.key] });
        num.id = 'dx-p-' + q.key; rng.id = 'dx-r-' + q.key; w.querySelector('label').htmlFor = num.id;
        rng.setAttribute('aria-label', q.label);
        const push = v => { params[q.key] = Math.min(q.max, Math.max(q.min, v)); num.value = rng.value = params[q.key]; if (running === type) disasters.setParams(type, { ...params }); render(); };
        rng.oninput = () => push(+rng.value);
        num.onchange = () => { if (num.value !== '' && Number.isFinite(+num.value)) push(+num.value); else num.value = params[q.key]; };
        $('dx-params').append(w);
      }
    }
    for (const slider of $('dx-params').querySelectorAll('input[type=range]')) {
      slider.style.setProperty('--progress', `${100 * (slider.valueAsNumber - +slider.min) / (+slider.max - +slider.min)}%`);
    }
    $('dx-out').innerHTML = '';
    for (const [k, v] of t.derive(params)) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; $('dx-out').append(dt, dd); }
    if (document.activeElement !== $('dx-json')) $('dx-json').value = JSON.stringify(data == null ? { type, params } : { type, params, data }, null, 2);
    $('dx-apply').textContent = running === type ? '다시 적용' : '적용';
    // 진행 멈춤: 시간에 따라 진행하는 재난만 (대설 쌓임 · 산불 번짐 · 해일 파도 · 지진 흔들림)
    $('dx-pause').hidden = !(running === type && TIMELAPSE.includes(type));
    $('dx-pause').textContent = S.paused ? '▶ 이어서' : '⏸ 멈춤';
    $('dx-pause').setAttribute('aria-pressed', String(S.paused));
    const WATERY = ['typhoon', 'tsunami', 'sealevel', 'flood']; // 해일은 기준과 상관없이 바다에서 밀려 들어옴 (기준은 수위만 정함)
    $('dx-base-row').hidden = !WATERY.includes(type) || (type === 'flood' && !!params.polygon);
    $('dx-base').value = params.waterBase || (type === 'flood' ? 'point' : 'sea');
    $('dx-base-note').hidden = type !== 'tsunami';
    $('dx-base-note').textContent = type !== 'tsunami' ? ''
      : $('dx-base').value === 'point' ? '바다에서 밀려 들어와, 가장 높을 때 선택 지점이 파고 × 처오름만큼 잠깁니다.'
      : '바다에서 밀려 들어와, 해안 수위가 파고 × 처오름만큼 오릅니다.';
    const canDraw = DRAWABLE.includes(type);
    $('dx-draw').hidden = !canDraw || drawing; $('dx-draw-done').hidden = !drawing; $('dx-draw-cancel').hidden = !drawing; $('dx-draw-clear').hidden = !canDraw || !params.polygon || drawing;
    const areaIn = root.querySelector('#dx-p-area');
    if (areaIn) { const locked = !!params.polygon; areaIn.disabled = locked; root.querySelector('#dx-r-area').disabled = locked; areaIn.title = locked ? '그린 영역의 면적' : ''; }
  }
  $('dx-apply').onclick = () => start(); $('dx-stop').onclick = stop;
  $('dx-pause').onclick = () => { S.setPaused?.(!S.paused); render(); };
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
  tapHint.hidden = false;

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
    api.sky('tropic-zenith'); // 기본 하늘: 열대 정오
    $('dx-sea').onchange = e => api.sea(e.target.value);
  }).catch(e => console.warn('템플릿 목록', e));

  const api = {
    set(t, p = {}, at, extra) {
      type = t; params = { ...defaults(t), ...p }; if (at) site = at; if (extra !== undefined) data = extra;
      if (params.polygon && t === 'wildfire') params.area = Math.round(polygonHa(params.polygon)); // 그린 영역 면적
      showPreview(params.polygon || [], true);
      render(true); return start(extra?.cardId != null ? { id: String(extra.cardId), title: extra.title } : null);
    },
    stop, setOpen, get: () => ({ type: running, params: { ...params }, site, data, activeCard, drawing }), effects: S,
    // 백엔드 구름: [{ id, longitude, latitude, base | baseAboveGround, width, height, depth?, speed, direction, precip?, rate?, darkness? }]
    clouds: { load: (list, origin) => S.C && S.C.load(list, origin), update: list => S.C && S.C.update(list), clear: () => S.C && S.C.clear() },
    sky: id => S.setSky(id || null), sea: () => {},
  };
  window.koreaDisaster = api;
  try { api.cards = attachCardList({ viewer, Cesium, panel: api, initialRegion: eventRegion }); } catch (e) { console.warn('재난 사건 목록', e); } // 오른쪽 재난 사건 목록 (백엔드 API)
  return api;
}
