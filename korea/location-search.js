import { makeDraggable } from './disasters/draggable.js';

let requestId = 0;

function searchVWorld(key, query, type) {
  return new Promise((resolve, reject) => {
    const callback = `koreaVworldSearch${++requestId}`;
    const url = new URL('https://api.vworld.kr/req/search');
    url.search = new URLSearchParams({
      service: 'search', request: 'search', version: '2.0',
      format: 'json', errorformat: 'json', key, domain: location.origin,
      crs: 'EPSG:4326', query, size: '8', page: '1', callback,
      type: type === 'place' ? 'place' : 'address',
    });
    if (type !== 'place') url.searchParams.set('category', type);

    const script = document.createElement('script');
    const timer = setTimeout(() => fail('검색 응답이 지연되고 있습니다.'), 10000);
    function cleanup() {
      clearTimeout(timer);
      delete window[callback];
      script.remove();
    }
    function fail(message) {
      cleanup();
      reject(new Error(message));
    }
    window[callback] = ({ response } = {}) => {
      if (response?.status === 'OK' || response?.status === 'NOT_FOUND') {
        cleanup();
        resolve(response.result?.items ?? []);
      } else {
        fail('검색에 실패했습니다. API 키의 검색 권한과 등록 주소를 확인하세요.');
      }
    };
    script.onload = () => {
      if (window[callback]) fail('브이월드가 검색 결과를 반환하지 않았습니다.');
    };
    script.onerror = () => fail('검색 서버에 연결하지 못했습니다.');
    script.src = url.href;
    document.head.append(script);
  });
}

/* 좌표 → 주소 구조 (브이월드 주소 변환 getAddress, JSONP). 지역 변화 분석에 보낼 지역 이름("서울특별시 강남구 대치동")을 만듦.
   결과: response.result[0].structure { level1 시도, level2 시군구, level4L 법정동, level4A 행정동 … }, 주소가 없으면(바다 등) null */
export function reverseGeocode(key, longitude, latitude) {
  return new Promise((resolve, reject) => {
    if (!key) { reject(new Error('브이월드 키가 없어 주소를 찾을 수 없습니다.')); return; }
    const callback = `koreaVworldAddress${++requestId}`;
    const url = new URL('https://api.vworld.kr/req/address');
    url.search = new URLSearchParams({
      service: 'address', request: 'getAddress', version: '2.0', crs: 'epsg:4326', point: `${longitude},${latitude}`,
      format: 'json', type: 'parcel', zipcode: 'false', simple: 'false', errorformat: 'json', key, domain: location.origin, callback,
    });
    const script = document.createElement('script');
    const timer = setTimeout(() => fail('주소 변환 응답이 지연되고 있습니다.'), 8000);
    function cleanup() { clearTimeout(timer); delete window[callback]; script.remove(); }
    function fail(message) { cleanup(); reject(new Error(message)); }
    window[callback] = ({ response } = {}) => {
      if (response?.status === 'OK') { cleanup(); resolve(response.result?.[0]?.structure ?? null); }
      else if (response?.status === 'NOT_FOUND') { cleanup(); resolve(null); }
      else fail('주소를 찾지 못했습니다.');
    };
    script.onload = () => { if (window[callback]) fail('브이월드가 주소를 반환하지 않았습니다.'); };
    script.onerror = () => fail('주소 변환 서버에 연결하지 못했습니다.');
    script.src = url.href;
    document.head.append(script);
  });
}

function mapPlace(item, query) {
  const longitude = Number.parseFloat(item.point?.x), latitude = Number.parseFloat(item.point?.y);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  const address = item.address?.road || item.address?.parcel;
  return { longitude, latitude, address, title: item.title || item.address?.bldnm || address || query };
}

export async function findMapPlaces(key, query) {
  if (!key) throw new Error('주소 검색을 사용할 수 없어요. 빠른 지역을 선택해 주세요.');
  const types = /\d/.test(query) ? ['road', 'parcel', 'place'] : ['place', 'road', 'parcel'];
  const results = await Promise.allSettled(types.map(type => searchVWorld(key, query, type)));
  if (results.every(result => result.status === 'rejected')) throw results[0].reason;
  const places = new Map();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value) {
      const place = mapPlace(item, query);
      if (!place) continue;
      const id = [place.title, place.longitude.toFixed(5), place.latitude.toFixed(5)].join('|');
      if (!places.has(id)) places.set(id, place);
    }
  }
  return [...places.values()].slice(0, 6);
}

export function enableLocationSearch({ key, viewer, Cesium }) {
  const section = document.querySelector('#location-search');
  const form = section.querySelector('form');
  const input = form.elements.query;
  const status = section.querySelector('[role=status]');
  const results = section.querySelector('#search-results');
  let selection = 0;
  let marker;
  section.hidden = false;
  makeDraggable(section, section.querySelector('.search-grip'), 'vworld-search-pos');

  function selectPlace(longitude, latitude, title) {
    if (marker) viewer.entities.remove(marker);
    const position = Cesium.Cartesian3.fromDegrees(longitude, latitude);
    marker = viewer.entities.add({
      position,
      point: {
        pixelSize: 12, color: Cesium.Color.fromCssColorString('#21cf9a'),
        outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    const location = Cesium.Cartographic.fromDegrees(longitude, latitude);
    const height = viewer.scene.globe.getHeight(location) ?? 0;
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(longitude, latitude, height), 25),
      { offset: new Cesium.HeadingPitchRange(viewer.camera.heading, Cesium.Math.toRadians(-45), 900) },
    );
    input.value = title;
    results.replaceChildren();
    input.focus();
    // 지역 변화 분석 대상 (재난 사건 창의 '지역 분석' 탭)
    window.dispatchEvent(new CustomEvent('map-place-selected', { detail: { longitude, latitude, title } }));
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    const current = ++selection;
    results.replaceChildren();
    status.textContent = '검색 중…';

    try {
      const items = await searchVWorld(key, query, form.elements.type.value);
      if (current !== selection) return;
      for (const item of items) {
        const place = mapPlace(item, query);
        if (!place) continue;
        const { longitude, latitude, title, address } = place;
        const row = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = title;
        if (address && address !== title) {
          const detail = document.createElement('small');
          detail.textContent = address;
          button.append(detail);
        }
        button.addEventListener('click', () => selectPlace(longitude, latitude, title));
        row.append(button);
        results.append(row);
      }
      status.textContent = results.childElementCount ? '' : '검색 결과가 없습니다.';
    } catch (error) {
      if (current === selection) status.textContent = error.message;
    }
  });

  section.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    selection++;
    results.replaceChildren();
    status.textContent = '';
    input.focus();
  });
}
