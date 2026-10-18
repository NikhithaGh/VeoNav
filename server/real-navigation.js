import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

export class PublicError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function coordinate(value) {
  if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== 'number' || !Number.isFinite(v)) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw new PublicError('Expected [longitude, latitude].');
  return value;
}
export function routeRequest(body) {
  if (!body || !['drive', 'walk'].includes(body.mode)) throw new PublicError('Choose driving or walking.');
  return { origin: coordinate(body.origin), destination: coordinate(body.destination), mode: body.mode };
}
export function decodePolyline(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 200000) throw new PublicError('Invalid route geometry.', 502);
  let index = 0, latitude = 0, longitude = 0;
  const result = [];
  const next = () => {
    let shift = 0, value = 0, byte;
    do {
      if (index >= encoded.length || shift > 30) throw new PublicError('Malformed route geometry.', 502);
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new PublicError('Malformed route geometry.', 502);
      value |= (byte & 31) << shift; shift += 5;
    } while (byte >= 32);
    return value & 1 ? ~(value >> 1) : value >> 1;
  };
  while (index < encoded.length) { latitude += next(); longitude += next(); result.push([longitude / 1e5, latitude / 1e5]); }
  if (result.length < 2) throw new PublicError('No usable route geometry.', 502);
  return result;
}
export function normalizeRoute(data, request, secret, now = Date.now()) {
  const raw = data.routes?.[0];
  if (!raw || !Number.isFinite(raw.distanceMeters) || raw.distanceMeters <= 0) throw new PublicError('No route was found between those places.', 404);
  if (raw.distanceMeters > 100000) throw new PublicError('Prototype routes are limited to 100 km. Choose closer places.');
  const coordinates = decodePolyline(raw.polyline?.encodedPolyline);
  const id = randomUUID();
  let traveled = 0;
  const steps = [];
  for (const leg of raw.legs || []) for (const step of leg.steps || []) {
    steps.push({ atMeters: traveled, instruction: step.navigationInstruction?.instructions || 'Continue along the route.', maneuver: step.navigationInstruction?.maneuver || 'STRAIGHT', coordinates: [step.startLocation?.latLng?.longitude ?? coordinates[0][0], step.startLocation?.latLng?.latitude ?? coordinates[0][1]] });
    traveled += step.distanceMeters || 0;
  }
  const candidates = steps.filter(step => step.atMeters > 80 && !['STRAIGHT', 'DEPART', 'MANEUVER_UNSPECIFIED'].includes(step.maneuver));
  const chosen = [];
  for (const step of candidates) {
    if (chosen.length >= 5) break;
    if (chosen.length && step.atMeters - chosen.at(-1).atMeters < 250) continue;
    chosen.push(step);
  }
  if (!chosen.length) chosen.push({ atMeters: Math.max(0, raw.distanceMeters - 150), instruction: 'Approach your destination.', maneuver: 'DESTINATION', coordinates: coordinates.at(-1) });
  const geofences = chosen.map((step, i) => ({ id: `${id}-${i}`, name: `Maneuver ${i + 1}`, startMeters: Math.max(0, step.atMeters - 100), endMeters: Math.min(raw.distanceMeters, step.atMeters + 100), instruction: step.instruction, maneuver: step.maneuver, coordinates: step.coordinates, kind: 'junction', sceneId: `${id}-${i}` }));
  const capability = { id, distanceMeters: raw.distanceMeters, expires: now + 3600000, geofences: geofences.map(({ id: sceneId, startMeters, endMeters, coordinates }) => ({ id: sceneId, startMeters, endMeters, coordinates })) };
  return { id, demo: false, provider: 'Google Maps', mode: request.mode, distanceMeters: raw.distanceMeters, durationMinutes: Math.ceil(parseFloat(raw.duration || '0') / 60), coordinates, steps, geofences, warnings: raw.warnings || [], ticket: signTicket(capability, secret), expiresAt: new Date(capability.expires).toISOString(), disclaimer: 'Google Maps route with heuristic preview zones. AI preview is not verified lane guidance.' };
}
export function signTicket(payload, secret) {
  if (!secret || secret.length < 32) throw new PublicError('Route signing is not configured.', 503);
  const text = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${text}.${createHmac('sha256', secret).update(text).digest('base64url')}`;
}
export function verifyTicket(ticket, secret, now = Date.now()) {
  if (typeof ticket !== 'string' || ticket.length > 10000 || !secret) throw new PublicError('Missing route session.', 401);
  const [text, signature, extra] = ticket.split('.');
  if (!text || !signature || extra) throw new PublicError('Invalid route session.', 401);
  const expected = createHmac('sha256', secret).update(text).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new PublicError('Invalid route session.', 401);
  let payload;
  try { payload = JSON.parse(Buffer.from(text, 'base64url').toString()); } catch { throw new PublicError('Invalid route session.', 401); }
  if (!Number.isFinite(payload.expires) || payload.expires < now) throw new PublicError('Route session expired. Plan the route again.', 401);
  return payload;
}
export function liveTelemetry(value, secret) {
  const route = verifyTicket(value.ticket, secret);
  if (!Number.isFinite(value.progressMeters) || value.progressMeters < 0 || !Number.isFinite(value.speedKmh) || value.speedKmh < 0 || value.speedKmh > 200) throw new PublicError('Invalid route telemetry.');
  const progress = Math.min(value.progressMeters, route.distanceMeters);
  const active = route.geofences.find(zone => progress >= zone.startMeters && progress < zone.endMeters);
  const upcoming = route.geofences.find(zone => zone.startMeters > progress && zone.startMeters - progress <= 500);
  return { type: 'geofence', routeId: route.id, state: active ? 'active' : upcoming ? 'upcoming' : 'clear', sceneId: (active || upcoming)?.id || null, prefetch: !!(active || upcoming), progressMeters: progress, speedKmh: value.speedKmh };
}
