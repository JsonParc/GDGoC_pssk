import { getElevation, validateCoordinates } from './dem.js';

export function createDisasterLayers(map, MercatorCoordinate) {
  const layers = new Map();
  return {
    async locate({ longitude, latitude, heightAboveGround = 0 }) {
      validateCoordinates(longitude, latitude);
      if (!Number.isFinite(heightAboveGround)) throw new TypeError('지표 기준 높이는 숫자여야 합니다.');
      const groundElevation = await getElevation(longitude, latitude);
      const altitude = groundElevation + heightAboveGround;
      return {
        longitude, latitude, groundElevation, altitude,
        mercator: MercatorCoordinate.fromLngLat([longitude, latitude], altitude),
      };
    },
    addLayer(layer, beforeId) {
      if (!layer.id.startsWith('disaster-')) throw new Error('레이어 ID는 disaster-로 시작해야 합니다.');
      if (map.getLayer(layer.id)) throw new Error(`이미 등록된 레이어: ${layer.id}`);
      if (!map.isStyleLoaded() && !map.loaded()) {
        // Style loading precedes tile loading. A missing DEM source means setup is pending.
        if (!map.getSource('korea-dem')) throw new Error('지도 초기화 후 레이어를 추가하세요.');
      }
      map.addLayer(layer, beforeId);
      if (!map.getLayer(layer.id)) throw new Error(`레이어 추가 실패: ${layer.id}`);
      layers.set(layer.id, layer);
    },
    removeLayer(id) {
      if (!layers.has(id)) return;
      if (map.getLayer(id)) map.removeLayer(id);
      layers.delete(id);
    },
  };
}
