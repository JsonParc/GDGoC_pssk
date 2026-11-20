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

/* 고이는 깊이 (m): 비가 오면 물이 갇히는 오목한 곳(웅덩이 · 저지대)을 지형만으로 찾음.
   가장자리 칸부터 낮은 순서로 안쪽으로 채워 가며(priority-flood), 이웃이 지금 수위보다 낮으면 그 수위까지 찬다고 봄
   → 채워진 높이 − 원래 높이. 가장자리와 높이를 모르는 칸(NaN)으로는 물이 빠져나감(그 둘레는 안 고임) */
export function depressionDepth(N, H) {
  const depth = new Float64Array(N * N), done = new Uint8Array(N * N), heap = [];
  const push = (lvl, k) => {
    heap.push([lvl, k]);
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
  for (let k = 0; k < N * N; k++) {
    const i = k % N, j = (k - i) / N;
    if (i === 0 || j === 0 || i === N - 1 || j === N - 1 || !Number.isFinite(H[k])) { done[k] = 1; push(Number.isFinite(H[k]) ? H[k] : -Infinity, k); }
  }
  while (heap.length) {
    const [lvl, k] = pop(), i = k % N, j = (k - i) / N;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const n = b * N + a; if (done[n]) continue;
      done[n] = 1;
      const w = Math.max(H[n], lvl);
      depth[n] = w - H[n];
      push(w, n);
    }
  }
  return depth;
}

/* 물 깊이 → 형광 구간 (등고선 히트맵처럼). 0 = 표시 안 함(2 cm 미만) */
export const DEPTH_BINS = [
  [.02, '#00e5ff', '2–5 cm'], [.05, '#00ffa3', '5–10 cm'], [.1, '#7dff00', '10–20 cm'], [.2, '#f4ff00', '20–50 cm'],
  [.5, '#ffb300', '0.5–1 m'], [1, '#ff5a00', '1–2 m'], [2, '#ff0066', '2 m 넘음'],
];
export function depthBin(d) {
  let bin = -1;
  for (let b = 0; b < DEPTH_BINS.length; b++) if (d >= DEPTH_BINS[b][0]) bin = b;
  return bin;
}

/* 동네 단위 빗물 고임 (호우 침수): 칸마다 반경 r칸 안에서 가장 낮은 땅을 기준으로, 그보다 maxDepth만큼 높은 수위까지 참.
   → 동네마다 가장 낮은 곳이 maxDepth(간이 공식 저지대 침수 깊이)만큼 잠기고, 높아질수록 얕아짐. 영역 전체 물을 가장 낮은 한 곳
   (하천 골짜기 등)에 모으면 수십 m로 깊어져서 이렇게 함. 높이를 모르는 칸 · 제외 칸(exclude)은 0 */
export function localPooling(N, H, r, maxDepth, exclude = null) {
  const INF = Infinity, rowMin = new Float64Array(N * N), lowest = new Float64Array(N * N), depth = new Float64Array(N * N);
  const h = k => Number.isFinite(H[k]) && !(exclude && exclude[k]) ? H[k] : INF;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { // 가로 최솟값 (단순 창, N · r이 작아 충분)
    let m = INF; for (let a = Math.max(0, i - r); a <= Math.min(N - 1, i + r); a++) m = Math.min(m, h(j * N + a));
    rowMin[j * N + i] = m;
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { // 세로
    let m = INF; for (let b = Math.max(0, j - r); b <= Math.min(N - 1, j + r); b++) m = Math.min(m, rowMin[b * N + i]);
    lowest[j * N + i] = m;
  }
  for (let k = 0; k < N * N; k++) {
    const v = h(k);
    depth[k] = Number.isFinite(v) && Number.isFinite(lowest[k]) ? Math.max(0, maxDepth - (v - lowest[k])) : 0;
  }
  return depth;
}
