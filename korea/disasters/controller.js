import { getElevation, validateCoordinates } from '../dem.js';

function validateIntensity(intensity) {
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
    throw new RangeError('강도는 0~1 사이 숫자여야 합니다.');
  }
}

export function createDisasterController(viewer, Cesium) {
  const effects = new Map();
  const active = new Map();
  const pending = new Map();

  function stop(type) {
    pending.delete(type);
    const effect = active.get(type);
    if (!effect) return;
    effect.destroy();
    active.delete(type);
  }

  return {
    register(type, createEffect) {
      if (typeof type !== 'string' || !type.trim() || typeof createEffect !== 'function') {
        throw new TypeError('효과 이름과 생성 함수가 필요합니다.');
      }
      if (effects.has(type)) throw new Error(`이미 등록된 효과: ${type}`);
      effects.set(type, createEffect);
    },
    async start({ type, longitude, latitude, intensity }) {
      const createEffect = effects.get(type);
      if (!createEffect) throw new RangeError(`지원하지 않는 재난 효과: ${type}`);
      validateCoordinates(longitude, latitude);
      validateIntensity(intensity);
      const cartographic = Cesium.Cartographic.fromDegrees(longitude, latitude);
      stop(type);
      const request = { intensity };
      pending.set(type, request);
      try {
        const groundHeight = viewer.scene.globe.getHeight(cartographic) ?? await getElevation(longitude, latitude);
        if (pending.get(type) !== request) return;
        active.set(type, createEffect({ viewer, Cesium, longitude, latitude, groundHeight, intensity: request.intensity }));
      } finally {
        if (pending.get(type) === request) pending.delete(type);
      }
    },
    setIntensity(type, intensity) {
      validateIntensity(intensity);
      const request = pending.get(type);
      if (request) request.intensity = intensity;
      active.get(type)?.setIntensity(intensity);
    },
    stop,
    isActive: type => active.has(type),
  };
}
