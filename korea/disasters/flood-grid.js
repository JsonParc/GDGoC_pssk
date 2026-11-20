/* 침수 칸 계산 (지도 · Cesium 없이 순수 계산이라 node 테스트로 확인)
   칸 번호 k = j * N + i (i: 동쪽, j: 북쪽) */

/* 잠기는 칸: seeds(물이 들어오는 칸)와 상하좌우로 이어지고 maxLevel보다 낮은 칸.
   높이를 모르는 칸(NaN)은 막힌 곳으로 봄 (0 m = 바다로 보면 그 구역이 통째로 안 잠겼음) */
export function floodFill(N, H, seeds, maxLevel) {
  const fill = new Uint8Array(N * N), stack = [];
  for (const k of seeds) if (!fill[k]) { fill[k] = 1; stack.push(k); }
  while (stack.length) {
    const k = stack.pop(), i = k % N, j = (k - i) / N;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const n = b * N + a; if (fill[n] || !(H[n] < maxLevel)) continue;
      fill[n] = 1; stack.push(n);
    }
  }
  return fill;
}

/* 도달 거리 (칸 단위): seeds부터 fill 칸만 지나는 최단 거리 (상하좌우 1 · 대각선 √2).
   대각선은 양옆 두 칸이 다 fill일 때만 (둑의 대각선 틈으로 새지 않게). 닿지 못한 칸은 Infinity.
   해일 물 끝을 이 거리 순서로 보여서 해안선 모양대로 밀려 들어오게 함 */
export function floodDistance(N, fill, seeds) {
  const dist = new Float64Array(N * N).fill(Infinity), heap = []; // 64비트: 32비트면 √2 반올림 때문에 꺼낸 거리 > 저장 거리가 되어 칸을 건너뜀
  const push = (k, d) => {
    heap.push([d, k]);
    for (let c = heap.length - 1; c > 0;) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let c = 0; ;) {
        const l = 2 * c + 1, r = l + 1; let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m;
      }
    }
    return top;
  };
  for (const k of seeds) if (fill[k] && dist[k] > 0) { dist[k] = 0; push(k, 0); }
  while (heap.length) {
    const [d, k] = pop(); if (d > dist[k]) continue;
    const i = k % N, j = (k - i) / N;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const n = b * N + a; if (!fill[n]) continue;
      if (di && dj && !(fill[j * N + a] && fill[b * N + i])) continue;
      const nd = d + (di && dj ? Math.SQRT2 : 1);
      if (nd < dist[n]) { dist[n] = nd; push(n, nd); }
    }
  }
  return dist;
}
