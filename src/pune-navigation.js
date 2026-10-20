export function forwardTime(route, progress) {
  const target = clampProgress(progress + route.lookAheadMeters, route.distanceMeters);
  const end = route.points.findIndex(point => point.meters >= target);
  if (end <= 0) return end === 0 ? 0 : route.forward.lastFrameSeconds;
  const a = route.points[end - 1], b = route.points[end];
  return (end - 1 + (target - a.meters) / (b.meters - a.meters)) * route.forward.secondsPerFrame;
}
export function clampProgress(value, total) {
  return Math.min(total, Math.max(0, Number.isFinite(value) ? value : 0));
}
export function advanceProgress(progress, elapsedSeconds, speed, total) {
  return clampProgress(progress + Math.max(0, elapsedSeconds) * speed, total);
}
export function selectPreview(route, progress) {
  const target = clampProgress(progress + route.lookAheadMeters, route.distanceMeters);
  return route.clips.reduce((selected, clip) => clip.startMeters <= target ? clip : selected, route.clips[0]);
}
export function positionAt(points, progress) {
  const end = points.findIndex(point => point.meters >= progress);
  if (end <= 0) return (end === 0 ? points[0] : points.at(-1)).coordinates;
  const a = points[end - 1], b = points[end];
  const ratio = (progress - a.meters) / (b.meters - a.meters || 1);
  return a.coordinates.map((value, i) => value + (b.coordinates[i] - value) * ratio);
}
export function validatePuneRoute(route) {
  if (!route || !Number.isFinite(route.distanceMeters) || route.distanceMeters <= 0
    || !Number.isFinite(route.lookAheadMeters) || route.lookAheadMeters < 0
    || !Number.isFinite(route.speedMetersPerSecond) || route.speedMetersPerSecond <= 0
    || !Array.isArray(route.points) || route.points.length < 2
    || !Array.isArray(route.clips) || !route.clips.length) throw new Error('Pune route data is invalid');
  let previous = -1;
  for (const point of route.points) {
    if (!Number.isFinite(point.meters) || point.meters < 0 || point.meters <= previous
      || !Array.isArray(point.coordinates) || point.coordinates.length !== 2 || !point.coordinates.every(Number.isFinite)) throw new Error('Invalid track coordinates');
    previous = point.meters;
  }
  if (route.points[0].meters !== 0 || Math.abs(previous - route.distanceMeters) > 1) throw new Error('Invalid track extent');
  previous = -1;
  for (const clip of route.clips) {
    if (!Number.isFinite(clip.startMeters) || clip.startMeters <= previous || clip.startMeters < 0
      || !Number.isFinite(clip.endMeters) || clip.endMeters <= clip.startMeters || clip.endMeters > route.distanceMeters
      || !/^\/v2-pune\/[a-z0-9-]+\.mp4$/.test(clip.src)
      || !/^\/v2-pune\/[a-z0-9-]+\.png$/.test(clip.poster)) throw new Error('Invalid preview clip');
    previous = clip.startMeters;
  }
  if (route.clips[0].startMeters !== 0) throw new Error('Missing initial preview');
  if (!route.forward || route.forward.src !== '/v2-pune/forward.mp4'
    || !Number.isFinite(route.forward.secondsPerFrame) || route.forward.secondsPerFrame <= 0
    || route.forward.lastFrameSeconds !== (route.points.length - 1) * route.forward.secondsPerFrame) throw new Error('Invalid forward preview');
  return route;
}
