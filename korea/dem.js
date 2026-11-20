export const demTiles = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const demZoom = 15;
const cache = new Map();
const maxCachedTiles = 32;

export function validateCoordinates(longitude, latitude) {
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      !Number.isFinite(latitude) || Math.abs(latitude) > 85) {
    throw new RangeError('경도는 ±180°, 위도는 ±85° 범위여야 합니다.');
  }
}

async function readTile(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`DEM 타일 응답 오류 (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
}

export async function getElevation(longitude, latitude) {
  validateCoordinates(longitude, latitude);
  const scale = 2 ** demZoom;
  const radians = latitude * Math.PI / 180;
  const x = Math.min((longitude + 180) / 360 * scale, scale - 1e-8);
  const y = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * scale;
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  const url = demTiles.replace('{z}', demZoom).replace('{x}', tileX).replace('{y}', tileY);
  if (!cache.has(url)) {
    const pending = readTile(url).catch(error => {
      if (cache.get(url) === pending) cache.delete(url);
      throw error;
    });
    cache.set(url, pending);
    if (cache.size > maxCachedTiles) cache.delete(cache.keys().next().value);
  }
  const { width, height, data } = await cache.get(url);
  const pixelX = Math.floor((x - tileX) * width);
  const pixelY = Math.floor((y - tileY) * height);
  const index = (pixelY * width + pixelX) * 4;
  if (data[index + 3] === 0) throw new Error('이 좌표에 DEM 값이 없습니다.');
  return data[index] * 256 + data[index + 1] + data[index + 2] / 256 - 32768;
}
