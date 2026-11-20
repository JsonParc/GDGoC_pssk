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
    const r = panel.getBoundingClientRect(), parent = panel.offsetParent ? panel.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
    drag = { x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, ox: parent.left, oy: parent.top, id: e.pointerId };
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
