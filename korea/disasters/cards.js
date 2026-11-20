/* 재난 사건 목록 (쇼핑몰 상품 목록처럼 카드로) — 오른쪽 서랍
   데이터: 백엔드 API (JsonParc/GDGoC_TUK_pssk_backend)
   - GET /api/disasters?type=&limit=&offset=  카드 목록 (map_effect_supported · map_effect_type 포함)
   - GET /api/disasters/{id}                  상세 + 원문 기사(sources) + map_effect { supported, type, params, position, sources }
   - GET /api/guides/{type}                   행동요령
   서버 주소: korea/config.js의 window.DISASTER_API_URL (localhost에서 열면 기본 http://localhost:8001)
   카드 → "시뮬레이션 실행": 카메라를 발생 지점으로 옮기고 koreaDisaster.set(map_effect.type, params, position)
   저장한 카드는 이 브라우저(localStorage)에 보관 */

import { makeDraggable } from './draggable.js';
import { articleEffect, validPosition } from './article-effect.js';

const TYPE_LABEL = {
  flood: ['호우 · 홍수', '🌧', '#2d6cdf'], typhoon: ['태풍', '🌀', '#5b4bd6'], heavysnow: ['대설', '❄', '#5aa0c8'], coldwave: ['한파', '🥶', '#3f8fb5'],
  heatwave: ['폭염', '☀', '#e0702a'], strongwind: ['강풍', '💨', '#6b8a99'], wave: ['풍랑', '🌊', '#2f7f9c'], yellowdust: ['황사', '🌫', '#b08a4a'],
  tsunami: ['지진해일', '🌊', '#1f6f8b'], earthquake: ['지진', '〰', '#a0522d'], wildfire: ['산불', '🔥', '#d2401f'], dry: ['건조', '🍂', '#b5832e'],
  stormsurge: ['폭풍해일', '🌊', '#2a6f97'], fog: ['안개', '🌁', '#7d8a93'], other: ['기타', '•', '#6c757d'],
};
const SRC_LABEL = { article: ['기사', '#3fb37f'], derived: ['기사로 계산', '#5aa0c8'], display: ['표현 설정', '#8a8f98'], default: ['보조 가정', '#8a8f98'] };
const SAVED_KEY = 'dx-saved-cards';
const LOCAL_REGIONS = { seoul: '서울', busan: '부산', jeju: '제주' };
const inKorea = c => c.lat != null && c.lon != null && c.lat >= 32 && c.lat <= 39.5 && c.lon >= 124 && c.lon <= 132;
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; } };
const storeSaved = list => { try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* 저장 불가 (사생활 보호 모드 등) */ } };

const CSS = `
#ev-drawer{--accent:linear-gradient(90deg,#b4d29a,#99d2ad 55%,#7fc3b6);position:absolute;z-index:3;top:var(--map-panel-top,60px);right:var(--map-navigation-gap,110px);width:min(var(--map-side-panel-width,352px),calc(100vw - 130px));max-height:calc(100dvh - 108px);display:flex;flex-direction:column;
  color-scheme:dark;background:#202c2c;color:#f1f5f0;border:1px solid #425552;border-radius:15px;font-size:13.75px;line-height:1.45;box-shadow:0 6px 24px #0006;box-sizing:border-box}
#ev-drawer *{box-sizing:border-box}
#ev-drawer.closed,#ev-open.closed{display:none!important}
#ev-drawer [hidden]{display:none!important}
#ev-drawer header{display:flex;align-items:center;gap:6px;padding:15px 18px 5px}
#ev-drawer header b{flex:1;font-size:15.5px}
#ev-drawer header button{background:none;border:0;color:#b5c5bf;cursor:pointer;font-size:16px;padding:0 2px;width:auto}
#ev-drawer #ev-close{min-width:38px;min-height:38px;border-radius:8px;font:26px/1 system-ui,sans-serif}
#ev-drawer #ev-close:hover{background:#314440}
#ev-drawer .tabs{display:flex;margin:8px 18px 0;border-bottom:1px solid #425552}
#ev-drawer .tabs button{position:relative;flex:1;background:none;border:0;border-radius:0;color:#b5c5bf;padding:11px 0 13px;font:inherit;cursor:pointer}
#ev-drawer .tabs button.on{color:#fff;font-weight:700}
#ev-drawer .tabs button.on::after{content:"";position:absolute;inset:auto 0 -1px;height:2px;background:var(--accent)}
#ev-drawer .tabs small{margin-left:5px;color:#a3b8ae;font-weight:400}
#ev-drawer .filters{display:flex;gap:7px;padding:13px 18px 9px}
#ev-drawer select{flex:1;background:#182624;color:#fff;border:1px solid #425552;border-radius:8px;padding:6px;font:inherit;min-width:0}
#ev-drawer .filters button{width:33px;background:transparent;color:#d0e0d8;border:1px solid #425552;border-radius:50%;padding:0;cursor:pointer;font-size:17px}
#ev-drawer .body{min-height:0;overflow:auto;padding:7px 13px 11px;flex:1;scrollbar-width:none}
#ev-drawer .grid{display:grid;gap:3px}
#ev-drawer .event{display:flex;align-items:center;border-radius:9px}
#ev-drawer .event:hover,#ev-drawer .event:focus-within{background:#31413e}
#ev-drawer .card{min-width:0;flex:1;display:flex;gap:11px;align-items:center;background:none;border:0;border-radius:8px;cursor:pointer;text-align:left;color:inherit;font:inherit;padding:7px 4px}
#ev-drawer .card .icon{display:grid;place-items:center;flex:0 0 40px;height:40px;border-radius:9px;font-size:17px}
#ev-drawer .card .text{min-width:0}
#ev-drawer .card .t{display:block;font-weight:700;font-size:13.75px;line-height:1.35;overflow-wrap:anywhere}
#ev-drawer .card .m{display:block;margin-top:3px;color:#b5c5bf;font-size:12.5px;overflow-wrap:anywhere}
#ev-drawer .star{background:none;border:0;color:#b5c5bf;font-size:17px;cursor:pointer;padding:7px;line-height:1}
#ev-drawer .star.on{color:#ffd24a}
#ev-drawer .note{color:#a9bbb3;font-size:11px;margin:8px 0 0}
#ev-drawer .drawer-note{margin:0;padding:10px 16px;border-top:1px solid #425552}
#ev-drawer :is(button,select,a,summary):focus-visible{outline:2px solid #a5e2cc;outline-offset:-2px}
#ev-drawer .empty{color:#b5c5bf;padding:16px 4px;text-align:center}
#ev-drawer .more{width:100%;margin-top:8px;background:#293a37;color:#fff;border:1px solid #425552;border-radius:7px;padding:6px;cursor:pointer;font:inherit}
#ev-drawer .detail h3{margin:6px 0 4px;font-size:14px;line-height:1.35}
#ev-drawer .detail .meta{color:#b5c5bf;font-size:11.5px}
#ev-drawer .detail p{margin:8px 0}
#ev-drawer .detail h4{margin:12px 0 5px;font-size:11px;color:#acbeb6;letter-spacing:.04em}
#ev-drawer .detail dl{display:grid;grid-template-columns:auto 1fr auto;gap:4px 8px;margin:0;align-items:center}
#ev-drawer .detail dt{color:#dae6df} #ev-drawer .detail dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
#ev-drawer .detail .src{font-size:10px;border-radius:4px;padding:0 5px;border:1px solid;white-space:nowrap}
#ev-drawer .detail ul{margin:0;padding-left:16px} #ev-drawer .detail li{margin:3px 0}
#ev-drawer .detail a{color:#b3e3d2}
#ev-drawer .btns{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
#ev-drawer .btns button{background:#293a37;color:#fff;border:1px solid #425552;border-radius:7px;padding:6px 10px;cursor:pointer;font:inherit}
#ev-drawer .btns button.primary{background:var(--accent);color:#152e27;border-color:transparent;font-weight:700}
#ev-drawer .btns button:disabled{opacity:.45;cursor:default}
#ev-drawer details summary{cursor:pointer;color:#b5c5bf;margin-top:10px}
#ev-open{position:absolute;z-index:5;top:var(--map-panel-top,60px);right:var(--map-navigation-gap,110px);background:#202c2c;color:#fff;border:1px solid #425552;border-radius:9px;padding:7px 11px;cursor:pointer;font:inherit;font-size:13px;font-weight:600;min-height:36px}
@media(max-width:860px){#ev-drawer,#ev-open{top:48dvh}#ev-drawer{max-height:calc(52dvh - 50px)}}
`;

export function attachCardList({ viewer, Cesium, initialRegion }) {
  const host = location.hostname;
  const API = (window.DISASTER_API_URL || (host === 'localhost' || host === '127.0.0.1' ? 'http://localhost:8001' : '')).replace(/\/$/, '');
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const root = document.createElement('section'); root.id = 'ev-drawer'; root.setAttribute('aria-label', '재난 사건 목록');
  const typeOptions = Object.entries(TYPE_LABEL).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join('');
  root.innerHTML = `
    <header><b>재난 사건</b><button type="button" id="ev-close" aria-label="목록 접기" title="접기">›</button></header>
    <div class="tabs"><button type="button" class="on" data-tab="recent">최근<small id="ev-total"></small></button><button type="button" data-tab="saved">저장됨<small id="ev-saved"></small></button></div>
    <div class="filters"><select id="ev-type" aria-label="재난 종류"><option value="">모든 재난</option>${typeOptions}</select>
      <select id="ev-region" aria-label="지역"><option value="kr">대한민국 먼저</option><option value="krOnly">대한민국만</option><option value="world">해외만</option>
        ${Object.entries(LOCAL_REGIONS).map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select>
      <button type="button" id="ev-refresh" aria-label="새로 불러오기" title="새로 불러오기">↻</button></div>
    <div class="body"><div id="ev-list"></div><div id="ev-detail" class="detail" hidden></div></div>
    <p class="note drawer-note">기사 기반 시뮬레이션 · 실시간 예측 아님</p>`;
  const opener = document.createElement('button'); opener.id = 'ev-open'; opener.type = 'button';
  opener.innerHTML = '<span aria-hidden="true">‹</span> 재난 사건'; opener.classList.add('closed');
  document.body.append(root, opener);
  const $ = id => root.querySelector('#' + id);
  if (initialRegion === 'korea') $('ev-region').value = 'krOnly';
  else if (Object.hasOwn(LOCAL_REGIONS, initialRegion)) $('ev-region').value = initialRegion;
  makeDraggable(root, root.querySelector('header'), 'ev-drawer-pos'); // 제목 줄을 끌어 옮김
  makeDraggable(opener, opener, 'ev-opener-pos');
  $('ev-close').onclick = () => {
    root.classList.add('closed'); opener.classList.remove('closed');
    opener.focus({ preventScroll: true });
  };
  opener.onclick = () => {
    root.classList.remove('closed'); opener.classList.add('closed');
    $('ev-close').focus({ preventScroll: true });
  };

  let tab = 'recent', items = [], total = 0, offset = 0, saved = loadSaved();
  const PAGE = 40;
  $('ev-saved').textContent = saved.length;
  const isSaved = id => saved.some(s => s.id === id);
  function toggleSave(card) {
    saved = isSaved(card.id) ? saved.filter(s => s.id !== card.id) : [{ id: card.id, type: card.type, title: card.title, location: card.location, date: card.date, scale: card.scale, lat: card.lat, lon: card.lon, map_effect_supported: card.map_effect_supported }, ...saved];
    storeSaved(saved); renderList();
  }

  async function api(path) {
    if (!API) throw new Error('서버 주소가 설정되지 않았습니다 (korea/config.js의 DISASTER_API_URL).');
    const res = await fetch(API + path);
    if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
    return res.json();
  }
  async function loadList(reset = true) {
    if (reset) { offset = 0; items = []; $('ev-total').textContent = ''; }
    $('ev-list').innerHTML = reset ? '<div class="empty">불러오는 중…</div>' : $('ev-list').innerHTML;
    try {
      const type = $('ev-type').value, q = new URLSearchParams({ limit: PAGE, offset });
      if (type) q.set('type', type);
      const r = await api('/api/disasters?' + q);
      items = items.concat(r.items); total = r.total; offset += r.items.length;
      renderList();
    } catch (e) { $('ev-list').innerHTML = `<div class="empty">목록을 불러오지 못했습니다.<br>${esc(e.message)}</div>`; }
  }

  function cardHtml(c) {
    const [name, icon, color] = TYPE_LABEL[c.type] || TYPE_LABEL.other;
    const marked = isSaved(c.id);
    return `<div class="event"><button type="button" class="card" data-id="${esc(c.id)}">
      <span class="icon" title="${esc(name)}" style="background:${color}38">${icon}</span>
      <span class="text"><span class="t">${esc(c.title)}</span>
      <span class="m">${esc(c.location || '위치 미상')}${c.date ? ' · ' + esc(String(c.date).slice(0, 10)) : ''}</span></span>
      </button><button type="button" class="star ${marked ? 'on' : ''}" data-star="${esc(c.id)}" aria-label="사건 저장" aria-pressed="${marked}">${marked ? '★' : '☆'}</button></div>`;
  }
  function renderList() {
    $('ev-saved').textContent = saved.length;
    $('ev-detail').hidden = true; $('ev-list').hidden = false;
    const region = $('ev-region').value, type = $('ev-type').value;
    const local = LOCAL_REGIONS[region];
    $('ev-total').textContent = region === 'kr' && Number.isFinite(total) ? total : '';
    let list = tab === 'saved' ? saved.filter(c => !type || c.type === type) : items.slice();
    if (local) list = list.filter(c => String(c.location || '').includes(local));
    else if (region === 'krOnly') list = list.filter(inKorea); else if (region === 'world') list = list.filter(c => !inKorea(c));
    else list.sort((a, b) => inKorea(b) - inKorea(a)); // 대한민국 먼저 (그 안에서는 서버 순서 = 최근)
    const hasMore = tab === 'recent' && offset < total;
    const empty = tab === 'saved' ? '저장한 사건이 없습니다.'
      : hasMore ? '현재까지 불러온 사건에 일치하는 지역이 없습니다.' : '표시할 사건이 없습니다.';
    $('ev-list').innerHTML = (list.length ? `<div class="grid">${list.map(cardHtml).join('')}</div>` : `<div class="empty">${empty}</div>`)
      + (hasMore ? '<button type="button" class="more" id="ev-more">더 보기</button>' : '');
    $('ev-list').querySelectorAll('.card').forEach(el => el.onclick = () => openDetail(el.dataset.id));
    $('ev-list').querySelectorAll('[data-star]').forEach(el => el.onclick = () => {
      const card = list.find(c => String(c.id) === el.dataset.star);
      if (card) {
        toggleSave(card);
        $('ev-list').querySelector(`[data-star="${CSS.escape(el.dataset.star)}"]`)?.focus();
      }
    });
    const more = $('ev-more'); if (more) more.onclick = () => loadList(false);
  }

  /* 상세: 요약 · 지도 효과 입력값(값마다 출처) · 원문 기사 · 행동요령 · 시뮬레이션 실행 */
  async function openDetail(id) {
    $('ev-list').hidden = true; const box = $('ev-detail'); box.hidden = false; box.innerHTML = '<div class="empty">불러오는 중…</div>';
    let d; try { d = await api('/api/disasters/' + id); } catch (e) { box.innerHTML = `<div class="empty">상세를 불러오지 못했습니다.<br>${esc(e.message)}</div><div class="btns"><button type="button" id="ev-back">← 목록</button></div>`; box.querySelector('#ev-back').onclick = renderList; return; }
    const [name, icon, color] = TYPE_LABEL[d.type] || TYPE_LABEL.other, eff = articleEffect(d, window.DisasterFX?.TYPES);
    const origin = validPosition(eff?.position) ? eff.position : { longitude: d.lon, latitude: d.lat };
    const def = eff && window.DisasterFX && window.DisasterFX.TYPES[eff.type];
    const fields = def ? [...def.params] : [];
    if (eff?.params.snowDepthCm != null) fields.unshift({ key: 'snowDepthCm', label: '쌓인 눈 깊이', unit: 'cm' });
    if (eff?.params.waterDepthM != null) fields.unshift({ key: 'waterDepthM', label: '침수 깊이', unit: 'm' });
    const rows = fields.filter(q => q.key !== 'exag' && q.key !== 'speed' && !(eff?.params.snowDepthCm != null && ['rate', 'hours', 'melt', 'time'].includes(q.key))).map(q => {
      const has = eff.params[q.key] != null, src = SRC_LABEL[has ? eff.sources[q.key] : 'default'] || SRC_LABEL.default;
      return `<dt>${esc(q.label)}</dt><dd>${esc(has ? eff.params[q.key] : q.value)} ${esc(q.unit)}</dd><dd><span class="src" style="color:${src[1]};border-color:${src[1]}66">${src[0]}</span></dd>`;
    }).join('');
    box.innerHTML = `
      <div class="band" style="display:inline-flex;gap:6px;align-items:center;background:${color};color:#fff;border-radius:6px;padding:3px 8px;font-weight:600">${icon} ${esc(name)}</div>
      <h3>${esc(d.title)}</h3>
      <div class="meta">${esc(d.location || '위치 미상')}${d.date ? ' · ' + esc(String(d.date).slice(0, 10)) : ''}${d.scale ? '<br>피해 규모: ' + esc(d.scale) : ''}</div>
      ${d.summary ? `<p>${esc(d.summary)}</p>` : ''}
      <div class="btns"><button type="button" class="primary" id="ev-run" ${eff?.ready && validPosition(origin) ? '' : 'disabled'}>발생 지역에 적용</button><button type="button" id="ev-here" ${eff?.ready ? '' : 'disabled'}>현재 지역에 같은 규모 적용</button><button type="button" id="ev-fly" ${validPosition(origin) ? '' : 'disabled'}>지도에서 위치 보기</button>
        <button type="button" id="ev-save">${isSaved(d.id) ? '★ 저장됨' : '☆ 저장'}</button><button type="button" id="ev-back">← 목록</button></div>
      <p class="note" id="ev-result" role="status"></p>
      ${eff ? `<h4>적용할 규모 · 출처</h4><dl>${rows}</dl>
        ${eff.ready ? '' : `<p class="note">${esc(eff.reason || '기사에서 재난 규모 수치를 확인할 수 없어 적용이 불가능합니다.')}</p>`}
        ${eff.params.snowDepthCm != null && d.type === 'heavysnow' ? '<p class="note">누적 적설은 지면 덮임으로 표시합니다.</p>' : ''}
        <p class="note">발생 위치는 기사에 나온 지역의 중심으로 추정했습니다.</p>`
        : `<p class="note">이 재난 종류(${esc(name)})는 아직 지도 효과가 없습니다.</p>`}
      ${(d.sources || []).length ? `<h4>원문 기사 (${d.sources.length})</h4><ul>${d.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="meta">${esc(s.source || '')} ${esc(s.published_at || '')}</span></li>`).join('')}</ul>` : ''}
      <details id="ev-guide"><summary>행동요령</summary><div class="empty">불러오는 중…</div></details>`;
    box.querySelector('#ev-back').onclick = renderList;
    box.querySelector('#ev-save').onclick = () => { toggleSave(d); openDetail(id); };
    box.querySelector('#ev-fly').onclick = () => fly(origin);
    box.querySelector('#ev-run').onclick = () => run(d, eff, origin, true, box);
    box.querySelector('#ev-here').onclick = () => {
      const canvas = viewer.scene.canvas;
      const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
      const point = ray && viewer.scene.globe.pick(ray, viewer.scene);
      if (!point) { box.querySelector('#ev-result').textContent = '지도 가운데에 지면이 보이도록 이동해 주세요.'; return; }
      const geo = Cesium.Cartographic.fromCartesian(point);
      run(d, eff, { longitude: Cesium.Math.toDegrees(geo.longitude), latitude: Cesium.Math.toDegrees(geo.latitude) }, false, box);
    };
    box.querySelector('#ev-guide').addEventListener('toggle', async e => {
      const g = e.target; if (!g.open || g.dataset.done) return; g.dataset.done = 1;
      try {
        const guide = await api('/api/guides/' + d.type), steps = [...(guide.steps || []), ...Object.values(guide.levels || {}).flatMap(l => l.steps || [])].slice(0, 8);
        g.querySelector('.empty').outerHTML = steps.length ? `<ul>${steps.map(s => `<li>${esc(typeof s === 'string' ? s : s.text || JSON.stringify(s))}</li>`).join('')}</ul>` : '<div class="empty">행동요령이 없습니다.</div>';
      } catch { g.querySelector('.empty').textContent = '행동요령을 불러오지 못했습니다.'; }
    });
  }

  function fly(at) {
    if (!validPosition(at)) return;
    // 발생 지점 남쪽 3 km, 높이 1.6 km에서 비스듬히 내려다봄
    viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(at.longitude, at.latitude - .027, 1600), orientation: { heading: 0, pitch: Cesium.Math.toRadians(-32), roll: 0 }, duration: 2.2 });
  }
  async function run(d, eff, at, move, box) {
    if (!eff?.ready || !validPosition(at) || !window.koreaDisaster) return;
    const result = box.querySelector('#ev-result');
    result.textContent = '기사 규모를 적용하는 중…';
    try {
      if (move) fly(at);
      await window.koreaDisaster.set(eff.type, eff.params, at, { cardId: d.id, title: d.title, sources: eff.sources });
      result.textContent = `${move ? '발생 지역' : '현재 지역'} (${at.latitude.toFixed(4)}°, ${at.longitude.toFixed(4)}°)에 기사 규모를 적용했습니다.`;
    } catch (e) { result.textContent = '적용하지 못했습니다: ' + e.message; }
  }

  root.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    root.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); tab = b.dataset.tab; renderList();
  });
  $('ev-type').onchange = () => (tab === 'recent' ? loadList() : renderList());
  $('ev-region').onchange = renderList;
  $('ev-refresh').onclick = () => loadList();
  loadList();
  return { reload: loadList, openDetail };
}
