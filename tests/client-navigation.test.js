import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, distance, projectPosition, zoneFor } from '../src/navigation.js';

test('velocity-matched playback freezes at zero, advances in meters, and clamps arrival', () => {
  assert.equal(advance(30, 0, 10, 1000), 30);
  assert.equal(advance(30, 36, 2, 1000), 50);
  assert.equal(advance(990, 72, 2, 1000), 1000);
  assert.equal(advance(30, -10, 2, 1000), 30);
});

test('prefetch is triggered 500m ahead and active boundaries are half-open', () => {
  const zone = { id: 'junction', startMeters: 1000, endMeters: 1200 };
  const route = { geofences: [zone] };
  assert.equal(zoneFor(route, 499).upcoming, undefined);
  assert.equal(zoneFor(route, 500).upcoming, zone);
  assert.equal(zoneFor(route, 1000).active, zone);
  assert.equal(zoneFor(route, 1200).active, undefined);
});

test('GPS projects to route progress and detects off-route positions', () => {
  const points = [[-122.42, 37.78], [-122.41, 37.78], [-122.40, 37.78]];
  const halfway = projectPosition(points, [-122.41, 37.78], 2000);
  assert.ok(Math.abs(halfway.meters - 1000) < 1);
  assert.ok(halfway.offset < 1);
  assert.ok(projectPosition(points, [-122.41, 37.79], 2000).offset > 1000);
  assert.equal(projectPosition([], points[0], 2000), null);
  assert.equal(distance(points[0], points[0]), 0);
});
