import express from 'express';
import { cloudConfig, createCloudServices } from './cloud-services.js';
import { PublicError, normalizeRoute, routeRequest, verifyTicket } from './real-navigation.js';

export function mountLiveApi(app, config = cloudConfig(), services = createCloudServices(config)) {
  app.post('/internal/scene-worker', express.json({ limit: '20kb' }), async (req, res) => {
    try {
      if (!config.enabled) return res.sendStatus(503);
      await services.authenticatePush(req.headers.authorization);
      const encoded = req.body?.message?.data;
      if (typeof encoded !== 'string' || encoded.length > 16000) throw new PublicError('Invalid push payload.');
      const job = JSON.parse(Buffer.from(encoded, 'base64').toString());
      await services.processJob(job);
      res.sendStatus(204);
    } catch (error) {
      if (!(error instanceof PublicError)) console.error('Scene worker failed', { message: error.message });
      res.status(error instanceof PublicError ? error.status : 500).json({ error: 'Scene worker request failed.' });
    }
  });
  const router = express.Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/config', (_req, res) => res.json({ enabled: config.enabled, mapsBrowserKey: config.enabled ? config.browserKey || '' : '', limits: services.limits, earthEngineEnabled: config.earthEnabled, sceneStorage: config.enabled ? 'Private Cloud Storage' : 'disabled', model: config.model, privacy: 'Searches and chosen route endpoints are sent to Google. Preview coordinates expire after 24 hours. Photos and full route instructions are not stored.' }));
  router.use((req, res, next) => {
    if (!config.enabled || !config.mapsKey || !config.secret) return res.status(503).json({ error: 'Live integrations are not configured. The demo remains available.' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site live requests are not allowed.' });
    next();
  });
  const safe = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      if (error instanceof PublicError) return res.status(error.status).json({ error: error.message });
      console.error('Live API failed', { provider: error.provider, status: error.status, message: error.message });
      res.status(502).json({ error: 'A live provider could not complete this request. Check configuration, coverage, billing, or daily limits; no demo data was substituted.' });
    }
  };
  router.post('/places', safe(async (req, res) => {
    const query = req.body?.query;
    if (typeof query !== 'string' || query.trim().length < 3 || query.length > 150) throw new PublicError('Enter a place or address between 3 and 150 characters.');
    res.json({ places: await services.search(query.trim()), attribution: 'Google Maps' });
  }));
  router.post('/route', safe(async (req, res) => {
    const input = routeRequest(req.body);
    const route = normalizeRoute(await services.computeRoute(input), input, config.secret);
    res.json(route);
  }));
  router.post('/scene', safe(async (req, res) => {
    const ticket = verifyTicket(req.body?.ticket, config.secret);
    const zone = ticket.geofences.find(item => item.id === req.body.sceneId);
    if (!zone) throw new PublicError('Scene does not belong to this route session.', 403);
    const intent = req.body.intent || 'continue';
    if (!['continue', 'left', 'right'].includes(intent)) throw new PublicError('Invalid preview intent.');
    res.status(202).json(await services.enqueue({ id: zone.id, routeId: ticket.id, coordinates: zone.coordinates, intent }));
  }));
  router.get('/scene/:id', safe(async (req, res) => {
    const ticket = verifyTicket(req.headers.authorization?.replace(/^Bearer /, ''), config.secret);
    if (!ticket.geofences.some(zone => zone.id === req.params.id)) throw new PublicError('Scene does not belong to this route session.', 403);
    const scene = await services.scene(req.params.id);
    if (!scene) throw new PublicError('Scene has not been prepared or has expired.', 404);
    res.json(scene);
  }));
  app.use('/api/live', express.json({ limit: '16kb' }), router);
}
