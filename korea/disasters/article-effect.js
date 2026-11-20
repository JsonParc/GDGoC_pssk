// Keep article measurements separate from present-day weather and visual defaults.
export function articleEffect(card, types) {
  const effect = card.map_effect;
  if (!effect?.supported) return null;
  const params = {}, sources = {};
  for (const [key, value] of Object.entries(effect.params || {})) {
    const source = effect.sources?.[key];
    if (Number.isFinite(value) && ['article', 'derived'].includes(source)) {
      params[key] = value; sources[key] = source;
    }
  }
  const viz = card.viz_params || {};
  const put = (key, value, source = 'article') => { params[key] = value; sources[key] = source; };
  if (card.type === 'heavysnow' && Number.isFinite(viz.snowfall_cm) && viz.snowfall_cm >= 0) {
    put('snowDepthCm', viz.snowfall_cm);
    // A measured accumulation is a snapshot, not an invented snowfall duration.
    put('rate', 0, 'display');
  }
  if (card.type === 'coldwave') {
    put('rate', 0, 'display');
    put('snowDepthCm', 0, 'display');
  }
  if (card.type === 'flood' && Number.isFinite(viz.flood_depth_m) && viz.flood_depth_m >= 0) {
    put('waterDepthM', viz.flood_depth_m);
    if (params.rain == null) put('rain', 0, 'display');
  }
  if (effect.type === 'tsunami' && params.height != null) put('runup', 1, 'display');
  if (effect.type === 'quake') put('exag', 1, 'display');
  const primary = { typhoon: ['wind'], flood: ['rain', 'waterDepthM'], earthquake: ['M'], tsunami: ['height'],
    wildfire: ['area'], heatwave: ['temp'], heavysnow: ['snowDepthCm', 'rate'], coldwave: ['temp'] };
  const outside = (types?.[effect.type]?.params || []).filter(q => params[q.key] != null && (params[q.key] < q.min || params[q.key] > q.max));
  const ready = (primary[card.type] || []).some(key => ['article', 'derived'].includes(sources[key])) && outside.length === 0;
  return { ...effect, params, sources, ready, reason: outside.length ? `표현 범위를 벗어난 수치: ${outside.map(q => q.label).join(', ')}. 규모를 임의로 줄이지 않고 적용을 보류합니다.` : '' };
}

export function validPosition(position) {
  return position && Number.isFinite(position.longitude) && Number.isFinite(position.latitude)
    && Math.abs(position.longitude) <= 180 && Math.abs(position.latitude) <= 90;
}
