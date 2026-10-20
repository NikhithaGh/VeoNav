import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { createRoute, geofenceState, listRoutes, sceneById, validateTelemetry } from './navigation.js';
import { mountLiveApi } from './live-api.js';
import { liveTelemetry } from './real-navigation.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({ distPath = join(projectRoot, 'dist') } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'aeronav', demo: true, live: process.env.LIVE_INTEGRATIONS === 'true' }));

  const clients = new Map();
  app.use('/api', (req, res, next) => {
    const now = Date.now();
    const key = req.socket.remoteAddress ?? 'unknown';
    let bucket = clients.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (clients.size >= 4096) {
        for (const [address, entry] of clients) {
          if (entry.resetAt <= now) clients.delete(address);
        }
        if (clients.size >= 4096 && !clients.has(key)) {
          return res.status(503).json({ error: 'Server busy. Retry later.' });
        }
      }
      bucket = { count: 0, resetAt: now + 60_000 };
      clients.set(key, bucket);
    }
    if (++bucket.count > 120) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'API rate limit exceeded.' });
    }
    next();
  });
  mountLiveApi(app);
  app.use('/api', express.json({ limit: '8kb', strict: true }));
  app.get('/api/routes', (_req, res) => res.json({ routes: listRoutes(), demo: true }));
  app.post('/api/route', (req, res) => {
    try {
      res.json(createRoute(req.body));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      res.status(400).json({ error: error.message });
    }
  });
  app.get('/api/scenes/:id', (req, res) => {
    const scene = sceneById(req.params.id);
    if (!scene) return res.status(404).json({ error: 'Unknown scene.' });
    res.json(scene);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  app.get('/ws', (_req, res) => res.status(426).json({ error: 'WebSocket upgrade required.' }));
  app.get(['/v2', '/v2/'], (_req, res) => res.status(404).type('text').send('This page has moved. Open / for the latest Pune experience.'));
  app.use(express.static(distPath, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || !req.accepts('html')) return next();
    const index = join(distPath, 'index.html');
    if (!existsSync(index)) return next();
    res.sendFile(index);
  });
  app.use((_req, res) => res.status(404).json({ error: 'Not found. Build the frontend to serve the demo UI.' }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return _next(error);
    const status = error.status === 413 ? 413 : error.status >= 400 && error.status < 500 ? error.status : 500;
    res.status(status).json({ error: status === 413 ? 'Payload too large.' : status < 500 ? 'Invalid request.' : 'Internal server error.' });
  });
  return app;
}

export function createHttpServer(options) {
  const app = createApp(options);
  const server = createServer(app);
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  let closing = false;

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    let path;
    try { path = new URL(req.url, 'http://localhost').pathname; } catch { socket.destroy(); return; }
    if (path !== '/ws' || closing || wss.clients.size >= 256) {
      socket.end(`HTTP/1.1 ${path !== '/ws' ? '404 Not Found' : '503 Service Unavailable'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    let windowStart = Date.now();
    let messages = 0;
    let invalidMessages = 0;
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    const send = (value) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 64 * 1024) { ws.terminate(); return; }
      ws.send(JSON.stringify(value));
    };
    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      if (now - windowStart >= 1000) { windowStart = now; messages = 0; }
      if (++messages > 30) { ws.close(1008, 'Telemetry rate limit exceeded'); return; }
      try {
        if (isBinary) throw new TypeError('Send telemetry as JSON text.');
        const value = JSON.parse(data.toString());
        if (value.type === 'live-telemetry') {
          send(liveTelemetry(value, process.env.ROUTE_SIGNING_SECRET?.trim()));
          return;
        }
        const { route, progressMeters, speedKmh } = validateTelemetry(value);
        send({ type: 'geofence', routeId: route.id, speedKmh, ...geofenceState(route, progressMeters) });
      } catch (error) {
        send({ type: 'error', error: error instanceof SyntaxError ? 'Invalid JSON.' : error.message });
        if (++invalidMessages >= 3) ws.close(1008, 'Repeated invalid telemetry');
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();
  server.on('close', () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  });

  let shutdownPromise;
  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    closing = true;
    clearInterval(heartbeat);
    shutdownPromise = new Promise((resolveShutdown) => {
      const deadline = setTimeout(() => {
        for (const ws of wss.clients) ws.terminate();
        server.closeAllConnections();
      }, 8000);
      deadline.unref();
      for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
      server.close(() => { clearTimeout(deadline); resolveShutdown(); });
    });
    return shutdownPromise;
  }
  return { app, server, wss, shutdown };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535.');
  const { server, shutdown } = createHttpServer();
  server.listen(port, '0.0.0.0', () => console.log(`AeroNav listening on port ${server.address().port}`));
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  const stop = () => { void shutdown(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
