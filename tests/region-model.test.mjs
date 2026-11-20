import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  jobState, gaveUp, errorMessage, changeView, timelineView, scenarioView, onlyDrainDiffers, regionNameFromAddress, inKoreaPoint, GIVE_UP_MS,
} from '../korea/disasters/region-model.js';

// 백엔드 regions.py load_changes / build_scenario 응답 모양
const change = (over = {}) => ({
  id: 1, change_type: 'drainage_pump', disaster_type: 'flood', facility_name: '대치 빗물펌프장', description: '빗물펌프장 증설',
  status: 'planned', occurred_at: null, started_at: null, completed_at: null, location: null, metrics: {}, confidence: 0.6,
  evidence_status: 'verified', conflicts: [], sources: [{ id: 3, title: '펌프장 증설 추진', url: 'https://news.example/a', publisher: 'news.example', published_at: '2024-05-02T00:00:00', evidence_note: '증설 추진' }],
  date: '2024-05', viz_params: {}, map_effect: null, ...over,
});
const scenario = (over = {}) => ({
  position: { longitude: 127.06, latitude: 37.5 }, base_conditions: { rain: 80, hours: 12 },
  before: { type: 'flood', params: { rain: 80, hours: 12, drain: 40 } }, after: { type: 'flood', params: { rain: 80, hours: 12, drain: 60 } },
  param_evidence: { rain: 'assumed', hours: 'assumed', drain_before: 'assumed', drain_after: 'assumed' },
  assumptions: ['rain = 80 (시연용 가정값, 실제 측정·설계값 아님)'], comparison_available: false,
  reason: '확인된 자료 없음: 준공이 확인된 배수·방재 시설 변화가 없습니다.', baseline_date: null, data_quality: 'illustrative', sources: [], ...over,
});

test('job progress, completion and failure come from the server, never stay loading', () => {
  assert.deepEqual(jobState({ status: 'running', stage: 'extraction', progress: 40 }), { phase: 'running', progress: 40, stage: '정보 추출', error: null });
  assert.equal(jobState({ status: 'completed', stage: 'done', progress: 100 }).phase, 'done');
  const failed = jobState({ status: 'failed', stage: 'news_search', progress: 10, error: '검색 한도 초과. 다시 시도해 주세요.' });
  assert.equal(failed.phase, 'failed');
  assert.match(failed.error, /다시 시도/);
  assert.equal(jobState(null).phase, 'failed');
  assert.equal(gaveUp(GIVE_UP_MS + 1), true);
  assert.equal(gaveUp(10000), false);
});

test('server error details are shown as-is, with fallbacks for 429/503', () => {
  assert.equal(errorMessage(400, { detail: '대한민국 안의 좌표가 아닙니다.' }), '대한민국 안의 좌표가 아닙니다.');
  assert.match(errorMessage(429, null), /잠시 뒤/);
  assert.match(errorMessage(503, {}), /쓸 수 없습니다/);
});

test('a planned facility stays "계획" and is not shown as completed', () => {
  const v = changeView(change());
  assert.equal(v.status, '계획');
  assert.equal(v.kind, '배수 · 빗물펌프장');
  assert.equal(v.evidence, '근거 문구 확인');
  assert.equal(changeView(change({ status: 'completed' })).status, '준공');
  assert.equal(changeView(change({ status: 'weird' })).status, '확인불가');
});

test('sources without a real URL never become links', () => {
  const v = changeView(change({ sources: [{ title: '주소 없음', url: '' }, { title: 'js', url: 'javascript:alert(1)' }, { title: 'ok', url: 'https://a.kr/x', published_at: '2023-08-09' }] }));
  assert.deepEqual(v.sources.map(s => s.url), ['https://a.kr/x']);
  assert.equal(v.sources[0].date, '2023-08-09');
});

test('timeline keeps dated items in order, undated last, and shows the empty state', () => {
  const t = timelineView({ changes: [change({ id: 2, date: null }), change({ id: 3, date: '2022-08-08' }), change({ id: 4, date: '2024-05' })] });
  assert.deepEqual(t.items.map(i => i.id), [3, 4, 2]);
  assert.equal(t.items[2].dateText, '날짜 확인불가');
  assert.equal(timelineView({ changes: [], empty_message: '확인된 자료 없음' }).empty, '확인된 자료 없음');
});

test('disaster events are replayable only when the server gave a supported map effect', () => {
  assert.equal(changeView(change({ change_type: 'disaster_event', map_effect: { supported: true, type: 'flood', params: { rain: 60 } } })).replayable, true);
  assert.equal(changeView(change({ change_type: 'disaster_event', map_effect: { supported: false } })).replayable, false);
  assert.equal(changeView(change()).replayable, false);
});

test('metrics show with labels and units, empty values dropped', () => {
  const v = changeView(change({ metrics: { rain_mm: 420, duration_hours: null, design_rain_after_mm_h: 95 } }));
  assert.deepEqual(v.metrics, [{ label: '누적 강수량', value: '420 mm' }, { label: '설계 강우 (후)', value: '95 mm/h' }]);
});

test('comparison without a verified completed facility needs explicit consent', () => {
  const locked = scenarioView(scenario());
  assert.equal(locked.available, false);
  assert.equal(locked.needsConsent, true);
  assert.match(locked.reason, /확인된 자료 없음/);
  assert.equal(scenarioView(scenario(), true).available, true);
  const verified = scenarioView(scenario({ comparison_available: true, reason: null, data_quality: 'partial',
    param_evidence: { rain: 'article', hours: 'article', drain_before: 'assumed', drain_after: 'article' } }));
  assert.equal(verified.available, true);
  const drain = verified.rows.find(r => r.key === 'drain');
  assert.equal(drain.evidenceBefore[0], '가정값');
  assert.equal(drain.evidenceAfter[0], '기사');
  assert.equal(verified.rows.find(r => r.key === 'rain').changed, false);
});

test('facility level raises assumed drain capacity by what is counted, article values win', async () => {
  const { facilityScenario } = await import('../korea/disasters/region-model.js');
  const r = { scenario: scenario({ comparison_available: true, reason: null }), changes: [
    change({ id: 1, change_type: 'drainage_pump', status: 'completed' }),
    change({ id: 2, change_type: 'retention', status: 'under_construction' }),
    change({ id: 3, change_type: 'drainage_pipe', status: 'planned' }),
    change({ id: 4, change_type: 'levee_river', status: 'planned' }),                   // 배수 능력엔 안 넣음
    change({ id: 5, change_type: 'disaster_event', status: 'occurred' }),
  ] };
  const done = facilityScenario(r, 'completed');
  assert.equal(done.after.params.drain, 55);           // 40 + 펌프 15
  assert.equal(done.whatIf, false);
  assert.equal(facilityScenario(r, 'building').after.params.drain, 65);  // + 저류 10
  const planned = facilityScenario(r, 'planned');
  assert.equal(planned.after.params.drain, 70);        // + 관로 5, 제방 0
  assert.equal(planned.whatIf, true);
  assert.equal(planned.comparison_available, true);
  assert.equal(planned.param_evidence.drain_after, 'assumed');
  assert.deepEqual(planned.facilities.map(f => f.id), [1, 2, 3, 4]);
  assert.equal(planned.after.params.rain, planned.before.params.rain); // 비 · 시간은 그대로
  // 기사에 설계 강우량이 있으면 그 값 (가정 증가분 대신)
  r.changes.push(change({ id: 6, change_type: 'drainage_pump', status: 'planned', metrics: { design_rain_after_mm_h: 95 } }));
  const art = facilityScenario(r, 'planned');
  assert.equal(art.after.params.drain, 95);
  assert.equal(art.param_evidence.drain_after, 'article');
  // 반영할 시설이 없으면 비교 잠금
  const none = facilityScenario({ scenario: scenario(), changes: [change({ status: 'planned' })] }, 'completed');
  assert.equal(none.comparison_available, false);
  assert.match(none.reason, /확인된 자료 없음/);
  assert.equal(none.after.params.drain, 40);
});

test('before/after differ only in drain capacity', () => {
  const s = scenario();
  assert.equal(onlyDrainDiffers(s.before, s.after), true);
  assert.equal(onlyDrainDiffers(s.before, { type: 'flood', params: { rain: 90, hours: 12, drain: 60 } }), false);
});

test('region name from VWorld address structure, and Korea bounds', () => {
  assert.equal(regionNameFromAddress({ level1: '서울특별시', level2: '강남구', level4L: '대치동', level4A: '대치1동' }), '서울특별시 강남구 대치동');
  assert.equal(regionNameFromAddress({ level1: '강원특별자치도', level2: '강릉시', level4L: '', level4A: '교1동' }), '강원특별자치도 강릉시 교1동');
  assert.equal(regionNameFromAddress(null), '');
  assert.equal(inKoreaPoint({ latitude: 37.5, longitude: 127 }), true);
  assert.equal(inKoreaPoint({ latitude: 44.8, longitude: -0.57 }), false);
});
