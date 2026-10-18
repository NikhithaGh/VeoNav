import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { decodePolyline, normalizeRoute, routeRequest, signTicket, verifyTicket, liveTelemetry, PublicError } from '../server/real-navigation.js';
import { mountLiveApi } from '../server/live-api.js';
import { createCloudServices } from '../server/cloud-services.js';

const secret = 'test-only-signing-key-not-a-real-secret-123456789';
const routeData = { routes: [{ distanceMeters: 2500, duration: '600s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }, legs: [{ steps: [{ distanceMeters: 600, startLocation: { latLng: { longitude: -120.2, latitude: 38.5 } }, navigationInstruction: { maneuver: 'DEPART', instructions: 'Start' } }, { distanceMeters: 1900, startLocation: { latLng: { longitude: -120.95, latitude: 40.7 } }, navigationInstruction: { maneuver: 'TURN_LEFT', instructions: 'Turn left' } }] }] }] };
const input = { origin: [-120.2,38.5], destination: [-126.453,43.252], mode:'drive' };

test('real route input rejects invalid coordinates, modes, malformed provider geometry',()=>{
  assert.deepEqual(routeRequest(input),input);
  for(const origin of [[181,0],[0,91],[NaN,0],['1',0],null]) assert.throws(()=>routeRequest({...input,origin}),PublicError);
  assert.throws(()=>routeRequest({...input,mode:'fly'}),PublicError);
  assert.deepEqual(decodePolyline(routeData.routes[0].polyline.encodedPolyline),[[-120.2,38.5],[-120.95,40.7],[-126.453,43.252]]);
  assert.throws(()=>decodePolyline('_'),PublicError);
});

test('normalization preserves actual distance and derives bounded half-open geofences',()=>{
  const route=normalizeRoute(routeData,input,secret,1000);
  assert.equal(route.demo,false);assert.equal(route.durationMinutes,10);assert.equal(route.distanceMeters,2500);
  assert.equal(route.geofences[0].startMeters,500);assert.equal(route.geofences[0].endMeters,700);
  const session=verifyTicket(route.ticket,secret,1001);
  assert.equal(session.geofences[0].instruction,undefined);
  assert.equal(session.geofences[0].maneuver,undefined);
  assert.throws(()=>normalizeRoute({routes:[]},input,secret),/No route/);
  assert.throws(()=>normalizeRoute({routes:[{...routeData.routes[0],distanceMeters:100001}]},input,secret),/100 km/);
});

test('signed sessions reject tampering, expiry, and invalid telemetry',()=>{
  const route=normalizeRoute(routeData,input,secret);
  assert.equal(verifyTicket(route.ticket,secret).id,route.id);
  assert.throws(()=>verifyTicket(route.ticket.slice(0,-5)+'AAAAA',secret),/Invalid/);
  assert.throws(()=>verifyTicket(signTicket({expires:1},secret),secret,2),/expired/);
  assert.equal(liveTelemetry({ticket:route.ticket,progressMeters:0,speedKmh:30},secret).state,'upcoming');
  assert.equal(liveTelemetry({ticket:route.ticket,progressMeters:500,speedKmh:0},secret).state,'active');
  assert.equal(liveTelemetry({ticket:route.ticket,progressMeters:700,speedKmh:30},secret).state,'clear');
  assert.throws(()=>liveTelemetry({ticket:route.ticket,progressMeters:-1,speedKmh:0},secret),/Invalid/);
});

test('live API uses providers, requires route ownership, and never substitutes demo data',async t=>{
  const app=express();let queued;
  const config={enabled:true,mapsKey:'fake-key',browserKey:'restricted-public-key',secret};
  const services={ limits:{routes:30},search:async()=>[{id:'place',name:'Real place',coordinates:[0,0]}],computeRoute:async()=>routeData,enqueue:async job=>{queued=job;return{id:job.id,status:'queued'};},scene:async id=>({id,status:'ready'}),authenticatePush:async()=>{throw new PublicError('Denied',401);},processJob:async()=>{} };
  mountLiveApi(app,config,services);const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  const configResponse=await fetch(base+'/api/live/config').then(r=>r.json());assert.equal(configResponse.mapsKey,undefined);assert.equal(configResponse.secret,undefined);
  assert.equal((await post('/api/live/places',{query:'ab'})).status,400);
  assert.equal((await post('/api/live/places',{query:'Ferry Building'},{'sec-fetch-site':'cross-site'})).status,403);
  const route=await post('/api/live/route',input).then(r=>r.json());assert.equal(route.demo,false);
  assert.equal((await post('/api/live/scene',{ticket:route.ticket,sceneId:'wrong'})).status,403);
  assert.equal((await post('/api/live/scene',{ticket:route.ticket,sceneId:route.geofences[0].id,intent:'left'})).status,202);
  assert.equal(queued.intent,'left');assert.equal(queued.instruction,undefined);
  assert.equal((await fetch(base+`/api/live/scene/${queued.id}`)).status,401);
  assert.equal((await fetch(base+`/api/live/scene/${queued.id}`,{headers:{authorization:`Bearer ${route.ticket}`}})).status,200);
  assert.equal((await post('/internal/scene-worker',{message:{data:'e30='}})).status,401);
});

function fakeCloud() {
  const objects=new Map(); const calls=[]; let version=1;
  const request=async(url,options={})=>{
    calls.push({url,options});
    const parsed=new URL(url);
    if(parsed.hostname==='storage.googleapis.com') {
      if(parsed.pathname.startsWith('/upload/')) {
        const name=parsed.searchParams.get('name'),old=objects.get(name),match=parsed.searchParams.get('ifGenerationMatch');
        if(match!==null && match!==(old?.generation||'0'))throw Object.assign(new Error('Conflict'),{status:412});
        const item={data:options.body,generation:String(version++)};objects.set(name,item);return{generation:item.generation};
      }
      const name=decodeURIComponent(parsed.pathname.split('/o/')[1]);const item=objects.get(name);
      if(!item)throw Object.assign(new Error('Not found'),{status:404});
      return parsed.searchParams.get('alt')==='media'?item.data:{generation:item.generation};
    }
    if(parsed.hostname==='pubsub.googleapis.com')return{messageIds:['message-1']};
    if(parsed.hostname==='bigquery.googleapis.com')return{jobComplete:true,rows:[{f:[{v:'1'}]}]};
    if(parsed.hostname==='earthengine.googleapis.com')return{result:{elevation:18}};
    if(parsed.hostname==='aiplatform.googleapis.com')return{candidates:[{content:{parts:[{text:'{"explanation":"Follow posted signs; this is an illustrative preview."}'}]}}]};
    throw new Error('Unexpected request');
  };
  const config={project:'veonav',dataset:'aeronav_spatial',bucket:'test',topic:'test',location:'asia-south1',earthEnabled:true,model:'test-model'};
  return{services:createCloudServices(config,request),objects,calls};
}

test('cloud pipeline publishes once, indexes GIS, samples Earth Engine, invokes Gemini, and delivers stored metadata',async()=>{
  const{services,calls}=fakeCloud();const job={id:'12345678-1234-1234-1234-123456789012-0',routeId:'12345678-1234-1234-1234-123456789012',coordinates:[-122.4,37.8],intent:'left'};
  await services.enqueue(job);await services.enqueue(job);assert.equal(calls.filter(c=>c.url.includes('pubsub.googleapis.com')).length,1);
  await services.processJob(job);const scene=await services.scene(job.id);
  assert.equal(scene.status,'ready');assert.equal(scene.services.bigquery.nearby,1);assert.equal(scene.services.earthEngine.meters,18);assert.equal(scene.services.gemini.status,'ready');
  const count=calls.length;await services.processJob(job);assert.equal(calls.length,count+2);
  assert.equal(calls.find(c=>c.url.includes('bigquery')).options.body.maximumBytesBilled,'10485760');
  const prompt=calls.find(c=>c.url.includes('aiplatform')).options.body.contents[0].parts[0].text;
  assert.ok(!prompt.includes('-122.4'));assert.equal(scene.frames,undefined);
});

test('shared persistent quota fails closed at the daily scene limit',async()=>{
  const{services,objects}=fakeCloud();const key=`quota/${new Date().toISOString().slice(0,10)}-scenes.json`;
  objects.set(key,{data:{count:60},generation:'99'});
  await assert.rejects(()=>services.enqueue({id:'new'}),/limit/);
});
