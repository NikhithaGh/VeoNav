import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createHttpServer } from '../server/index.js';
import {
  advanceProgress, createRoute, geofenceState, listRoutes, routeById,
  sceneById, validateRouteRequest, validateTelemetry,
} from '../server/navigation.js';

const route = createRoute({ destinationId: 'ferry', mode: 'drive' });
const telemetry = { type: 'telemetry', routeId: route.id, progressMeters: 0, speedKmh: 36 };

test('all curated destinations support drive and walk with explicit demo metadata', () => {
  assert.equal(listRoutes().length, 3);
  for (const destinationId of ['ferry', 'pier', 'palace']) {
    for (const mode of ['drive', 'walk']) {
      const result = createRoute({ destinationId, mode });
      assert.equal(result.id, `${destinationId}-${mode}`);
      assert.equal(result.demo, true);
      assert.equal(result.scene.type, 'procedural');
      assert.ok(result.distanceMeters > 0);
      assert.ok(result.durationMinutes > 0);
      assert.ok(result.coordinates.length >= 2);
      assert.ok(result.coordinates.every(([lon, lat]) => lon < -122 && lat > 37));
      assert.equal(result.steps.at(-1).atMeters, result.distanceMeters);
      assert.deepEqual(routeById(result.id), result);
    }
  }
  assert.ok(createRoute({ destinationId: 'ferry', mode: 'walk' }).durationMinutes > route.durationMinutes);
});

test('each route has three non-overlapping geofences with resolvable scenes and immediate prefetch', () => {
  const distances = { ferry: 3100, pier: 5700, palace: 6400 };
  for (const destinationId of Object.keys(distances)) {
    for (const mode of ['drive', 'walk']) {
      const result = createRoute({ destinationId, mode });
      assert.equal(result.distanceMeters, distances[destinationId]);
      assert.equal(result.geofences.length, 3);
      assert.equal(new Set(result.geofences.map((fence) => fence.id)).size, 3);
      assert.equal(result.geofences[0].startMeters, 350);
      assert.equal(result.geofences[1].kind, 'junction');
      assert.equal(result.geofences.at(-1).startMeters, result.distanceMeters - 900);
      assert.equal(result.geofences.at(-1).endMeters, result.distanceMeters - 100);
      const initial = geofenceState(result, 0);
      assert.equal(initial.state, 'upcoming');
      assert.equal(initial.prefetch, true);
      assert.equal(initial.distanceToGeofenceMeters, 350);
      for (const [index, fence] of result.geofences.entries()) {
        assert.ok(fence.startMeters < fence.endMeters);
        assert.ok(fence.endMeters <= result.distanceMeters);
        if (index > 0) assert.ok(fence.startMeters > result.geofences[index - 1].endMeters);
        assert.equal(sceneById(fence.sceneId).id, fence.sceneId);
        const active = geofenceState(result, fence.startMeters);
        assert.equal(active.state, 'active');
        assert.equal(active.geofence.id, fence.id);
        assert.equal(geofenceState(result, fence.endMeters - 0.01).state, 'active');
        assert.equal(geofenceState(result, fence.endMeters).state, 'clear');
        if (fence.startMeters >= 500) {
          assert.equal(geofenceState(result, fence.startMeters - 501).state, 'clear');
          const upcoming = geofenceState(result, fence.startMeters - 500);
          assert.equal(upcoming.state, 'upcoming');
          assert.equal(upcoming.geofence.id, fence.id);
        }
      }
    }
  }
});

test('route validation rejects malformed payloads and unsupported destinations or modes', () => {
  for (const value of [null, [], 'ferry', {}, { destinationId: 'airport', mode: 'drive' }, { destinationId: 'ferry' }, { destinationId: 'ferry', mode: 'fly' }]) {
    assert.throws(() => validateRouteRequest(value), TypeError);
  }
  assert.equal(routeById('ferry-drive-extra'), null);
  assert.equal(routeById(null), null);
  const fresh = createRoute({ destinationId: 'ferry', mode: 'drive' });
  fresh.coordinates[0][0] = 0;
  assert.notEqual(createRoute({ destinationId: 'ferry', mode: 'drive' }).coordinates[0][0], 0);
});

test('zero speed freezes progress; units are seconds and km/h', () => {
  assert.equal(advanceProgress(120, 0, 60, 1000), 120);
  assert.equal(advanceProgress(120, 36, 10, 1000), 220);
  assert.equal(advanceProgress(120, 36, 0, 1000), 120);
});

test('progress caps at route length and rejects invalid numeric values', () => {
  assert.equal(advanceProgress(990, 36, 10, 1000), 1000);
  assert.equal(advanceProgress(1500, 0, 0, 1000), 1000);
  assert.equal(advanceProgress(0, 0, 0, 0), 0);
  for (const value of [-1, NaN, Infinity, '10', null]) {
    assert.throws(() => advanceProgress(value, 10, 1, 1000), TypeError);
    assert.throws(() => advanceProgress(0, value, 1, 1000), TypeError);
    assert.throws(() => advanceProgress(0, 10, value, 1000), TypeError);
    assert.throws(() => advanceProgress(0, 10, 1, value), TypeError);
  }
});

test('geofence prefetch begins exactly 500m before entry; start inclusive and end exclusive', () => {
  const { startMeters, endMeters } = route.geofences.at(-1);
  assert.equal(geofenceState(route, startMeters - 501).state, 'clear');
  const upcoming = geofenceState(route, startMeters - 500);
  assert.equal(upcoming.state, 'upcoming');
  assert.equal(upcoming.prefetch, true);
  assert.equal(upcoming.sceneId, 'ferry');
  assert.equal(upcoming.distanceToGeofenceMeters, 500);
  assert.equal(geofenceState(route, startMeters - 0.01).state, 'upcoming');
  assert.equal(geofenceState(route, startMeters).state, 'active');
  assert.equal(geofenceState(route, endMeters - 0.01).state, 'active');
  assert.equal(geofenceState(route, endMeters + 0.01).state, 'clear');
  const cleared = geofenceState(route, endMeters);
  assert.equal(cleared.state, 'clear');
  assert.equal(cleared.prefetch, false);
  assert.equal(cleared.geofence, null);
  assert.equal(cleared.sceneId, null);
  assert.equal(geofenceState(route, 1e9).progressMeters, route.distanceMeters);
  assert.throws(() => geofenceState(route, -1), TypeError);
});

test('telemetry is validated and capped, never coerced from strings', () => {
  assert.equal(validateTelemetry({ ...telemetry, progressMeters: 1e9 }).progressMeters, route.distanceMeters);
  assert.equal(validateTelemetry({ ...telemetry, speedKmh: 0 }).speedKmh, 0);
  for (const patch of [{ type: 'other' }, { routeId: 'invalid' }, { progressMeters: -1 }, { progressMeters: '12' }, { speedKmh: Infinity }, { speedKmh: 201 }, { speedKmh: -1 }]) {
    assert.throws(() => validateTelemetry({ ...telemetry, ...patch }), TypeError);
  }
});

test('scene packs contain synthetic anchors and camera metadata without image URLs', () => {
  for (const id of listRoutes().flatMap((item) => item.geofences.map((fence) => fence.sceneId))) {
    const scene = sceneById(id);
    assert.equal(scene.type, 'procedural');
    assert.equal(scene.demo, true);
    assert.ok(scene.anchors.length > 0);
    assert.ok(scene.frames.every((frame) => frame.source === 'procedural' && frame.camera));
    assert.doesNotMatch(JSON.stringify(scene), /https?:|imageUrl|image_url/);
  }
  assert.equal(sceneById('invalid'), null);
});

test('HTTP endpoints and WebSocket telemetry work together', { timeout: 15_000 }, async (t) => {
  const { server, shutdown } = createHttpServer();
  t.after(shutdown);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(`${base}/api/health`)).json()).status, 'ok');
  assert.equal((await (await fetch(`${base}/api/routes`)).json()).routes.length, 3);
  for (const destinationId of ['ferry', 'pier', 'palace']) {
    for (const mode of ['drive', 'walk']) {
      const response = await fetch(`${base}/api/route`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinationId, mode }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), createRoute({ destinationId, mode }));
    }
  }
  for (const body of [{ destinationId: 'unknown', mode: 'drive' }, { destinationId: 'ferry', mode: 'fly' }, {}]) {
    const response = await fetch(`${base}/api/route`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  const bad = await fetch(`${base}/api/route`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(bad.status, 400);
  await bad.arrayBuffer();
  const oversized = await fetch(`${base}/api/route`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'x'.repeat(9000) }),
  });
  assert.equal(oversized.status, 413);
  await oversized.arrayBuffer();
  const missing = await fetch(`${base}/api/scenes/unknown`);
  assert.equal(missing.status, 404);
  await missing.arrayBuffer();
  for (const id of listRoutes().flatMap((item) => item.geofences.map((fence) => fence.sceneId))) {
    const response = await fetch(`${base}/api/scenes/${id}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), sceneById(id));
  }

  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  t.after(() => ws.terminate());
  await once(ws, 'open');
  const message = once(ws, 'message');
  ws.send(JSON.stringify({ ...telemetry, progressMeters: 0 }));
  const [data] = await message;
  const event = JSON.parse(data.toString());
  assert.equal(event.type, 'geofence');
  assert.equal(event.state, 'upcoming');
  assert.equal(event.prefetch, true);
  const exitMessage = once(ws, 'message');
  ws.send(JSON.stringify({ ...telemetry, progressMeters: route.geofences[0].endMeters }));
  const exitEvent = JSON.parse((await exitMessage)[0].toString());
  assert.equal(exitEvent.state, 'clear');
  assert.equal(exitEvent.prefetch, false);
  const closed = once(ws, 'close');
  for (const payload of ['{', JSON.stringify({ ...telemetry, routeId: 'unknown' }), JSON.stringify({ ...telemetry, speedKmh: -1 })]) {
    const invalid = once(ws, 'message');
    ws.send(payload);
    const error = JSON.parse((await invalid)[0].toString());
    assert.equal(error.type, 'error');
    assert.equal(typeof error.error, 'string');
  }
  assert.equal((await closed)[0], 1008);
});
