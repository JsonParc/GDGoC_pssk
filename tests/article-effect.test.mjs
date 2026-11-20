import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { articleEffect, validPosition } from '../korea/disasters/article-effect.js';

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../js/disaster.js', import.meta.url), 'utf8'), context);
const { TYPES } = context.window.DisasterFX;
const card = (type, front, viz_params = {}, params = {}, sources = {}) => ({ type, viz_params,
  map_effect: { supported: true, type: front, params, sources } });

test('total snow without duration renders accumulation without invented snowfall', () => {
  const result = articleEffect(card('heavysnow', 'snow', { snowfall_cm: 14.5 }), TYPES);
  assert.equal(result.ready, true);
  assert.equal(result.params.snowDepthCm, 14.5);
  assert.equal(result.params.rate, 0);
  assert.equal(result.params.hours, undefined);
  assert.equal(result.sources.snowDepthCm, 'article');
  assert.match(TYPES.snow.derive(result.params)[0][1], /14.5/);
});
test('coldwave cannot borrow snowfall from another region in the same article', () => {
  const result = articleEffect(card('coldwave', 'snow', { snowfall_cm: 10 }, { temp: -6, rate: 3, wind: 12 },
    { temp: 'article', rate: 'derived', wind: 'kma_current' }), TYPES);
  assert.equal(result.params.rate, 0);
  assert.equal(result.params.snowDepthCm, 0);
  assert.equal(result.params.wind, undefined);
  assert.equal(result.params.temp, -6);
});
test('measured flood depth overrides rainfall-derived water height', () => {
  const result = articleEffect(card('flood', 'flood', { flood_depth_m: 1.25 }), TYPES);
  assert.equal(result.ready, true);
  assert.equal(TYPES.flood.env({ rain: 100, drain: 0, hours: 12, ...result.params }).water, 1.25);
});
test('missing, invalid, and unsupported measurements do not enable reproduction', () => {
  assert.equal(articleEffect(card('heavysnow', 'snow'), TYPES).ready, false);
  assert.equal(articleEffect(card('heavysnow', 'snow', { snowfall_cm: '10' }), TYPES).ready, false);
  assert.equal(articleEffect(card('coldwave', 'snow', {}, { temp: -6 }, { temp: 'kma_current' }), TYPES).ready, false);
  assert.equal(articleEffect({ map_effect: { supported: false } }), null);
});
test('out-of-range values are not silently clamped to a different magnitude', () => {
  const result = articleEffect(card('earthquake', 'quake', {}, { M: 12 }, { M: 'article' }), TYPES);
  assert.equal(result.ready, false);
  assert.equal(result.params.M, 12);
  assert.ok(result.reason);
});
test('location must have two finite coordinates in geographic bounds', () => {
  assert.equal(validPosition({ longitude: 126.5, latitude: 33.3 }), true);
  for (const position of [{ longitude: null, latitude: 33 }, { longitude: 126, latitude: 100 }, { longitude: NaN, latitude: 30 }]) {
    assert.equal(validPosition(position), false);
  }
});
