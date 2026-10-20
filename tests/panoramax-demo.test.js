import test from 'node:test';
import assert from 'node:assert/strict';
import { options, distance, bearing, usable, continuous, escapeXml } from '../scripts/panoramax-demo.mjs';

const item = (overrides = {}) => ({
  id: 'one', collection: 'sequence', geometry: { coordinates: [2.34, 48.86] },
  assets: { sd: { href: 'https://example.org/image.jpg' } },
  properties: { license: 'CC-BY-SA-4.0', datetime: '2026-01-01T00:00:00Z',
    'view:azimuth': 0, 'geovisio:producer': 'Photographer', 'geovisio:rank_in_collection': 1,
    'pers:interior_orientation': { field_of_view: 360 } }, ...overrides,
});
test('CLI defaults and bounds keep runs bounded', () => {
  assert.equal(options([]).count, 5);
  assert.equal(options(['--region', 'Pune']).region, 'Pune');
  assert.throws(() => options(['--region', 'Paris']));
  assert.equal(options(['--india-only', '--frames', '8']).indiaOnly, true);
  for (const args of [['--count', '6'], ['--frames', '0'], ['--output'], ['--bad'], ['--count', 'NaN']]) assert.throws(() => options(args));
});
test('distance and heading use longitude latitude order', () => {
  assert.equal(distance([0, 0], [0, 0]), 0);
  assert.ok(Math.abs(distance([0, 0], [0, 0.001]) - 111.2) < 1);
  assert.equal(bearing([0, 0], [1, 0]), 90);
  assert.equal(bearing([0, 0], [0, 1]), 0);
});
test('unknown licenses, missing credits and non-spherical imagery are rejected', () => {
  assert.ok(usable(item()));
  for (const patch of [{ license: 'proprietary' }, { 'geovisio:producer': '' }, { 'view:azimuth': null }, { 'pers:interior_orientation': { field_of_view: 90 } }]) {
    const f = item(); Object.assign(f.properties, patch); assert.equal(usable(f), false);
  }
});
test('only adjacent, nearby, time-continuous pictures in the same sequence are accepted', () => {
  const a = item(), b = item({ id: 'two', geometry: { coordinates: [2.3401, 48.86] } });
  b.properties['geovisio:rank_in_collection'] = 2;
  b.properties.datetime = '2026-01-01T00:00:02Z';
  assert.ok(continuous(a, b));
  assert.equal(continuous(a, { ...b, collection: 'other' }), false);
  assert.equal(continuous(a, { ...b, geometry: { coordinates: [3, 49] } }), false);
  assert.equal(continuous(a, a), false);
  b.properties.datetime = '2026-01-01T01:00:00Z';
  assert.equal(continuous(a, b), false);
  b.properties.datetime = '2026-01-01T00:00:02Z';
  b.properties['geovisio:rank_in_collection'] = 4;
  assert.equal(continuous(a, b), false);
});
test('provider text is escaped for attribution SVG and gallery HTML', () => {
  assert.equal(escapeXml('<x a="b">&\''), '&lt;x a=&quot;b&quot;&gt;&amp;&apos;');
});
