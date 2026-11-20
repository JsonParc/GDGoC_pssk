import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floodFill, floodDistance } from '../korea/disasters/flood-grid.js';

// 문자열 지도 → 높이 격자 (아래 줄이 j = 0). '~' 바다 0 m, '.' 낮은 땅 5 m, '#' 둑 100 m, '?' 높이 모름(NaN)
function grid(rows) {
  const N = rows.length, H = new Float32Array(N * N), seeds = [];
  rows.slice().reverse().forEach((row, j) => [...row].forEach((ch, i) => {
    const k = j * N + i;
    H[k] = ch === '~' ? 0 : ch === '.' ? 5 : ch === '#' ? 100 : NaN;
    if (ch === '~') seeds.push(k);
  }));
  return { N, H, seeds, at: (i, j) => j * N + i };
}

test('cells with unknown height block the water instead of counting as sea', () => {
  const { N, H, seeds, at } = grid([
    '~...',
    '~??.',
    '~??.',
    '~...',
  ]);
  const fill = floodFill(N, H, seeds, 20);
  assert.equal(fill[at(1, 1)], 0);
  assert.equal(fill[at(2, 2)], 0);
  assert.equal(fill[at(3, 2)], 1); // 둘러 가서 잠김
});

test('dikes higher than the water level keep the land behind them dry', () => {
  const { N, H, seeds, at } = grid([
    '~#..',
    '~#..',
    '~#..',
    '~#..',
  ]);
  const fill = floodFill(N, H, seeds, 20);
  assert.equal(fill[at(2, 0)], 0);
  assert.equal(floodFill(N, H, seeds, 150)[at(3, 3)], 1); // 둑보다 높은 물이면 넘어감
});

test('reach distance spreads with straight and diagonal steps', () => {
  const { N, H, at } = grid([
    '.....',
    '.....',
    '.....',
    '.....',
    '.....',
  ]);
  const seeds = [at(0, 0)];
  const dist = floodDistance(N, floodFill(N, H, seeds, 20), seeds);
  assert.equal(dist[at(0, 0)], 0);
  assert.equal(dist[at(4, 0)], 4);
  assert.ok(Math.abs(dist[at(4, 4)] - 4 * Math.SQRT2) < 1e-5);
  assert.ok(Math.abs(dist[at(4, 2)] - (2 + 2 * Math.SQRT2)) < 1e-5);
});

test('water does not squeeze through a diagonal gap in a dike', () => {
  const { N, H, at } = grid([
    '...',
    '.#.',
    '..#',
  ]);
  const seeds = [at(1, 0)];
  const fill = floodFill(N, H, seeds, 20);
  const dist = floodDistance(N, fill, seeds);
  // (1,0) → (2,1) 대각선은 (2,0) · (1,1) 둑 사이라 못 지나감: 위로 돌아서 감
  assert.equal(fill[at(2, 1)], 1);
  assert.ok(dist[at(2, 1)] > Math.SQRT2 + 1e-5);
});

test('unreached cells stay at Infinity', () => {
  const { N, H, at } = grid([
    '..#.',
    '..#.',
    '..#.',
    '~.#.',
  ]);
  const seeds = [at(0, 0)];
  const dist = floodDistance(N, floodFill(N, H, seeds, 20), seeds);
  assert.equal(dist[at(3, 3)], Infinity);
});

test('rain pools in a bowl up to its rim and drains off a slope', async () => {
  const { depressionDepth, depthBin } = await import('../korea/disasters/flood-grid.js');
  // 5×5: 가장자리 10 m, 안쪽 고리 8 m, 가운데 7 m → 가운데는 테두리(8 m 둘레를 넘는 낮은 출구가 없음)까지 참
  const N = 5, H = new Float64Array(N * N).fill(10);
  for (let j = 1; j < 4; j++) for (let i = 1; i < 4; i++) H[j * N + i] = 8;
  H[2 * N + 2] = 7;
  const d = depressionDepth(N, H);
  assert.equal(d[2 * N + 2], 3); // 가장자리 10 m까지
  assert.equal(d[1 * N + 1], 2);
  // 한쪽 가장자리가 6 m로 트이면 그쪽으로 빠져 7 m 가운데만 고임 (8 m 고리 높이까지 1 m)
  H[2 * N + 0] = 6; H[2 * N + 1] = 8;
  const d2 = depressionDepth(N, H);
  assert.equal(d2[2 * N + 2], 1);
  assert.equal(d2[1 * N + 1], 0);
  // 비탈은 안 고임, 높이 모르는 칸 둘레로는 빠짐
  const S = Float64Array.from({ length: 16 }, (_, k) => k % 4);
  assert.ok(depressionDepth(4, S).every(v => v === 0));
  assert.equal(depthBin(.01), -1);
  assert.equal(depthBin(.7), 4);
  assert.equal(depthBin(5), 6);
});
