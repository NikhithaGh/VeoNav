const origin = [-122.4194, 37.7765];

const destinations = [
  {
    id: 'ferry', name: 'Ferry Building', distanceMeters: 3100,
    coordinates: [origin, [-122.4148, 37.7793], [-122.4075, 37.7855], [-122.4003, 37.7912], [-122.3942, 37.7955], [-122.3937, 37.7955]],
    road: 'Market Street', instruction: 'Continue toward the waterfront and Ferry Building.',
  },
  {
    id: 'pier', name: 'Pier 39', distanceMeters: 5700,
    coordinates: [origin, [-122.4075, 37.7855], [-122.3942, 37.7955], [-122.3981, 37.8012], [-122.4053, 37.8066], [-122.4103, 37.8087]],
    road: 'The Embarcadero', instruction: 'Follow the waterfront toward Pier 39.',
  },
  {
    id: 'palace', name: 'Palace of Fine Arts', distanceMeters: 6400,
    coordinates: [origin, [-122.424, 37.7715], [-122.4267, 37.7848], [-122.4295, 37.7997], [-122.4374, 37.8007], [-122.4488, 37.802], [-122.4489, 37.8029]],
    road: 'Lombard Street', instruction: 'Continue west toward the Palace of Fine Arts.',
  },
];

export function validateRouteRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Request must be an object.');
  }
  if (!destinations.some((destination) => destination.id === value.destinationId)) {
    throw new TypeError('destinationId must be ferry, pier, or palace.');
  }
  if (value.mode !== 'drive' && value.mode !== 'walk') {
    throw new TypeError('mode must be drive or walk.');
  }
  return { destinationId: value.destinationId, mode: value.mode };
}

export function createRoute(input) {
  const { destinationId, mode } = validateRouteRequest(input);
  const destination = destinations.find((item) => item.id === destinationId);
  const id = `${destinationId}-${mode}`;
  const startMeters = destination.distanceMeters - 900;
  const junctionMeters = Math.round(destination.distanceMeters / 2) - 200;
  const junctionInstruction = `Follow the demo junction guidance along ${destination.road}.`;
  return {
    id, destinationId, mode, name: destination.name,
    origin: { name: 'Market Street, San Francisco', coordinates: [...origin] },
    demo: true,
    disclaimer: 'Illustrative demo geometry and estimated distances, not a live routing service. Do not use for real-world navigation.',
    distanceMeters: destination.distanceMeters,
    durationMinutes: Math.ceil(destination.distanceMeters / (mode === 'walk' ? 75 : 350)),
    coordinates: destination.coordinates.map((point) => [...point]),
    geofences: [
      {
        id: `${destinationId}-departure`, name: 'Market Street departure',
        startMeters: 350, endMeters: 700,
        instruction: 'Continue from Market Street along the illustrative demo route.',
        kind: 'junction', sceneId: `${destinationId}-departure`,
      },
      {
        id: `${destinationId}-junction`, name: `${destination.road} demo junction`,
        startMeters: junctionMeters, endMeters: junctionMeters + 300,
        instruction: junctionInstruction, kind: 'junction', sceneId: `${destinationId}-junction`,
      },
      {
        id: `${destinationId}-approach`, name: `${destination.name} approach`,
        startMeters, endMeters: destination.distanceMeters - 100,
        instruction: destination.instruction, kind: 'landmark', sceneId: destinationId,
      },
    ],
    steps: [
      { atMeters: 0, instruction: 'Start at Market Street. Follow this illustrative demo route.', road: 'Market Street' },
      { atMeters: 350, instruction: 'Continue along the demo route from Market Street.', road: 'Market Street' },
      { atMeters: junctionMeters, instruction: junctionInstruction, road: destination.road },
      { atMeters: startMeters, instruction: `Approaching ${destination.name}.`, road: destination.road },
      { atMeters: destination.distanceMeters, instruction: `Demo arrival at ${destination.name}.`, road: destination.road },
    ],
    scene: { type: 'procedural', id: destinationId },
  };
}

export function listRoutes() {
  return destinations.map(({ id }) => createRoute({ destinationId: id, mode: 'drive' }));
}

export function routeById(id) {
  if (typeof id !== 'string' || !/^(ferry|pier|palace)-(drive|walk)$/.test(id)) return null;
  const [destinationId, mode] = id.split('-');
  return createRoute({ destinationId, mode });
}

function nonnegative(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite nonnegative number.`);
  }
}

export function advanceProgress(progressMeters, speedKmh, elapsedSeconds, distanceMeters) {
  nonnegative(progressMeters, 'progressMeters');
  nonnegative(speedKmh, 'speedKmh');
  nonnegative(elapsedSeconds, 'elapsedSeconds');
  nonnegative(distanceMeters, 'distanceMeters');
  return Math.min(distanceMeters, progressMeters + (speedKmh / 3.6) * elapsedSeconds);
}

export function geofenceState(route, progressMeters) {
  nonnegative(progressMeters, 'progressMeters');
  const progress = Math.min(route.distanceMeters, progressMeters);
  const active = route.geofences.find((fence) => progress >= fence.startMeters && progress < fence.endMeters);
  const upcoming = route.geofences.find((fence) => progress < fence.startMeters && fence.startMeters - progress <= 500);
  const geofence = active ?? upcoming ?? null;
  return {
    state: active ? 'active' : upcoming ? 'upcoming' : 'clear',
    geofence,
    sceneId: geofence?.sceneId ?? null,
    prefetch: Boolean(geofence),
    distanceToGeofenceMeters: geofence ? Math.max(0, geofence.startMeters - progress) : null,
    progressMeters: progress,
  };
}

export function validateTelemetry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'telemetry') {
    throw new TypeError('Expected a telemetry object.');
  }
  const route = routeById(value.routeId);
  if (!route) throw new TypeError('Unknown routeId.');
  nonnegative(value.progressMeters, 'progressMeters');
  nonnegative(value.speedKmh, 'speedKmh');
  if (value.speedKmh > 200) throw new TypeError('speedKmh must not exceed 200.');
  return {
    route,
    progressMeters: Math.min(value.progressMeters, route.distanceMeters),
    speedKmh: value.speedKmh,
  };
}

export function sceneById(id) {
  const destination = destinations.find((item) => [item.id, `${item.id}-departure`, `${item.id}-junction`].includes(id));
  if (!destination) return null;
  const name = id.endsWith('-departure') ? 'Market Street departure'
    : id.endsWith('-junction') ? `${destination.road} demo junction` : destination.name;
  return {
    id, type: 'procedural', demo: true,
    name,
    provenance: 'Synthetic scene metadata generated from curated demo geometry; not camera imagery, a photoreal reconstruction, or measured landmarks.',
    coordinateSystem: 'local-meters: x right, y up, z forward',
    anchors: [
      { id: `${id}-road`, kind: 'road', position: [0, 0, 0], size: [12, 0.1, 120] },
      { id: `${id}-landmark`, kind: 'landmark', label: name, position: [18, 8, 80], size: [20, 16, 20] },
      { id: `${id}-guidance`, kind: 'arrow', position: [0, 0.2, 30], headingDegrees: 0 },
    ],
    frames: [0, 1, 2].map((index) => ({
      id: `${id}-frame-${index}`, timestampMs: index * 1000,
      camera: { position: [0, 1.7, index * 10], lookAt: [0, 1.7, 80], fovDegrees: 65 },
      source: 'procedural',
    })),
  };
}
