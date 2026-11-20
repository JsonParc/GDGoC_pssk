import { findMapPlaces } from './location-search.js';

export function createOnboarding({ key, launch, previewMap }) {
  const overlay = document.querySelector('#map-start');
  const form = document.querySelector('#map-start-form');
  const input = document.querySelector('#start-query');
  const results = document.querySelector('#start-results');
  const status = document.querySelector('#start-status');
  const start = form.querySelector('.start-submit');
  const startLabel = start.querySelector('.start-label');
  const presets = [...form.querySelectorAll('[data-region]')];
  const cloud = document.querySelector('#map-cloud');
  const assistant = document.querySelector('#map-assistant');
  const motion = matchMedia('(prefers-reduced-motion: no-preference)');
  let place, request, timer, busy = false;

  function clearResults() {
    results.replaceChildren();
    results.hidden = true;
  }

  function select(next, preview = true) {
    place = next;
    input.value = next.title;
    status.textContent = '';
    clearResults();
    for (const button of presets) button.setAttribute('aria-pressed', String(button.dataset.region === next.region));
    if (preview) {
      previewMap(next);
      if (motion.matches) input.animate?.([
        { boxShadow: '0 0 0 0 #a5e2cc88' }, { boxShadow: '0 0 0 8px #a5e2cc00' },
      ], { duration: 360, easing: 'ease-out' });
    }
  }

  function lookup(query) {
    if (request?.query === query) return request.result;
    const current = { query, result: findMapPlaces(key(), query) };
    request = current;
    current.result.catch(() => { if (request === current) request = null; });
    return current.result;
  }

  async function suggest(query) {
    if (busy || document.activeElement !== input || input.value.trim() !== query || place) return;
    try {
      const matches = await lookup(query);
      if (busy || document.activeElement !== input || input.value.trim() !== query || place) return;
      clearResults();
      for (const match of matches) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = match.title;
        if (match.address && match.address !== match.title) {
          const address = document.createElement('small');
          address.textContent = match.address;
          button.append(address);
        }
        button.addEventListener('click', () => { select(match); input.focus({ preventScroll: true }); });
        item.append(button);
        results.append(item);
      }
      results.hidden = !matches.length;
      status.textContent = matches.length ? '' : '검색 결과가 없습니다.';
    } catch (error) {
      if (!busy && !place && input.value.trim() === query) status.textContent = error.message;
    }
  }

  function queueSearch() {
    place = null;
    clearTimeout(timer);
    clearResults();
    status.textContent = '';
    for (const button of presets) button.setAttribute('aria-pressed', 'false');
    const query = input.value.trim();
    if (query.length >= 2 && !presets.some(button => button.textContent === query)) timer = setTimeout(() => suggest(query), 350);
  }
  input.addEventListener('input', event => { if (!event.isComposing) queueSearch(); });
  input.addEventListener('compositionend', queueSearch);
  for (const button of presets) {
    button.addEventListener('click', () => select({ region: button.dataset.region, title: button.textContent }));
  }
  document.addEventListener('pointerdown', event => {
    if (!results.hidden && !event.target.closest('.start-search')) clearResults();
  });
  form.addEventListener('keydown', event => {
    if (results.hidden || event.target !== input && !results.contains(event.target)) return;
    if (event.key === 'Escape') { clearResults(); input.focus(); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const buttons = [...results.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    event.preventDefault();
    if (index < 0 && event.key === 'ArrowUp') buttons.at(-1)?.focus();
    else (buttons[index + (event.key === 'ArrowDown' ? 1 : -1)] || input).focus();
  });

  function setBusy(value) {
    busy = value;
    start.disabled = input.disabled = value;
    for (const button of presets) button.disabled = value;
    startLabel.textContent = value ? '지도 여는 중…' : '시작하기';
  }

  async function reveal() {
    const from = cloud.getBoundingClientRect();
    const dock = document.querySelector('#ev-cloud-slot');
    if (!dock) assistant.hidden = false;
    (dock || assistant).append(cloud);
    document.body.classList.remove('map-onboarding');
    const to = cloud.getBoundingClientRect();
    const transition = motion.matches && typeof cloud.animate === 'function';
    if (transition) {
      cloud.animate([
        { transformOrigin: 'top left', transform: `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${from.width / to.width})` },
        { transformOrigin: 'top left', transform: 'none' },
      ], { duration: 530, easing: 'cubic-bezier(.22,.7,.24,1)' });
      overlay.classList.add('leaving');
      await new Promise(resolve => setTimeout(resolve, 230));
    }
    overlay.hidden = true;
    overlay.classList.remove('leaving');
    document.querySelector('#vmap').inert = false;
    document.querySelector('#ev-close')?.focus({ preventScroll: true });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const query = input.value.trim();
    if (!query) { status.textContent = '지역명이나 주소를 입력해 주세요.'; input.focus(); return; }
    const preset = presets.find(button => button.textContent === query);
    clearTimeout(timer);
    clearResults();
    status.textContent = '';
    setBusy(true);
    try {
      const chosen = place || (preset ? { region: preset.dataset.region, title: query } : (await lookup(query))[0]);
      if (!chosen) throw new Error('검색 결과가 없습니다. 지역명이나 주소를 확인해 주세요.');
      select(chosen, false);
      if (await launch(chosen)) await reveal();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setBusy(false);
      if (!overlay.hidden && status.textContent) input.focus();
    }
  });
}
