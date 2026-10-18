import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { PublicError } from './real-navigation.js';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const verifier = new OAuth2Client();
const encode = encodeURIComponent;
export const cloudConfig = () => ({
  enabled: process.env.LIVE_INTEGRATIONS === 'true', project: process.env.GOOGLE_CLOUD_PROJECT || 'veonav',
  bucket: process.env.SCENE_BUCKET || 'veonav-aeronav-scenes', topic: process.env.SCENE_TOPIC || 'aeronav-scenes',
  dataset: process.env.SPATIAL_DATASET || 'aeronav_spatial', location: process.env.BQ_LOCATION || 'asia-south1',
  model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite', mapsKey: process.env.MAPS_SERVER_KEY?.trim(),
  browserKey: process.env.MAPS_BROWSER_KEY?.trim(), secret: process.env.ROUTE_SIGNING_SECRET?.trim(),
  audience: process.env.PUSH_AUDIENCE, pushAccount: process.env.PUSH_SERVICE_ACCOUNT,
  earthEnabled: process.env.EARTH_ENGINE_ENABLED === 'true',
});

export async function googleRequest(url, { body, method = body ? 'POST' : 'GET', headers = {}, timeout = 30000, authenticated = true } = {}) {
  if (authenticated) {
    const token = await auth.getAccessToken();
    headers = { ...headers, Authorization: `Bearer ${token}` };
  }
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(`${new URL(url).hostname} returned ${response.status}: ${data.error?.status || 'provider request failed'}`);
    error.status = response.status; error.provider = new URL(url).hostname;
    // Never log URLs with query credentials or full provider responses.
    console.error('Cloud provider request failed', { provider: error.provider, status: response.status, reason: data.error?.status });
    throw error;
  }
  return data;
}

export function createCloudServices(config = cloudConfig(), request = googleRequest) {
  const objectUrl = name => `https://storage.googleapis.com/storage/v1/b/${encode(config.bucket)}/o/${encode(name)}`;
  async function readObject(name) {
    try {
      const metadata = await request(objectUrl(name));
      const data = await request(`${objectUrl(name)}?alt=media&ifGenerationMatch=${metadata.generation}`);
      return { data, generation: metadata.generation };
    } catch (error) { if (error.status === 404) return null; throw error; }
  }
  async function writeObject(name, data, generation) {
    return request(`https://storage.googleapis.com/upload/storage/v1/b/${encode(config.bucket)}/o?uploadType=media&name=${encode(name)}${generation === undefined ? '' : `&ifGenerationMatch=${generation}`}`, { body: data, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const limits = { searches: 100, routes: 30, scenes: 60 };
  async function consume(kind) {
    if (!limits[kind]) throw new Error('Invalid quota kind');
    const name = `quota/${new Date().toISOString().slice(0, 10)}-${kind}.json`;
    for (let attempt = 0; attempt < 8; attempt++) {
      const old = await readObject(name);
      const count = old?.data.count || 0;
      if (count >= limits[kind]) throw new PublicError(`Today's prototype ${kind} limit (${limits[kind]}) has been reached. Try tomorrow or use the demo.`, 429);
      try { await writeObject(name, { count: count + 1, kind }, old?.generation || '0'); return; }
      catch (error) { if (error.status !== 412) throw error; }
    }
    throw new PublicError('Service is busy. Try again shortly.', 429);
  }
  async function search(query) {
    await consume('searches');
    const data = await request('https://places.googleapis.com/v1/places:searchText', { authenticated: false, headers: { 'X-Goog-Api-Key': config.mapsKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.attributions' }, body: { textQuery: query, pageSize: 5, languageCode: 'en' } });
    return (data.places || []).map(place => ({ id: place.id, name: place.displayName?.text || 'Place', address: place.formattedAddress || '', coordinates: [place.location.longitude, place.location.latitude], attributions: place.attributions || [] }));
  }
  async function computeRoute(input) {
    await consume('routes');
    const waypoint = point => ({ location: { latLng: { longitude: point[0], latitude: point[1] } } });
    const body = { origin: waypoint(input.origin), destination: waypoint(input.destination), travelMode: input.mode === 'walk' ? 'WALK' : 'DRIVE', computeAlternativeRoutes: false, languageCode: 'en-US', units: 'METRIC', polylineQuality: 'HIGH_QUALITY' };
    if (input.mode === 'drive') body.routingPreference = 'TRAFFIC_UNAWARE';
    return request('https://routes.googleapis.com/directions/v2:computeRoutes', { authenticated: false, headers: { 'X-Goog-Api-Key': config.mapsKey, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.startLocation,routes.legs.steps.navigationInstruction,routes.warnings' }, body });
  }
  async function query(sql, params = []) {
    const data = await request(`https://bigquery.googleapis.com/bigquery/v2/projects/${config.project}/queries`, { body: { query: sql, useLegacySql: false, location: config.location, maximumBytesBilled: '10485760', timeoutMs: 20000, parameterMode: 'NAMED', queryParameters: params } });
    if (!data.jobComplete) throw new Error('Spatial query did not finish within the request budget.');
    if (data.errors?.length) throw new Error('Spatial query failed.');
    return data;
  }
  async function spatialIndex(job) {
    if (!/^[a-zA-Z0-9_]+$/.test(config.dataset) || !/^[a-z][a-z0-9-]+$/.test(config.project)) throw new Error('Invalid spatial configuration.');
    const parameter = (name, type, value) => ({ name, parameterType: { type }, parameterValue: { value: String(value) } });
    const params = [parameter('scene', 'STRING', job.id), parameter('route', 'STRING', job.routeId), parameter('lng', 'FLOAT64', job.coordinates[0]), parameter('lat', 'FLOAT64', job.coordinates[1])];
    const table = `\`${config.project}.${config.dataset}.geofences\``;
    await query(`INSERT INTO ${table} (scene_id, route_id, location, expires_at, created_at) VALUES (@scene, @route, ST_GEOGPOINT(@lng, @lat), TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 1 DAY), CURRENT_TIMESTAMP())`, params);
    const found = await query(`SELECT COUNT(*) AS nearby FROM ${table} WHERE route_id = @route AND expires_at > CURRENT_TIMESTAMP() AND ST_DWITHIN(location, ST_GEOGPOINT(@lng, @lat), 500)`, params.filter(p => p.name !== 'scene'));
    return { status: 'ready', provider: 'BigQuery GIS', nearby: Number(found.rows?.[0]?.f?.[0]?.v || 0), radiusMeters: 500 };
  }
  async function elevation(point) {
    if (!config.earthEnabled) return { status: 'disabled', provider: 'Earth Engine' };
    const constant = constantValue => ({ constantValue });
    const invoke = (functionName, args) => ({ functionInvocationValue: { functionName, arguments: args } });
    const expression = invoke('Image.reduceRegion', {
      image: invoke('Image.select', { input: invoke('Image.load', { id: constant('NASA/NASADEM_HGT/001') }), bandSelectors: constant(['elevation']) }),
      reducer: invoke('Reducer.first', {}),
      geometry: invoke('GeometryConstructors.Point', { coordinates: constant(point) }), scale: constant(30), maxPixels: constant(1000),
    });
    const result = await request(`https://earthengine.googleapis.com/v1/projects/${config.project}/value:compute`, { body: { expression: { result: '0', values: { '0': expression } }, workloadTag: 'aeronav-elevation' } });
    const meters = result.result?.elevation;
    return { status: typeof meters === 'number' ? 'ready' : 'no-data', provider: 'Earth Engine', dataset: 'NASA/NASADEM_HGT/001', meters: typeof meters === 'number' ? meters : null, resolutionMeters: 30, note: 'Terrain elevation, not road-deck height. Cannot distinguish flyovers.' };
  }
  async function reason(job, terrain) {
    const text = `Generate a short advisory explanation for a navigation preview. The user selected preview intent: ${job.intent}. Terrain elevation in meters: ${terrain.meters ?? 'unavailable'}. Explain the general maneuver concept without inventing street names, lanes, road widths, restrictions, or safety assurances. State that signs and official directions take priority. Return JSON with explanation (max 220 characters). No geographic coordinates or Google imagery/instructions are provided. This is inference only; do not claim measured alignment.`;
    const data = await request(`https://aiplatform.googleapis.com/v1/projects/${config.project}/locations/global/publishers/google/models/${config.model}:generateContent`, { timeout: 45000, body: { contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 256, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { explanation: { type: 'STRING' } }, required: ['explanation'] } } } });
    const raw = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
    let output;
    try { output = JSON.parse(raw); } catch { throw new Error('Gemini did not return a valid structured explanation.'); }
    if (typeof output.explanation !== 'string' || !output.explanation.trim()) throw new Error('Gemini explanation missing.');
    return { status: 'ready', provider: 'Vertex AI / Gemini', model: config.model, explanation: output.explanation.slice(0, 500) };
  }
  async function enqueue(job) {
    const path = `scenes/${job.id}.json`;
    let exists = await readObject(path);
    if (exists) return exists.data;
    await consume('scenes');
    const pending = { id: job.id, status: 'queued', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), provider: 'Cloud Storage', services: { pubsub: 'pending' } };
    try { await writeObject(path, pending, '0'); }
    catch (error) { if (error.status === 412) return (await readObject(path)).data; throw error; }
    try {
      const result = await request(`https://pubsub.googleapis.com/v1/projects/${config.project}/topics/${config.topic}:publish`, { body: { messages: [{ data: Buffer.from(JSON.stringify(job)).toString('base64') }] } });
      return { ...pending, messageId: result.messageIds?.[0], services: { pubsub: 'published' } };
    } catch (error) {
      await writeObject(path, { ...pending, status: 'failed', error: 'Scene queue unavailable. Plan a new route to retry.' });
      throw error;
    }
  }
  async function processJob(job) {
    if (!job || !/^[0-9a-f-]{36}-\d$/.test(job.id) || !/^[0-9a-f-]{36}$/.test(job.routeId) || !Array.isArray(job.coordinates) || !['continue', 'left', 'right'].includes(job.intent)) throw new PublicError('Invalid scene job.');
    const path = `scenes/${job.id}.json`;
    const old = await readObject(path);
    if (!old || ['ready', 'partial', 'failed'].includes(old.data.status)) return;
    if (old.data.status === 'processing' && Date.now() - Date.parse(old.data.startedAt) < 180000) throw new PublicError('Scene is already being processed. Retry later.', 503);
    const attempts = (old.data.attempts || 0) + 1;
    if (attempts > 2) { await writeObject(path, { ...old.data, status: 'failed', error: 'Scene preparation retry limit reached.' }, old.generation); return; }
    try { await writeObject(path, { ...old.data, status: 'processing', startedAt: new Date().toISOString(), attempts }, old.generation); }
    catch (error) { if (error.status === 412) return; throw error; }
    const capture = async (provider, operation) => { try { return await operation(); } catch (error) { console.error('Scene provider failed', { provider, status: error.status, message: error.message }); return { status: 'error', provider, message: `${provider} unavailable (${error.status || 'provider error'}).` }; } };
    const [spatial, terrain] = await Promise.all([capture('BigQuery GIS', () => spatialIndex(job)), capture('Earth Engine', () => elevation(job.coordinates))]);
    const ai = await capture('Vertex AI / Gemini', () => reason(job, terrain));
    const result = { id: job.id, status: [spatial, terrain, ai].every(s => s.status === 'ready') ? 'ready' : 'partial', type: 'cloud-metadata', demo: false, createdAt: old.data.createdAt, expiresAt: old.data.expiresAt, attempts, source: 'Private Cloud Storage object', services: { pubsub: 'delivered', bigquery: spatial, earthEngine: terrain, gemini: ai }, anchors: [{ id: `${job.id}-arrow`, kind: 'arrow', position: [0, .2, 30], headingDegrees: job.intent === 'left' ? -30 : job.intent === 'right' ? 30 : 0 }], provenance: 'Illustrative local anchors and AI advisory, not calibrated to Street View pixels or road lanes.' };
    await writeObject(path, result);
  }
  async function scene(id) {
    const object = await readObject(`scenes/${id}.json`);
    if (!object) return null;
    if (Date.parse(object.data.expiresAt) < Date.now()) return null;
    return object.data;
  }
  async function authenticatePush(header) {
    if (!config.audience || !config.pushAccount || !header?.startsWith('Bearer ')) throw new PublicError('Push authentication required.', 401);
    try {
      const ticket = await verifier.verifyIdToken({ idToken: header.slice(7), audience: config.audience });
      const payload = ticket.getPayload();
      if (payload.email !== config.pushAccount || !payload.email_verified) throw new Error('Wrong push identity');
    } catch { throw new PublicError('Push authentication failed.', 403); }
  }
  return { search, computeRoute, enqueue, scene, processJob, authenticatePush, limits, elevation, reason, spatialIndex };
}
