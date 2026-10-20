import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { advanceProgress, clampProgress, positionAt, selectPreview, forwardTime, validatePuneRoute } from '../src/pune-navigation.js';
const route = JSON.parse(await readFile(new URL('../public/v2-pune/route.json', import.meta.url), 'utf8'));

test('packaged Pune data and all media assets are complete', async () => {
  assert.equal(validatePuneRoute(route), route);
  assert.equal(route.clips.length, 8);
  assert.equal(route.cameraOffsetDegrees, 90);
  assert.equal(route.speedMetersPerSecond, 4);
  assert.ok(route.clips.every(clip => clip.durationSeconds >= 8 && clip.src.includes('smooth-')));
  assert.equal(route.points.length, 40);
  for (const clip of route.clips) {
    await access(new URL(`../public${clip.src}`, import.meta.url));
    await access(new URL(`../public${clip.poster}`, import.meta.url));
  }
  const credits = JSON.parse(await readFile(new URL('../public/v2-pune/credits.json', import.meta.url), 'utf8'));
  assert.equal(credits.length, route.points.length);
  assert.ok(credits.every(c => c.creator && c.source && c.license === 'CC-BY-SA-4.0'));
});
test('forward preview never reverses during normal travel and holds the final view', async () => {
  await access(new URL(`../public${route.forward.src}`, import.meta.url));
  let last = 0;
  for (let progress = 0; progress <= route.distanceMeters; progress += 0.5) {
    const time = forwardTime(route, progress);
    assert.ok(time >= last);
    assert.ok(time <= route.forward.lastFrameSeconds);
    last = time;
  }
  assert.equal(forwardTime(route, route.distanceMeters), route.forward.lastFrameSeconds);
  assert.ok(forwardTime(route, 0) < forwardTime(route, 100));
});
test('simulation clamps progress and stops at track end', () => {
  assert.equal(advanceProgress(10, 2, 8, 100), 26);
  assert.equal(advanceProgress(99, 2, 8, 100), 100);
  assert.equal(advanceProgress(20, -1, 8, 100), 20);
  assert.equal(clampProgress(-20, 100), 0);
  assert.equal(clampProgress(NaN, 100), 0);
});
test('look-ahead changes on boundaries and scrubbing backwards restores clips', () => {
  const clip = route.clips[2], boundary = clip.startMeters - route.lookAheadMeters;
  assert.equal(selectPreview(route, boundary).id, clip.id);
  assert.equal(selectPreview(route, boundary - 0.01).id, route.clips[1].id);
  assert.equal(selectPreview(route, route.distanceMeters).id, route.clips.at(-1).id);
  assert.equal(selectPreview(route, 0).id, route.clips[0].id);
});
test('position interpolation preserves track endpoints', () => {
  const points = [{ meters: 0, coordinates: [0, 0] }, { meters: 10, coordinates: [2, 4] }];
  assert.deepEqual(positionAt(points, 5), [1, 2]);
  assert.deepEqual(positionAt(points, 0), [0, 0]);
  assert.deepEqual(positionAt(points, 11), [2, 4]);
});
test('malformed route data is rejected before playback', () => {
  assert.throws(() => validatePuneRoute({ ...route, points: [] }));
  assert.throws(() => validatePuneRoute({ ...route, speedMetersPerSecond: 0 }));
  const copy = structuredClone(route); copy.clips[0].src = 'https://example.org/video.mp4';
  assert.throws(() => validatePuneRoute(copy));
});
