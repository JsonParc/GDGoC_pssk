/* 물 깊이 범례 창: '물 깊이 색으로 보기'를 켰을 때만 오른쪽 지도 버튼 옆에 뜸. 끌어서 옮기고 테두리로 크기 조절 (makeWindow).
   색 스펙트럼(깊이 구간) · 깊이 척도 · 지금 보이는 최대 깊이와 잠긴 넓이(fx.js의 'map-depth-stats').
   ✕를 누르면 히트맵을 끔 (panel.setDepthMap(false)) */
import { makeWindow } from './draggable.js';
import { DEPTH_BINS } from './flood-grid.js';

const STYLE = `
#depth-legend{position:absolute;z-index:6;right:6px;bottom:44px;width:214px;max-height:calc(100dvh - 120px);
  display:flex;flex-direction:column;background:#202c2cf2;color:#f1f5f0;border:1px solid #425552;border-radius:13px;box-shadow:0 6px 24px #0006;
  font-size:12.5px;line-height:1.4;box-sizing:border-box;overflow:hidden}
#depth-legend[hidden]{display:none!important}
#depth-legend *{box-sizing:border-box}
#depth-legend header{display:flex;align-items:center;gap:6px;padding:10px 12px 6px}
#depth-legend header b{flex:1;font-size:13.5px}
#depth-legend header button{background:none;border:0;color:#b5c5bf;font-size:16px;cursor:pointer;padding:2px 6px;border-radius:6px}
#depth-legend header button:hover{background:#314440}
#depth-legend .dl-body{overflow:auto;padding:0 12px 12px;min-height:0;flex:1}
#depth-legend .dl-scale{display:grid;grid-template-columns:18px 1fr;gap:0 9px;margin-top:4px}
#depth-legend .dl-bar{grid-row:1 / span 7;border-radius:5px;min-height:150px}
#depth-legend .dl-scale span{display:flex;align-items:center;min-height:21px;font-variant-numeric:tabular-nums}
#depth-legend .dl-scale span i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;flex:none}
#depth-legend .dl-stat{margin-top:10px;padding:8px 9px;border-radius:9px;background:#182624;font-size:12px}
#depth-legend .dl-stat b{font-size:13px}
#depth-legend .dl-note{margin:8px 0 0;color:#a9bbb3;font-size:11px}
`;

export function attachDepthLegend({ panel }) {
  const style = document.createElement('style'); style.textContent = STYLE; document.head.append(style);
  const root = document.createElement('section');
  root.id = 'depth-legend'; root.hidden = true; root.setAttribute('aria-label', '물 깊이 범례');
  // 깊은 구간이 위로 (지도 높이 척도처럼)
  const bins = DEPTH_BINS.map(([min, color, label]) => ({ min, color, label })).reverse();
  root.innerHTML = `
    <header><b>물 깊이 (형광)</b><button type="button" id="dl-close" aria-label="물 깊이 색 끄기" title="끄기">✕</button></header>
    <div class="dl-body">
      <div class="dl-scale"><div class="dl-bar" style="background:linear-gradient(${bins.map(b => b.color).join(',')})"></div>
        ${bins.map(b => `<span><i style="background:${b.color}"></i>${b.label}</span>`).join('')}</div>
      <div class="dl-stat" id="dl-stat" role="status">계산 중…</div>
      <p class="dl-note" id="dl-note"></p>
    </div>`;
  document.body.append(root);
  makeWindow(root, root.querySelector('header'), 'depth-legend-pos');
  const $ = id => root.querySelector('#' + id);
  $('dl-close').onclick = () => panel?.setDepthMap?.(false);
  const fmt = v => v >= 1 ? `${v.toFixed(2)} m` : `${Math.round(v * 100)} cm`;
  addEventListener('map-depthmap', e => {
    root.hidden = !e.detail;
    if (e.detail) { $('dl-stat').textContent = '계산 중…'; $('dl-note').textContent = ''; }
  });
  addEventListener('map-depth-stats', e => {
    const d = e.detail;
    if (!d) { $('dl-stat').textContent = '표시할 물이 없습니다.'; return; }
    $('dl-stat').innerHTML = d.areaKm2 > 0
      ? `${d.mode ? `<div>${d.mode}</div>` : ''}최대 깊이 <b>${fmt(d.max)}</b> · 넓이 <b>${d.areaKm2 < 1 ? Math.round(d.areaKm2 * 100) / 100 : d.areaKm2.toFixed(1)} km²</b>`
      : `${d.mode ? `${d.mode}: ` : ''}2 cm 넘게 고이는 곳이 없습니다.`;
    $('dl-note').textContent = '지형 계산 + 간이 공식 · 가정값 기반 표시이며 실제 침수 예측이 아닙니다.';
  });
  return { root };
}
