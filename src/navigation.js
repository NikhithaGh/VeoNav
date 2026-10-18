export const destinations = [
  { id: 'ferry', name: 'Ferry Building', address: '1 Ferry Building, Embarcadero', category: 'Waterfront · San Francisco', minutes: 8 },
  { id: 'pier', name: 'Pier 39', address: 'The Embarcadero, Fisherman’s Wharf', category: 'Landmark · San Francisco', minutes: 14 },
  { id: 'palace', name: 'Palace of Fine Arts', address: '3601 Lyon Street, Marina District', category: 'Architecture · San Francisco', minutes: 22 }
];

export function advance(progress, speedKmh, elapsedSeconds, total) {
  return Math.min(total, Math.max(0, progress + Math.max(0, speedKmh) / 3.6 * Math.max(0, elapsedSeconds)));
}

export function zoneFor(route, progress) {
  const active = route?.geofences.find(zone => progress >= zone.startMeters && progress < zone.endMeters);
  const upcoming = route?.geofences.find(zone => zone.startMeters > progress && zone.startMeters - progress <= 500);
  return { active, upcoming };
}

export function distance(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function projectPosition(coordinates, position, total) {
  if (!coordinates?.length || coordinates.length < 2) return null;
  const scale = Math.cos(position[1] * Math.PI / 180);
  const lengths = coordinates.slice(1).map((p, i) => distance(coordinates[i], p));
  const length = lengths.reduce((a, b) => a + b, 0);
  let traversed = 0;
  let best = { offset: Infinity, meters: 0 };
  coordinates.slice(1).forEach((b, i) => {
    const a = coordinates[i];
    const dx = (b[0] - a[0]) * scale, dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, (((position[0] - a[0]) * scale * dx) + (position[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const projected = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const offset = distance(position, projected);
    if (offset < best.offset) best = { offset, meters: (traversed + lengths[i] * t) / length * total };
    traversed += lengths[i];
  });
  return best;
}
