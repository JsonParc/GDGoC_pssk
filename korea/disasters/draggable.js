/* 화면 좌표 → style.left/top 좌표의 기준점. offsetParent(body)의 위치를 빼면 브이월드 페이지에서 8 px 어긋나
   끌 때마다 패널이 위로 밀렸음 → 지금 화면 위치와 계산된 left/top의 차이로 구함 */
function originOf(el) {
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  return { left: r.left - (parseFloat(cs.left) || 0), top: r.top - (parseFloat(cs.top) || 0) };
}

/* 패널 끌어서 옮기기: 제목 줄(handle)을 잡고 끌면 패널이 따라옴. 화면 밖으로는 못 나감.
   위치는 이 브라우저에 저장(key)해 다음에 열어도 그 자리. 제목 줄을 두 번 누르면 원래 자리로 */
export function makeDraggable(panel, handle, key) {
  const store = { get() { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
    set(v) { try { v ? localStorage.setItem(key, JSON.stringify(v)) : localStorage.removeItem(key); } catch { /* 저장 불가 */ } } };
  const isOpener = panel === handle;
  handle.style.cursor = 'grab'; handle.style.touchAction = 'none';
  handle.title = handle.title || (isOpener ? '클릭해서 열기 · 끌어서 옮기기' : '끌어서 옮기기 · 두 번 누르면 원래 자리');
  const place = (x, y) => {
    const w = panel.offsetWidth;
    x = Math.max(0, Math.min(innerWidth - Math.min(w, 120), x)); y = Math.max(0, Math.min(innerHeight - 40, y)); // 최소 일부는 화면 안에
    Object.assign(panel.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    return { x, y };
  };
  const saved = store.get(); if (saved) place(saved.x, saved.y);
  let drag = null, suppressClick = false;
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (!isOpener && e.target.closest('button, input, select, a'))) return;
    suppressClick = false;
    const r = panel.getBoundingClientRect(), o = originOf(panel);
    drag = { x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, ox: o.left, oy: o.top, id: e.pointerId };
    if (!isOpener) {
      try { handle.setPointerCapture(e.pointerId); } catch { /* 일부 환경에선 캡처 불가 */ }
      e.preventDefault();
    }
  });
  handle.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.pos) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < (isOpener ? 9 : 5)) return;
      if (isOpener) {
        try { handle.setPointerCapture(e.pointerId); } catch { /* 일부 환경에선 캡처 불가 */ }
      }
      handle.style.cursor = 'grabbing';
    }
    drag.pos = place(e.clientX - drag.dx - drag.ox, e.clientY - drag.dy - drag.oy);
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.pos) { store.set(drag.pos); suppressClick = isOpener; }
    drag = null; handle.style.cursor = 'grab';
  };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  handle.addEventListener('lostpointercapture', end);
  if (isOpener) handle.addEventListener('pointerleave', e => { if (drag && !drag.pos) end(e); });
  if (isOpener) handle.addEventListener('click', e => {
    if (!suppressClick || e.detail === 0) return;
    suppressClick = false; e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  handle.addEventListener('dblclick', e => {
    if (e.target.closest('button, input, select, a')) return;
    store.set(null); for (const k of ['left', 'top', 'right', 'bottom']) panel.style[k] = '';
  });
  // 창 크기가 바뀌면 화면 안으로 다시 맞춤
  addEventListener('resize', () => { const s = store.get(); if (s) place(s.x, s.y); });
}

/* 앱 창처럼 다루는 패널 (재난 · 기후변화 패널, 재난 사건 목록):
   - 안쪽 아무 곳이나 끌면 옮김 (버튼 · 입력 · 슬라이더 · 셀렉트 · 링크 · 목록 카드는 원래대로 누름).
     터치는 내용을 스크롤해야 해서 제목 줄(header)로만 옮김
   - 테두리 8 px 안에 마우스를 대면 크기 조절 커서 → 끌면 그 변 · 모서리 쪽으로 크기 조절
   - 위치 · 크기는 이 브라우저에 저장(key, key + '-size'). 제목 줄을 두 번 누르면 원래 자리 · 크기로 */
const EDGE = 8, MIN_W = 260, MIN_H = 180;
const INTERACTIVE = 'button, input, select, textarea, a, summary, label, [role=button], [contenteditable], .card';
const CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
let windowStyle;
function addWindowStyle() {
  if (windowStyle) return;
  windowStyle = document.createElement('style');
  // 테두리 위에선 안쪽 버튼 · 글자 위라도 크기 조절 커서 / 끄는 동안 글자 선택 막음
  windowStyle.textContent = Object.entries(CURSORS).map(([edge, cursor]) => `.map-window[data-edge="${edge}"], .map-window[data-edge="${edge}"] *{cursor:${cursor}!important}`).join('\n')
    + '\n.map-window.map-window-moving, .map-window.map-window-moving *{cursor:grabbing!important;user-select:none}';
  document.head.append(windowStyle);
}

export function makeWindow(panel, header, key) {
  addWindowStyle();
  panel.classList.add('map-window');
  const store = name => ({
    get() { try { return JSON.parse(localStorage.getItem(name) || 'null'); } catch { return null; } },
    set(v) { try { v ? localStorage.setItem(name, JSON.stringify(v)) : localStorage.removeItem(name); } catch { /* 저장 불가 */ } },
  });
  const posStore = store(key), sizeStore = store(key + '-size');
  header.style.cursor = 'grab'; header.style.touchAction = 'none';
  header.title = header.title || '끌어서 옮기기 · 테두리를 끌어 크기 조절 · 두 번 누르면 원래 자리';

  function place(x, y) {
    const w = panel.offsetWidth;
    x = Math.max(0, Math.min(innerWidth - Math.min(w, 120), x)); y = Math.max(0, Math.min(innerHeight - 40, y)); // 최소 일부는 화면 안에
    Object.assign(panel.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    return { x, y };
  }
  function resize(w, h) {
    w = Math.max(MIN_W, Math.min(innerWidth - 8, w)); h = Math.max(MIN_H, Math.min(innerHeight - 8, h));
    Object.assign(panel.style, { width: w + 'px', height: h + 'px', maxHeight: 'none' });
    return { w, h };
  }
  const savedSize = sizeStore.get(); if (savedSize) resize(savedSize.w, savedSize.h);
  const savedPos = posStore.get(); if (savedPos) place(savedPos.x, savedPos.y);

  function edgeAt(e) {
    const r = panel.getBoundingClientRect();
    const v = e.clientY - r.top < EDGE ? 'n' : r.bottom - e.clientY < EDGE ? 's' : '';
    const h = e.clientX - r.left < EDGE ? 'w' : r.right - e.clientX < EDGE ? 'e' : '';
    return v + h;
  }

  let act = null, suppressClick = false;
  panel.addEventListener('pointermove', e => {
    if (act || e.pointerType !== 'mouse') return;
    const edge = edgeAt(e);
    if (edge) panel.dataset.edge = edge; else delete panel.dataset.edge;
  });
  panel.addEventListener('pointerleave', () => { if (!act) delete panel.dataset.edge; });

  // 캡처 단계: 테두리 위면 안쪽 버튼보다 먼저 크기 조절을 잡음
  panel.addEventListener('pointerdown', e => {
    suppressClick = false;
    if (e.button !== 0) return;
    const edge = e.pointerType === 'touch' ? '' : edgeAt(e);
    const inHeader = header.contains(e.target);
    if (!edge) {
      if (e.target.closest(INTERACTIVE)) return;
      if (e.pointerType === 'touch' && !inHeader) return;
    }
    const r = panel.getBoundingClientRect(), p = originOf(panel);
    act = { edge, id: e.pointerId, x: e.clientX, y: e.clientY, r, ox: p.left, oy: p.top, moved: false };
    try { panel.setPointerCapture(e.pointerId); } catch { /* 일부 환경에선 캡처 불가 */ }
    if (edge) { e.stopPropagation(); e.preventDefault(); }
    else if (inHeader || e.pointerType !== 'touch') e.preventDefault(); // 글자 선택 대신 옮김
  }, true);

  panel.addEventListener('pointermove', e => {
    if (!act || e.pointerId !== act.id) return;
    const dx = e.clientX - act.x, dy = e.clientY - act.y;
    if (!act.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      act.moved = true;
      if (!act.edge) panel.classList.add('map-window-moving');
      // 오른쪽 · 아래 기준 자리(CSS right)를 왼쪽 · 위 기준으로 바꿔 둠
      place(act.r.left - act.ox, act.r.top - act.oy);
    }
    const { r, edge } = act;
    if (!edge) { act.pos = place(r.left - act.ox + dx, r.top - act.oy + dy); return; }
    let w = r.width, h = r.height, x = r.left - act.ox, y = r.top - act.oy;
    if (edge.includes('e')) w = r.width + dx;
    if (edge.includes('s')) h = r.height + dy;
    if (edge.includes('w')) { w = Math.max(MIN_W, r.width - dx); x = r.left - act.ox + (r.width - w); }
    if (edge.includes('n')) { h = Math.max(MIN_H, r.height - dy); y = r.top - act.oy + (r.height - h); }
    act.size = resize(w, h);
    act.pos = place(x, y);
  });

  const end = e => {
    if (!act || e.pointerId !== act.id) return;
    if (act.pos) posStore.set(act.pos);
    if (act.size) sizeStore.set(act.size);
    suppressClick = act.moved;
    panel.classList.remove('map-window-moving');
    act = null;
  };
  panel.addEventListener('pointerup', end); panel.addEventListener('pointercancel', end);
  panel.addEventListener('lostpointercapture', end);
  // 끌거나 크기를 바꾼 뒤 손을 뗀 자리의 클릭은 무시 (버튼이 눌리지 않게)
  panel.addEventListener('click', e => {
    if (!suppressClick) return;
    suppressClick = false; e.preventDefault(); e.stopPropagation();
  }, true);

  header.addEventListener('dblclick', e => {
    if (e.target.closest(INTERACTIVE)) return;
    posStore.set(null); sizeStore.set(null);
    for (const k of ['left', 'top', 'right', 'bottom', 'width', 'height', 'maxHeight']) panel.style[k] = '';
  });
  addEventListener('resize', () => {
    const s = sizeStore.get(); if (s) resize(s.w, s.h);
    const p = posStore.get(); if (p) place(p.x, p.y);
  });
}
