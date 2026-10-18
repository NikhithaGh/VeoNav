import assert from 'node:assert/strict';
import WebSocket from 'ws';

if (!process.argv.includes('--allow-billable')) {
  console.error('This check makes paid provider calls. Re-run with --allow-billable to authorize one search, route, and scene preparation.');
  process.exit(1);
}
const base = process.env.AERONAV_URL || 'https://aeronav-933096818749.asia-south1.run.app';
async function call(path, body, ticket) {
  const response = await fetch(`${base}/api/live/${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(ticket ? { authorization: `Bearer ${ticket}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${data.error}`);
  return data;
}
const config = await call('config');
assert.equal(config.enabled, true);assert.ok(config.mapsBrowserKey);
const search = await call('places', { query: 'Ferry Building San Francisco' });
assert.ok(search.places.length);console.log('PASS Google Places: real search results received.');
const route = await call('route', { origin: [-122.4194,37.7765], destination: search.places[0].coordinates, mode: 'drive' });
assert.equal(route.demo,false);assert.ok(route.coordinates.length>2);console.log(`PASS Google Routes: ${route.distanceMeters}m, ${route.geofences.length} heuristic preview zones.`);
const zone = route.geofences[0];
await new Promise((resolve,reject)=>{
  const ws = new WebSocket(base.replace('https:','wss:').replace('http:','ws:')+'/ws');
  const timeout=setTimeout(()=>{ws.terminate();reject(new Error('WS timeout'));},20000);
  ws.on('open',()=>ws.send(JSON.stringify({type:'live-telemetry',ticket:route.ticket,progressMeters:zone.startMeters,speedKmh:20})));
  ws.on('message',data=>{const event=JSON.parse(data);if(event.type==='geofence'){clearTimeout(timeout);ws.close();try{assert.equal(event.state,'active');resolve();}catch(e){reject(e);}}else if(event.type==='error'){clearTimeout(timeout);ws.close();reject(new Error(event.error));}});
  ws.on('error',reject);
});
console.log('PASS signed live WebSocket geofence telemetry.');
await call('scene',{ticket:route.ticket,sceneId:zone.id,intent:'continue'});
let scene;
for(let i=0;i<30;i++){
  await new Promise(resolve=>setTimeout(resolve,4000));
  scene=await call(`scene/${zone.id}`,undefined,route.ticket);
  if(!['queued','processing'].includes(scene.status))break;
}
console.log(JSON.stringify({sceneStatus:scene.status,services:scene.services,source:scene.source},null,2));
assert.equal(scene.status,'ready','Every connected provider must be verified, not just configured.');
console.log('PASS end-to-end Pub/Sub → BigQuery GIS + Earth Engine + Gemini → private Cloud Storage delivery.');
