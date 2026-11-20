/* 지역 변화 분석 (재난 사건 창의 '지역 분석' 탭) — 백엔드 JsonParc/GDGoC_TUK_pssk_backend app/regions.py
   지도를 클릭하거나 장소를 검색해 고른 지점의 지역 이력을 그때 분석함 (전국을 미리 모으지 않음).
   1. GET  /api/disasters/nearby?lat&lon&radius_km  이미 있는 근처 재난 카드 (바로)
   2. 브이월드 주소 변환으로 지역 이름 ("서울특별시 강남구 대치동", 직접 고칠 수 있음)
   3. POST /api/regions/analyze  캐시가 있으면 바로 결과, 없으면 job_id → GET /api/analysis/{job} 2.5초마다 (최대 5분, 무한 로딩 없음)
   4. 결과: 날짜순 이력(출처 · 근거 확인 여부 · 상태 충돌) · 재난 항목은 지도 재현 / 재난 카드로 저장
            홍수 전 · 후: 같은 위치 · 비 · 시간에서 배수 능력만 바꿔 koreaDisaster.set('flood', …)으로 전환
   기사 근거 + 가정 기반 비교이고 실제 침수 예측이 아님. 준공이 확인된 배수 시설이 없으면 비교를 막고, 사용자가 '가정 시나리오'를 고를 때만 엶 */
import {
  jobState, gaveUp, errorMessage, timelineView, scenarioView, changeView, onlyDrainDiffers, regionNameFromAddress, inKoreaPoint, POLL_MS, STAGE_LABEL,
  facilityScenario, FACILITY_LEVELS, STATUS_LABEL, CHANGE_LABEL,
} from './region-model.js';
import { reverseGeocode, findMapPlaces } from '../location-search.js';
import { articleEffect } from './article-effect.js';
import { flyToSite, cameraIsHigh, UNDER_CLOUD } from './camera.js';

const STYLE = `
#ev-region-box{display:flex;flex-direction:column;gap:12px;padding:4px 4px 8px}
#ev-region-box h4{margin:0 0 6px;font-size:12px;color:#acbeb6;letter-spacing:.02em}
#ev-region-box .ra-sec{border-top:1px solid #364943;padding-top:10px}
#ev-region-box .ra-sec:first-child{border-top:0;padding-top:0}
#ev-region-box .ra-point{font-size:12px;color:#b5c5bf}
#ev-region-box .ra-row{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}
#ev-region-box input[type=text]{flex:1;min-width:0;background:#182624;color:#f1f5f0;border:1px solid #50655d;border-radius:8px;padding:7px 9px;font:inherit}
#ev-region-box select{background:#253633;color:#f1f5f0;border:1px solid #50655d;border-radius:8px;padding:6px 8px;font:inherit}
#ev-region-box button{background:#293a37;color:#fff;border:1px solid #425552;border-radius:7px;padding:6px 10px;cursor:pointer;font:inherit}
#ev-region-box button.primary{background:var(--accent);color:#152e27;border-color:transparent;font-weight:700}
#ev-region-box button:disabled{opacity:.45;cursor:default}
#ev-region-box button[aria-pressed=true]{background:#38534a;border-color:#92d5bb}
#ev-region-box .ra-bar{height:6px;border-radius:4px;background:#2c3d39;overflow:hidden;margin:6px 0}
#ev-region-box .ra-bar i{display:block;height:100%;background:var(--accent);transition:width .4s ease}
#ev-region-box .ra-steps{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11.5px;color:#7f948c}
#ev-region-box .ra-steps .on{color:#f1f5f0;font-weight:700} #ev-region-box .ra-steps .ok{color:#92d5bb}
#ev-region-box .ra-err{color:#ffb4a2}
#ev-region-box .ra-near{display:grid;gap:4px}
#ev-region-box .ra-near button{text-align:left;background:transparent;border-color:#364943}
#ev-region-box .ra-item{border:1px solid #364943;border-radius:10px;padding:9px 10px;margin-top:8px}
#ev-region-box .ra-item .top{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11.5px}
#ev-region-box .ra-badge{border:1px solid;border-radius:5px;padding:0 5px;font-size:10.5px;white-space:nowrap}
#ev-region-box .ra-item .d{margin:5px 0 0;font-weight:600}
#ev-region-box .ra-item .f{color:#b5c5bf;font-size:12px}
#ev-region-box .ra-metrics{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:4px;font-size:11.5px;color:#dae6df}
#ev-region-box .ra-src{margin:6px 0 0;padding-left:16px;font-size:11.5px} #ev-region-box .ra-src a{color:#b3e3d2}
#ev-region-box .ra-src .q{display:block;color:#93a8a0}
#ev-region-box table{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}
#ev-region-box th,#ev-region-box td{padding:4px 3px;border-bottom:1px solid #2f413d;text-align:right;font-variant-numeric:tabular-nums}
#ev-region-box th:first-child,#ev-region-box td:first-child{text-align:left}
#ev-region-box td.chg{color:#ffe08a;font-weight:700}
#ev-region-box .ra-warn{background:#3b3524;border:1px solid #6b5a2a;border-radius:8px;padding:7px 9px;font-size:12px;color:#f3e3b5}
#ev-region-box label.check{display:flex;gap:6px;align-items:flex-start;font-size:12px;color:#dae6df;margin-top:6px}
#ev-region-box label.check input{flex:none;width:auto;margin:2px 0 0;padding:0}
`;
const STEPS = ['cache', 'news_search', 'extraction', 'timeline', 'scenario', 'done'];
const STEP_NAME = { cache: '캐시 조회', ...STAGE_LABEL };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vworldKey = () => { try { return localStorage.getItem('korea-vworld-key') || window.KOREA_VWORLD_KEY || ''; } catch { return window.KOREA_VWORLD_KEY || ''; } };

export function attachRegionAnalysis({ box, apiBase, viewer, Cesium, panel, typeLabel, esc, onCardSaved, openCard }) {
  if (!document.querySelector('style[data-region-analysis]')) {
    const style = document.createElement('style'); style.dataset.regionAnalysis = ''; style.textContent = STYLE; document.head.append(style);
  }
  box.innerHTML = `<div class="ra-sec" id="ra-target"></div><div class="ra-sec" id="ra-near" hidden></div>
    <div class="ra-sec" id="ra-status" hidden></div><div id="ra-result"></div>`;
  const $ = id => box.querySelector('#' + id);
  const st = {
    target: null, name: '', nameNote: '', radius: 5, scope: 'all', visible: false,
    phase: 'idle', progress: null, error: null, result: null, cached: false, regionId: null, allowAssumed: false, shown: null, notes: {}, level: 'completed',
  };
  let runToken = 0, geoToken = 0, nearToken = 0;

  async function call(path, options) {
    if (!apiBase) throw new Error('서버 주소가 설정되지 않았습니다 (korea/config.js의 DISASTER_API_URL).');
    let res;
    try { res = await fetch(apiBase + path, options); } catch { throw Object.assign(new Error('분석 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'), { status: 0 }); }
    let body = null; try { body = await res.json(); } catch { /* 본문 없음 */ }
    if (!res.ok) throw Object.assign(new Error(errorMessage(res.status, body)), { status: res.status, retryAfter: Number(res.headers.get('Retry-After')) || 0 });
    return body;
  }

  /* ── 지도: 공사 · 시설 변화 표시 (기사에 위치가 있는 것만), 카메라 ── */
  let markers = [];
  const clearMarkers = () => { for (const e of markers) viewer?.entities.remove(e); markers = []; };
  function showFacilities(result) {
    clearMarkers();
    if (!viewer || !Cesium) return { total: 0, shown: 0 };
    const facilities = (result?.changes || []).filter(c => c.change_type !== 'disaster_event');
    for (const c of facilities) if (Number.isFinite(c.location?.latitude) && Number.isFinite(c.location?.longitude)) addMarker(c, c.location, false);
    return { total: facilities.length, shown: markers.length, searched: 0 };
  }
  function addMarker(c, at, estimated) {
    const v = changeView(c);
    markers.push(viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(at.longitude, at.latitude),
      point: { pixelSize: 12, color: Cesium.Color.fromCssColorString(v.statusColor), outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: `${v.facility || v.kind} · ${v.status}${v.date ? ' ' + v.date : ''}${estimated ? ' (장소 검색 위치)' : ''}`, font: '600 13px system-ui', showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#202c2ce6'), pixelOffset: new Cesium.Cartesian2(0, -16),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    }));
  }
  // 기사에 좌표가 없는 시설: "지역 이름 + 시설 이름"을 브이월드 장소 검색으로 찾아 분석 지점 15 km 안이면 표시 (기사 근거가 아니라 '장소 검색 위치'로 구분)
  const km = (a, b) => Math.hypot((a.longitude - b.longitude) * 88.4, (a.latitude - b.latitude) * 111.2);
  async function locateFacilities(result, token) {
    const near = point() || (result?.region ? { longitude: result.region.center_lon, latitude: result.region.center_lat } : null);
    const town = (result?.region?.display_name || '').split(/\s+/)[1] || ''; // "강원특별자치도 강릉시" → "강릉시"
    const todo = (result?.changes || []).filter(c => c.change_type !== 'disaster_event' && c.facility_name && !Number.isFinite(c.location?.latitude)).slice(0, 8);
    if (!near || !todo.length) return;
    for (const c of todo) {
      let places = [];
      try { places = await findMapPlaces(vworldKey(), `${town} ${c.facility_name}`.trim()); } catch { continue; }
      if (token !== runToken) return;
      const best = places.map(p => ({ ...p, d: km(p, near) })).filter(p => p.d <= 15).sort((a, b) => a.d - b.d)[0];
      if (!best) continue;
      st.estimated[c.id] = { longitude: best.longitude, latitude: best.latitude, title: best.title };
      addMarker(c, best, true);
      st.facilities.shown = markers.length; st.facilities.searched++;
      renderResult();
    }
  }
  // 비 · 눈 같은 날씨는 카메라가 지면 위 약 8 km보다 높으면 안 보임 → 그때만 그 지점으로 내려감
  function flyIfHigh(at, force = false, type = null) {
    if (!viewer || !Cesium || !at) return;
    // 높을 때만 내려감: 비 · 눈 재난은 비구름 밑면(지면 위 약 400 m)보다 높으면, 그 밖은 4 km보다 높으면 (camera.js)
    if (force || cameraIsHigh(viewer, Cesium, UNDER_CLOUD.includes(type) ? 450 : 4000)) flyToSite(viewer, Cesium, at, type);
  }

  /* ── 대상 지점 ── */
  function setTarget(point, title = '') {
    if (!Number.isFinite(point?.longitude) || !Number.isFinite(point?.latitude)) return;
    const same = st.target && Math.abs(st.target.longitude - point.longitude) < 1e-6 && Math.abs(st.target.latitude - point.latitude) < 1e-6;
    if (same && !title) return;
    st.target = { longitude: point.longitude, latitude: point.latitude, title };
    st.name = ''; st.nameNote = '';
    renderTarget();
    if (st.visible) { lookupName(); loadNearby(); }
  }
  async function lookupName() {
    if (!st.target || st.name) return;
    const token = ++geoToken, { longitude, latitude } = st.target;
    st.nameNote = '지역 이름을 찾는 중…'; renderTarget();
    try {
      const name = regionNameFromAddress(await reverseGeocode(vworldKey(), longitude, latitude));
      if (token !== geoToken) return;
      st.name = name; st.nameNote = name ? '' : '이 지점의 주소를 찾지 못했습니다. 지역 이름을 직접 입력해 주세요. (확인 필요)';
    } catch (e) {
      if (token !== geoToken) return;
      st.nameNote = `${e.message} 지역 이름을 직접 입력해 주세요.`;
    }
    renderTarget();
  }
  function renderTarget() {
    const t = st.target, busy = st.phase === 'starting' || st.phase === 'running' || waitLeft() > 0; // 요청 제한 대기 중에도 잠금
    if (!t) {
      $('ra-target').innerHTML = `<h4>지역 변화 분석</h4><p class="note">지도를 클릭하거나 위쪽 검색창으로 장소를 고르면, 그 지역의 과거 재난 이력과 방재 시설 변화를 기사에서 찾아 정리합니다.</p>`;
      return;
    }
    const inKorea = inKoreaPoint(t);
    $('ra-target').innerHTML = `<h4>지역 변화 분석</h4>
      <div class="ra-point">${t.title ? esc(t.title) + ' · ' : ''}${t.latitude.toFixed(4)}°, ${t.longitude.toFixed(4)}°</div>
      <div class="ra-row"><input type="text" id="ra-name" maxlength="50" aria-label="지역 이름" placeholder="예: 서울특별시 강남구 대치동" value="${esc(st.name)}"></div>
      ${st.nameNote ? `<p class="note">${esc(st.nameNote)}</p>` : ''}
      <div class="ra-row">
        <select id="ra-scope" aria-label="분석 범위"><option value="all">모든 재난 이력</option><option value="flood">홍수 + 배수 시설</option></select>
        <select id="ra-radius" aria-label="반경"><option value="2">반경 2 km</option><option value="5">반경 5 km</option><option value="10">반경 10 km</option><option value="20">반경 20 km</option></select>
      </div>
      <div class="ra-row"><button type="button" class="primary" id="ra-go" ${busy || !inKorea ? 'disabled' : ''}>${goLabel()}</button>
        ${st.result ? `<button type="button" id="ra-refresh" ${busy ? 'disabled' : ''} title="24시간 캐시를 무시하고 다시 검색 (10분 안에는 캐시)">새로 분석</button>` : ''}</div>
      ${inKorea ? '' : '<p class="note ra-err">대한민국 안의 지점만 분석할 수 있습니다. 지도에서 위치를 다시 골라 주세요. (확인 필요)</p>'}`;
    $('ra-scope').value = st.scope; $('ra-radius').value = String(st.radius);
    $('ra-name').oninput = e => { st.name = e.target.value; };
    $('ra-scope').onchange = e => { st.scope = e.target.value; };
    $('ra-radius').onchange = e => { st.radius = +e.target.value; loadNearby(); };
    $('ra-go').onclick = () => analyze(false);
    if ($('ra-refresh')) $('ra-refresh').onclick = () => analyze(true);
  }

  /* ── 근처 재난 카드 (이미 DB에 있는 것) ── */
  async function loadNearby() {
    if (!st.target) return;
    const token = ++nearToken, { latitude, longitude } = st.target, radius = Math.max(20, st.radius);
    try {
      const r = await call(`/api/disasters/nearby?lat=${latitude}&lon=${longitude}&radius_km=${radius}&limit=5`);
      if (token !== nearToken) return;
      const items = r?.items || [];
      $('ra-near').hidden = false;
      $('ra-near').innerHTML = `<h4>근처 재난 사건 (반경 ${radius} km, ${r?.total ?? items.length}건)</h4>` + (items.length
        ? `<div class="ra-near">${items.map(c => `<button type="button" data-card="${esc(c.id)}">${(typeLabel[c.type] || typeLabel.other)[1]} ${esc(c.title)} <small>· ${esc(String(c.date || '').slice(0, 10))} · ${esc(c.distance_km)} km</small></button>`).join('')}</div>`
        : '<p class="note">이미 모은 재난 사건 중 근처에 있는 것이 없습니다.</p>');
      $('ra-near').querySelectorAll('[data-card]').forEach(b => b.onclick = () => openCard(b.dataset.card));
    } catch { if (token === nearToken) $('ra-near').hidden = true; } // 근처 카드는 보조 정보: 실패해도 분석은 그대로
  }

  /* ── 분석 · 진행 ── */
  async function analyze(force) {
    const t = st.target;
    if (!inKoreaPoint(t)) return;
    const name = (st.name || '').trim();
    if (!name) { st.nameNote = '지역 이름을 입력해 주세요. (예: 서울특별시 강남구 대치동)'; renderTarget(); $('ra-name')?.focus(); return; }
    const token = ++runToken;
    Object.assign(st, { phase: 'starting', error: null, progress: { phase: 'running', progress: 0, stage: STEP_NAME.cache, key: 'cache' } });
    renderTarget(); renderStatus();
    try {
      const r = await call('/api/regions/analyze', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ region_name: name, latitude: t.latitude, longitude: t.longitude, radius_km: st.radius, disaster_type: st.scope, force_refresh: !!force }) });
      if (token !== runToken) return;
      st.regionId = r.region_id; st.cached = !!r.cached;
      if (r.result) return finish(r.result, token, r.generated_at);
      st.phase = 'running'; renderTarget();
      await poll(r.job_id, token);
    } catch (e) { if (token === runToken) fail(e.message, e.status === 429 ? e.retryAfter : 0); }
  }
  async function poll(jobId, token) {
    const t0 = performance.now();
    let misses = 0;
    while (token === runToken) {
      if (gaveUp(performance.now() - t0)) return fail('분석이 너무 오래 걸립니다. 서버가 다시 시작됐을 수 있으니 다시 시도해 주세요.');
      let r;
      try { r = await call(`/api/analysis/${encodeURIComponent(jobId)}`); misses = 0; } catch (e) {
        if (token !== runToken) return;
        if (e.status === 404 || ++misses >= 4) return fail(e.message); // 작업이 사라짐(서버 재시작) 또는 연결이 계속 안 됨
        await sleep(POLL_MS); continue;
      }
      if (token !== runToken) return;
      const s = jobState(r);
      if (s.phase === 'done') return finish(r.result, token);
      if (s.phase === 'failed') return fail(s.error);
      st.progress = { ...s, key: r.stage || 'news_search' }; renderStatus();
      await sleep(POLL_MS);
    }
  }
  // 요청 제한(429)이면 서버가 알려 준 남은 시간 동안 다시 시도 · 분석을 잠그고 1초마다 남은 시간을 보여 줌
  let waitTimer = 0;
  const waitLeft = () => Math.max(0, Math.ceil(((st.retryUntil || 0) - Date.now()) / 1000));
  const waitText = s => s >= 60 ? `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초` : `${s}초`;
  const goLabel = () => waitLeft() ? `${waitText(waitLeft())} 뒤 분석 가능` : st.phase === 'starting' || st.phase === 'running' ? '분석 중…' : '이 지역 분석';
  function fail(message, retryAfter = 0) {
    st.phase = 'failed'; st.error = message || '분석에 실패했습니다.';
    st.retryUntil = retryAfter > 0 ? Date.now() + retryAfter * 1000 : 0;
    clearInterval(waitTimer);
    // 1초마다 버튼 글자와 상태만 갱신 (지역 이름 입력칸은 다시 그리지 않음), 다 기다리면 한 번 다시 그림
    if (st.retryUntil) waitTimer = setInterval(() => {
      const go = $('ra-go');
      if (go) { go.textContent = goLabel(); go.disabled = waitLeft() > 0 || !inKoreaPoint(st.target); }
      renderStatus();
      if (!waitLeft()) { clearInterval(waitTimer); renderTarget(); }
    }, 1000);
    renderTarget(); renderStatus();
  }
  function finish(result, token, generatedAt) {
    if (token !== runToken) return;
    Object.assign(st, { phase: 'done', result, error: null, allowAssumed: false, shown: null, notes: {}, generatedAt: generatedAt || null });
    st.estimated = {};
    st.facilities = showFacilities(result);
    locateFacilities(result, token);
    renderTarget(); renderStatus(); renderResult();
  }
  function renderStatus() {
    const s = st.progress, el = $('ra-status');
    if (st.phase === 'idle') { el.hidden = true; return; }
    el.hidden = false;
    if (st.phase === 'failed') {
      const left = waitLeft();
      el.innerHTML = `<h4>분석 실패</h4><p class="note ra-err" role="alert">${esc(st.error)}</p><div class="ra-row"><button type="button" id="ra-retry" ${left ? 'disabled' : ''}>${left ? `${waitText(left)} 뒤 다시 시도` : '다시 시도'}</button></div>`;
      $('ra-retry').onclick = () => analyze(false);
      return;
    }
    if (st.phase === 'done') {
      const when = st.generatedAt ? ` · ${esc(String(st.generatedAt).slice(0, 16).replace('T', ' '))} 분석` : '';
      el.innerHTML = `<h4>분석 완료</h4><p class="note">${st.cached ? '이미 분석한 결과(캐시)를 보여 줍니다' + when + '. 필요하면 새로 분석을 누르세요.' : '방금 분석했습니다.'}</p>`;
      return;
    }
    const idx = Math.max(0, STEPS.indexOf(s?.key || 'cache'));
    el.innerHTML = `<h4>분석 중 · ${esc(s?.stage || '')}</h4><div class="ra-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s?.progress || 0}"><i style="width:${Math.max(4, s?.progress || 0)}%"></i></div>
      <div class="ra-steps">${STEPS.slice(0, -1).map((k, i) => `<span class="${i < idx ? 'ok' : i === idx ? 'on' : ''}">${i < idx ? '✓ ' : ''}${STEP_NAME[k]}</span>`).join('')}</div>
      <p class="note">뉴스 검색과 AI 분석에 보통 30초~2분 걸립니다.</p>`;
  }

  /* ── 결과: 타임라인 · 전후 비교 ── */
  function renderResult() {
    const r = st.result, el = $('ra-result');
    if (!r) { el.innerHTML = ''; return; }
    const tl = timelineView(r), sv = currentScenario();
    // 재현 가능 여부는 카드와 같은 판정 (기사 수치가 없거나 범위 밖이면 버튼 대신 이유)
    const effects = new Map((r.changes || []).filter(c => c.change_type === 'disaster_event')
      .map(c => [c.id, articleEffect({ ...c, type: c.disaster_type }, window.DisasterFX?.TYPES)]));
    const itemHtml = v => itemTemplate(v, effects.get(v.id));
    const fac = st.facilities || { total: 0, shown: 0 };
    const facNote = !fac.total ? '' : fac.shown
      ? `공사 · 시설 변화 ${fac.total}건 중 ${fac.shown}건을 지도에 표시했습니다 (점 색 = 상태${fac.searched ? `, ${fac.searched}건은 기사에 위치가 없어 장소 검색으로 찾은 위치` : ''}).`
      : `공사 · 시설 변화 ${fac.total}건이 있지만 위치를 찾지 못해 지도에 표시하지 않았습니다.`;
    const region = r.region?.display_name ? esc(r.region.display_name) : '';
    el.innerHTML = `<div class="ra-sec"><h4>${region} 이력 (${tl.items.length}건)</h4>
        ${facNote ? `<p class="note">${esc(facNote)}</p>` : ''}
        ${tl.empty ? `<p class="empty">${esc(tl.empty)}</p>` : tl.items.map(itemHtml).join('')}
        ${tl.notice ? `<p class="note">${esc(tl.notice)}</p>` : ''}</div>
      ${sv.exists ? scenarioHtml(sv) : ''}`;
    el.querySelectorAll('[data-replay]').forEach(b => b.onclick = () => replay(+b.dataset.replay));
    el.querySelectorAll('[data-fly]').forEach(b => b.onclick = () => { const id = +b.dataset.fly, c = st.result?.changes?.find(x => x.id === id); const at = Number.isFinite(c?.location?.latitude) ? c.location : st.estimated?.[id]; if (at) flyIfHigh(at, true); });
    el.querySelectorAll('[data-card-save]').forEach(b => b.onclick = () => saveCard(+b.dataset.cardSave, b));
    const lvl = el.querySelector('#ra-level'); if (lvl) lvl.onchange = e => { st.level = e.target.value; st.shown = null; st.notes.scenario = ''; renderResult(); };
    const consent = el.querySelector('#ra-consent');
    if (consent) consent.onchange = e => { st.allowAssumed = e.target.checked; renderResult(); };
    el.querySelectorAll('[data-phase]').forEach(b => b.onclick = () => showScenario(b.dataset.phase));
    const depth = el.querySelector('#ra-depth'); if (depth) depth.onchange = e => panel?.setDepthMap?.(e.target.checked);
    const off = el.querySelector('#ra-off'); if (off) off.onclick = () => { panel?.stop(); st.shown = null; renderResult(); };
  }
  function itemTemplate(v, eff) {
    const [tname, ticon] = typeLabel[v.disasterType] || typeLabel.other;
    return `<div class="ra-item">
      <div class="top"><b>${esc(v.dateText)}</b><span class="ra-badge" style="color:${v.statusColor};border-color:${v.statusColor}88">${esc(v.status)}</span>
        <span>${v.isEvent ? `${ticon} ${esc(tname)}` : esc(v.kind)}</span>
        <span class="ra-badge" style="color:${v.evidenceColor};border-color:${v.evidenceColor}88" title="근거 문구가 검색 결과에 실제로 있는지">${esc(v.evidence)}</span>
        ${v.conflict ? '<span class="ra-badge" style="color:#ffb4a2;border-color:#ffb4a288" title="기사마다 상태가 다릅니다">기사 간 충돌</span>' : ''}</div>
      <p class="d">${esc(v.description)}</p>${v.facility ? `<div class="f">시설: ${esc(v.facility)}</div>` : ''}
      ${v.metrics.length ? `<div class="ra-metrics">${v.metrics.map(m => `<span>${esc(m.label)} <b>${esc(m.value)}</b></span>`).join('')}</div>` : ''}
      ${v.sources.length ? `<ol class="ra-src">${v.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a> <span class="meta">${esc(s.publisher)} ${esc(s.date)}</span>${s.note ? `<span class="q">“${esc(s.note)}”</span>` : ''}</li>`).join('')}</ol>`
        : '<p class="note">원문 출처 링크 없음</p>'}
      ${v.isEvent ? `<div class="ra-row">${v.replayable && eff?.ready ? `<button type="button" data-replay="${v.id}">이 지점에 재현</button>`
        : `<span class="note">${esc(!v.replayable ? '이 재난 종류는 지도 효과가 없습니다.' : eff?.reason || '기사에서 규모 수치를 확인할 수 없어 재현할 수 없습니다.')}</span>`}
        <button type="button" data-card-save="${v.id}">재난 카드로 저장</button></div>` : ''}
      ${!v.isEvent && (Number.isFinite(st.result?.changes?.find(x => x.id === v.id)?.location?.latitude) || st.estimated?.[v.id]) ? `<div class="ra-row"><button type="button" data-fly="${v.id}">지도에서 보기</button>${st.estimated?.[v.id] ? `<span class="note">장소 검색 위치: ${esc(st.estimated[v.id].title)}</span>` : ''}</div>` : ''}
      ${st.notes[v.id] ? `<p class="note" role="status">${esc(st.notes[v.id])}</p>` : ''}</div>`;
  }
  function scenarioHtml(sv) {
    const cell = (v, unit) => v == null ? '–' : `${esc(v)} ${unit}`;
    const badge = l => `<span class="ra-badge" style="color:${l[1]};border-color:${l[1]}88">${l[0]}</span>`;
    const flood = window.DisasterFX?.TYPES?.flood, depth = p => flood ? flood.env(p).water : null;
    const dB = depth(sv.before.params), dA = depth(sv.after.params);
    const same = onlyDrainDiffers(sv.before, sv.after);
    return `<div class="ra-sec"><h4>홍수 전 · 후 비교 (배수 능력만 바꿈)</h4>
      <p class="ra-warn">기사 근거 + 가정 기반 비교입니다. 공사 전후의 실제 침수 예측이 아닙니다.${sv.quality ? ` · ${esc(sv.quality)}` : ''}</p>
      <div class="ra-row"><span class="note">반영할 시설</span><select id="ra-level" aria-label="반영할 시설">${Object.entries(FACILITY_LEVELS).map(([k, [name]]) => `<option value="${k}" ${k === st.level ? 'selected' : ''}>${name}</option>`).join('')}</select></div>
      ${sv.facilities ? (sv.facilities.length ? `<ul class="ra-src">${sv.facilities.map(f => {
        const [sName, sColor] = STATUS_LABEL[f.status] || STATUS_LABEL.unknown;
        const gain = f.article != null ? `기사 설계 강우 ${f.article} mm/h` : f.gain ? `+${f.gain} mm/h (가정)` : '하천 범람 방지 · 배수 능력엔 미반영';
        return `<li>${esc(f.name || CHANGE_LABEL[f.type] || '')} <span class="ra-badge" style="color:${sColor};border-color:${sColor}88">${esc(sName)}</span> · ${esc(gain)}${f.evidence === 'inferred' ? ' · 근거 문구 미확인' : ''}</li>`;
      }).join('')}</ul>` : '<p class="note">이 범위에 배수 · 방재 시설이 없습니다.</p>') : ''}
      ${sv.whatIf ? '<p class="note ra-err">계획 · 공사 중인 시설이 모두 완공된다고 가정한 비교입니다.</p>' : ''}
      <table><thead><tr><th>값</th><th>공사 전</th><th>공사 후</th></tr></thead><tbody>
        ${sv.rows.map(r => `<tr><td>${esc(r.label)}</td><td class="${r.changed ? 'chg' : ''}">${cell(r.before, r.unit)} ${badge(r.evidenceBefore)}</td><td class="${r.changed ? 'chg' : ''}">${cell(r.after, r.unit)} ${badge(r.evidenceAfter)}</td></tr>`).join('')}
        ${dB != null ? `<tr><td>저지대 침수 깊이 (간이 공식)</td><td>${dB.toFixed(1)} m</td><td>${dA.toFixed(1)} m</td></tr>` : ''}
      </tbody></table>
      ${sv.baselineDate ? `<p class="note">기준: 시설 준공 ${esc(sv.baselineDate)}</p>` : ''}
      ${sv.assumptions.length ? `<ul class="ra-src">${sv.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      ${sv.needsConsent ? `<p class="note ra-err">${esc(sv.reason)}</p>
        <label class="check"><input type="checkbox" id="ra-consent" ${st.allowAssumed ? 'checked' : ''}> 가정 시나리오로 비교해 보기 (실제 시설 성능이 아닌 시연용 값)</label>` : ''}
      <label class="check"><input type="checkbox" id="ra-depth" ${panel?.depthMap ? 'checked' : ''}> 물 깊이 색으로 보기 (형광, 깊을수록 진하게)</label>
      <div class="ra-row"><button type="button" data-phase="before" aria-pressed="${st.shown === 'before'}" ${sv.available && same ? '' : 'disabled'}>공사 전 보기</button>
        <button type="button" data-phase="after" aria-pressed="${st.shown === 'after'}" ${sv.available && same ? '' : 'disabled'}>공사 후 보기</button>
        <button type="button" id="ra-off" ${st.shown ? '' : 'disabled'}>효과 끄기</button></div>
      ${same ? '' : '<p class="note ra-err">전 · 후에 배수 능력 말고 다른 값도 달라 비교하지 않습니다.</p>'}
      ${st.notes.scenario ? `<p class="note" role="status">${esc(st.notes.scenario)}</p>` : ''}</div>`;
  }
  // 반영할 시설 범위(st.level)에 맞춰 '공사 후' 배수 능력을 다시 정한 시나리오 (region-model.js facilityScenario)
  const currentScenario = () => scenarioView(facilityScenario(st.result, st.level) ?? st.result?.scenario, st.allowAssumed);
  const point = () => st.target && inKoreaPoint(st.target) ? { longitude: st.target.longitude, latitude: st.target.latitude } : null;
  async function showScenario(phase) {
    const sv = currentScenario();
    if (!sv.available || !onlyDrainDiffers(sv.before, sv.after) || !panel) return;
    const s = sv[phase], at = point() || sv.position; // 같은 위치 · 비 · 시간, 배수 능력만 다름 (카메라는 그대로, 너무 높을 때만 내려감)
    flyIfHigh(at, false, 'flood');
    st.notes.scenario = '적용하는 중…'; renderResult();
    try {
      const ok = await panel.set(s.type, { ...s.params }, at, { title: `${st.result.region?.display_name || ''} · 공사 ${phase === 'before' ? '전' : '후'}`, regionScenario: phase, assumed: !sv.verified });
      st.shown = ok ? phase : st.shown;
      st.notes.scenario = ok ? `공사 ${phase === 'before' ? '전' : '후'} (배수 ${s.params.drain} mm/h)를 적용했습니다.` : '';
    } catch (e) { st.notes.scenario = '적용하지 못했습니다: ' + e.message; }
    renderResult();
  }
  async function replay(id) {
    const c = st.result?.changes?.find(x => x.id === id); if (!c || !panel) return;
    const eff = articleEffect({ ...c, type: c.disaster_type }, window.DisasterFX?.TYPES);
    const at = point() || c.location || c.map_effect?.position;
    if (!eff?.ready) { st.notes[id] = eff?.reason || '기사에서 규모 수치를 확인할 수 없어 재현할 수 없습니다.'; renderResult(); return; }
    st.notes[id] = '재현하는 중…'; renderResult();
    flyIfHigh(at, false, eff.type);
    try {
      const ok = await panel.set(eff.type, eff.params, at, { regionChangeId: id, title: c.description, sources: eff.sources });
      st.notes[id] = ok ? '이 지점에 기사 규모로 재현했습니다.' : '';
    } catch (e) { st.notes[id] = '재현하지 못했습니다: ' + e.message; }
    st.shown = null; renderResult();
  }
  async function saveCard(id, button) {
    button.disabled = true;
    try {
      const at = point();
      const r = await call(`/api/regions/changes/${id}/card`, at ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(at) } : { method: 'POST' });
      st.notes[id] = r.created ? '재난 카드로 저장했습니다. 최근 탭에서 볼 수 있습니다.' : '이미 저장된 재난 카드입니다.';
      onCardSaved?.(r.disaster_id);
    } catch (e) { st.notes[id] = e.message; }
    renderResult();
  }

  addEventListener('korea-site-selected', e => setTarget(e.detail));
  addEventListener('map-depthmap', e => { const c = box.querySelector('#ra-depth'); if (c) c.checked = e.detail; });
  addEventListener('map-place-selected', e => setTarget(e.detail, e.detail.title));
  renderTarget();
  return {
    setTarget,
    show() { st.visible = true; renderTarget(); if (st.target) { lookupName(); loadNearby(); } },
    hide() { st.visible = false; },
  };
}
