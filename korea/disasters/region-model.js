/* 지역 변화 분석 (백엔드 /api/regions/analyze · /api/analysis/{job}) 응답 → 화면에 보일 값. DOM 없이 순수 계산이라 node 테스트로 확인.
   백엔드가 준 사실만 그대로 옮기고, 없는 값은 비워 둠 (날짜 · 수치 · 출처를 만들어 내지 않음) */

export const STAGE_LABEL = {
  queued: '대기 중', news_search: '뉴스 검색', extraction: '정보 추출', timeline: '타임라인 구성', scenario: '시나리오 생성', done: '완료',
};
// 백엔드 region_extract.py STATUSES
export const STATUS_LABEL = {
  occurred: ['발생', '#d9704a'], planned: ['계획', '#8a8f98'], under_construction: ['착공 · 공사 중', '#c9a227'],
  completed: ['준공', '#3fb37f'], unknown: ['확인불가', '#6c757d'],
};
// 백엔드 region_extract.py CHANGE_TYPES
export const CHANGE_LABEL = {
  disaster_event: '재난 발생 · 피해', drainage_pump: '배수 · 빗물펌프장', drainage_pipe: '하수관로 · 배수관 정비',
  floodwall: '차수벽 · 차수판 · 방수문', levee_river: '제방 · 하천 정비', retention: '저류조 · 저류지 · 유수지',
  fire_prevention: '산불 대응 시설', greenery: '녹지 · 숲', other: '그 밖의 방재 시설',
};
export const EVIDENCE_LABEL = { verified: ['근거 문구 확인', '#3fb37f'], inferred: ['근거 문구 미확인', '#c9a227'] };
export const PARAM_EVIDENCE_LABEL = { article: ['기사', '#3fb37f'], derived: ['기사로 계산', '#5aa0c8'], assumed: ['가정값', '#c9a227'] };
export const QUALITY_LABEL = { evidence: '모든 값이 기사 근거', partial: '일부 값은 가정', illustrative: '모든 값이 가정 (예시)' };
// 백엔드 METRICS → 보이는 이름 · 단위
export const METRIC_LABEL = {
  rain_mm: ['누적 강수량', 'mm'], rain_rate_mm_h: ['시간당 강수량', 'mm/h'], duration_hours: ['지속 시간', '시간'],
  flood_depth_m: ['침수 깊이', 'm'], flooded_buildings: ['침수 건물', '동'], burned_area_ha: ['피해 면적', 'ha'],
  max_wind_ms: ['최대 풍속', 'm/s'], snowfall_cm: ['적설', 'cm'], magnitude: ['규모', ''], max_temp_c: ['최고 기온', '°C'],
  casualties: ['인명 피해', '명'], evacuees: ['대피', '명'], design_rain_before_mm_h: ['설계 강우 (전)', 'mm/h'],
  design_rain_after_mm_h: ['설계 강우 (후)', 'mm/h'], pump_capacity_m3_min: ['펌프 용량', 'm³/분'],
};
const SCENARIO_ROWS = [['rain', '시간당 강수량', 'mm/h'], ['hours', '지속 시간', '시간'], ['drain', '배수 능력', 'mm/h']];
export const POLL_MS = 2500, GIVE_UP_MS = 300000; // 백엔드 작업 제한 240초 + 여유

/* 분석 작업 응답(POST analyze 또는 GET analysis) → 진행 상태 */
export function jobState(r) {
  if (!r || typeof r !== 'object') return { phase: 'failed', progress: 0, stage: '', error: '서버 응답을 읽지 못했습니다.' };
  const progress = Math.max(0, Math.min(100, Number(r.progress) || (r.status === 'completed' ? 100 : 0)));
  const stage = STAGE_LABEL[r.stage] || (r.status === 'queued' ? STAGE_LABEL.queued : r.stage || '');
  if (r.status === 'completed') return { phase: 'done', progress: 100, stage: STAGE_LABEL.done, error: null };
  if (r.status === 'failed') return { phase: 'failed', progress, stage, error: r.error || '분석에 실패했습니다. 다시 시도해 주세요.' };
  return { phase: 'running', progress, stage, error: null };
}

/* 오래 기다려도 끝나지 않으면 멈추고 다시 시도 안내 (무한 로딩 금지) */
export const gaveUp = elapsedMs => elapsedMs > GIVE_UP_MS;

/* HTTP 오류 응답 → 사람이 읽을 문장 */
export function errorMessage(status, body) {
  const detail = body && typeof body.detail === 'string' ? body.detail : null;
  if (detail) return detail;
  if (status === 429) return '분석 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.';
  if (status === 503) return '뉴스 검색 · AI 분석을 지금 쓸 수 없습니다. 잠시 뒤 다시 시도해 주세요.';
  if (status === 400) return '위치를 다시 선택해 주세요. (대한민국 안 · 반경 0.5~30 km)';
  return `서버 응답 ${status}`;
}

/* 타임라인 항목 하나 → 보일 값 */
export function changeView(c) {
  const status = STATUS_LABEL[c.status] || STATUS_LABEL.unknown;
  const evidence = EVIDENCE_LABEL[c.evidence_status] || ['근거 확인 안 됨', '#6c757d'];
  const metrics = Object.entries(c.metrics || {}).filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => { const [label, unit] = METRIC_LABEL[k] || [k, '']; return { label, value: `${v}${unit ? ' ' + unit : ''}` }; });
  const sources = (c.sources || []).filter(s => /^https?:\/\//i.test(s.url || '')) // 주소가 없거나 이상하면 링크를 만들지 않음
    .map(s => ({ title: s.title || s.url, url: s.url, publisher: s.publisher || '', date: (s.published_at || '').slice(0, 10), note: s.evidence_note || '' }));
  return {
    id: c.id, date: c.date || null, dateText: c.date || '날짜 확인불가',
    kind: CHANGE_LABEL[c.change_type] || CHANGE_LABEL.other, isEvent: c.change_type === 'disaster_event',
    disasterType: c.disaster_type || null, facility: c.facility_name || '', description: c.description || '',
    status: status[0], statusColor: status[1], evidence: evidence[0], evidenceColor: evidence[1],
    metrics, sources, conflict: Array.isArray(c.conflicts) && c.conflicts.length > 1,
    replayable: c.change_type === 'disaster_event' && !!c.map_effect?.supported,
  };
}

/* 분석 결과 → 타임라인 (백엔드가 날짜순으로 줌. 날짜 없는 항목은 맨 뒤) */
export function timelineView(result) {
  const changes = Array.isArray(result?.changes) ? result.changes : [];
  const items = changes.map(changeView).sort((a, b) => (a.date === null) - (b.date === null) || String(a.date ?? '').localeCompare(String(b.date ?? '')));
  return { items, empty: items.length ? null : (result?.empty_message || '확인된 자료 없음'), notice: result?.notice || '' };
}

/* 홍수 전 · 후 시나리오 → 비교 표 · 사용 가능 여부.
   준공 확인된 배수 시설이 없으면(comparison_available false) 비교를 막고, 사용자가 '가정 시나리오'를 직접 고를 때만 엶 */
export function scenarioView(s, allowAssumed = false) {
  if (!s || !s.before || !s.after) return { exists: false, available: false, reason: '시나리오가 없습니다.' };
  const evidence = s.param_evidence || {};
  const label = key => PARAM_EVIDENCE_LABEL[evidence[key]] || PARAM_EVIDENCE_LABEL.assumed; // 표시 없는 값은 가정으로 봄
  const rows = SCENARIO_ROWS.map(([key, name, unit]) => {
    const b = s.before.params?.[key], a = s.after.params?.[key];
    return { key, label: name, unit, before: b, after: a, changed: b !== a,
      evidenceBefore: label(key === 'drain' ? 'drain_before' : key), evidenceAfter: label(key === 'drain' ? 'drain_after' : key) };
  });
  const verified = !!s.comparison_available;
  return {
    exists: true, verified, needsConsent: !verified, available: verified || !!allowAssumed,
    reason: verified ? null : (s.reason || '확인된 자료 없음: 준공이 확인된 배수 · 방재 시설 변화가 없습니다.'),
    quality: QUALITY_LABEL[s.data_quality] || '', assumptions: Array.isArray(s.assumptions) ? s.assumptions : [],
    baselineDate: s.baseline_date || null, position: s.position || null, rows,
    facilities: Array.isArray(s.facilities) ? s.facilities : null, whatIf: !!s.whatIf, level: s.level || 'completed',
    before: s.before, after: s.after,
    sources: (s.sources || []).filter(x => /^https?:\/\//i.test(x.url || '')),
  };
}

/* 반영할 시설 범위: 준공만(백엔드와 같은 기준) / 착공 · 공사 중까지 / 계획까지 */
export const FACILITY_LEVELS = {
  completed: ['준공만', ['completed']],
  building: ['착공 · 공사 중까지', ['completed', 'under_construction']],
  planned: ['계획까지', ['completed', 'under_construction', 'planned']],
};
// 기사에 설계 강우량이 없을 때 시설 하나가 늘리는 배수 능력 (mm/h, 시연용 가정값). 차수벽 · 제방은 하천 범람을 막는 시설이라 배수 능력엔 넣지 않음
export const DRAIN_GAIN = { drainage_pump: 15, retention: 10, drainage_pipe: 5, floodwall: 0, levee_river: 0 };
const DRAIN_MAX = 120; // 지도 효과 배수 능력 최대 (js/disaster.js flood drain)

/* 고른 범위의 배수 시설로 '공사 후' 배수 능력을 다시 정한 시나리오 (백엔드 scenario 모양 그대로 → scenarioView에 넣음).
   공사 전 = 백엔드 값(기사 또는 가정 40). 공사 후 = 반영 시설 중 기사 설계 강우량(design_rain_after_mm_h)의 최댓값,
   없으면 공사 전 + 시설 종류별 가정 증가분의 합. 비 · 시간 · 위치는 백엔드 값 그대로 (배수만 바뀜) */
export function facilityScenario(result, level = 'completed') {
  const s = result?.scenario;
  if (!s?.before?.params || !s?.after?.params) return null;
  const statuses = (FACILITY_LEVELS[level] || FACILITY_LEVELS.completed)[1];
  const facilities = (Array.isArray(result.changes) ? result.changes : [])
    .filter(c => Object.hasOwn(DRAIN_GAIN, c.change_type) && statuses.includes(c.status))
    .map(c => {
      const article = Number(c.metrics?.design_rain_after_mm_h);
      return { id: c.id, name: c.facility_name || c.description || '', type: c.change_type, status: c.status, date: c.date || null,
        evidence: c.evidence_status, article: Number.isFinite(article) && article > 0 ? article : null, gain: DRAIN_GAIN[c.change_type] };
    });
  const before = s.before.params.drain;
  const articles = facilities.filter(f => f.article != null).map(f => f.article);
  const counted = facilities.filter(f => f.article != null || f.gain > 0);
  let after = before, afterEvidence = 'assumed';
  if (articles.length) { after = Math.max(before, ...articles); afterEvidence = 'article'; }
  else after = Math.min(DRAIN_MAX, before + facilities.reduce((sum, f) => sum + f.gain, 0));
  const whatIf = facilities.some(f => f.status !== 'completed');
  const evidence = { ...(s.param_evidence || {}), drain_after: afterEvidence };
  const assumptions = (s.assumptions || []).filter(a => !/^drain_after/.test(a));
  if (afterEvidence === 'assumed' && counted.length) assumptions.push(`drain_after = ${after} (공사 전 ${before} + 시설 종류별 가정 증가분, 실제 설계값 아님)`);
  const assumedCount = Object.values(evidence).filter(v => v === 'assumed').length;
  return {
    ...s,
    after: { ...s.after, params: { ...s.after.params, ...s.before.params, drain: after } },
    param_evidence: evidence, assumptions, facilities, whatIf, level,
    comparison_available: counted.length > 0 && (level !== 'completed' || s.comparison_available),
    reason: counted.length ? s.reason : `확인된 자료 없음: ${FACILITY_LEVELS[level]?.[0] || ''} 범위에 배수 능력을 늘리는 시설이 없습니다.`,
    data_quality: assumedCount === 0 ? 'evidence' : assumedCount === Object.keys(evidence).length ? 'illustrative' : 'partial',
  };
}

/* 전 · 후 전환: 위치 · 비 · 시간은 그대로 두고 배수 능력만 바뀌었는지 확인 (다른 값이 다르면 비교가 아님) */
export function onlyDrainDiffers(before, after) {
  const b = before?.params || {}, a = after?.params || {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys].every(k => k === 'drain' || b[k] === a[k]);
}

/* 브이월드 주소 변환(getAddress) 결과 structure → 백엔드에 보낼 지역 이름 ("서울특별시 강남구 대치동") */
export function regionNameFromAddress(structure) {
  if (!structure) return '';
  return [structure.level1, structure.level2, structure.level4L || structure.level4A].map(s => (s || '').trim()).filter(Boolean).join(' ');
}

export const inKoreaPoint = p => !!p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  && p.latitude >= 32 && p.latitude <= 39.5 && p.longitude >= 124 && p.longitude <= 132;
