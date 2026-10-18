import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, CheckCircle2, Cloud, Compass, Database, Globe2, Info, Layers3, LoaderCircle, LocateFixed, MapPin, Navigation, Pause, Play, RotateCcw, Search, ShieldCheck, Sparkles } from 'lucide-react';
import GoogleViewport from './GoogleViewport';
import Windshield from './Windshield';
import { advance, projectPosition, zoneFor } from './navigation';
import './live.css';

async function api(path, options = {}) {
  const response = await fetch(`/api/live/${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Live request failed.');
  return data;
}
const km = meters => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;

function PlaceSearch({ label, place, onSelect, allowGps }) {
  const [text, setText] = useState(place?.name || '');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const search = async event => {
    event.preventDefault(); controller.current?.abort(); controller.current = new AbortController();
    setBusy(true); setError(''); setResults([]);
    try { const data = await api('places', { method: 'POST', body: JSON.stringify({ query: text }), signal: controller.current.signal }); setResults(data.places); if (!data.places.length) setError('No matching places. Include a city or street.'); }
    catch (e) { if (e.name !== 'AbortError') setError(e.message); }
    finally { setBusy(false); }
  };
  function location() {
    if (!navigator.geolocation) { setError('Geolocation is not supported.'); return; }
    setBusy(true); setError('');
    navigator.geolocation.getCurrentPosition(position => { const value = { name: 'Current device location', coordinates: [position.coords.longitude, position.coords.latitude] }; setText(value.name); onSelect(value); setBusy(false); }, () => { setError('Location was unavailable or permission denied. Search an origin instead.'); setBusy(false); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 });
  }
  return <div className="live-place"><form onSubmit={search}><label>{label}<div className="live-search-field"><MapPin size={17}/><input value={text} maxLength={150} placeholder="Place or address, including city" onChange={e => { setText(e.target.value); onSelect(null); setResults([]); }}/><button type="submit" disabled={busy || text.trim().length < 3} aria-label={`Search ${label.toLowerCase()}`}>{busy ? <LoaderCircle className="spin" size={17}/> : <Search size={17}/>}</button>{allowGps && <button type="button" onClick={location} disabled={busy} aria-label="Use current location as origin"><LocateFixed size={17}/></button>}</div></label></form>
    {place && <small className="place-confirmed"><CheckCircle2 size={12}/>{place.address || 'Coordinates selected'}</small>}
    {results.length > 0 && <div className="live-search-results">{results.map(result => <button key={result.id} onClick={() => { onSelect(result); setText(result.name); setResults([]); }}><MapPin size={15}/><span><strong>{result.name}</strong><small>{result.address}</small></span></button>)}<div className="google-attribution" translate="no">Google Maps</div>{results.flatMap(p=>p.attributions).map((a,i)=><span className="place-attribution" key={i}>{a.provider || ''}</span>)}</div>}
    {error && <p className="live-inline-error" role="alert">{error}</p>}
  </div>;
}

export default function LiveNavigator() {
  const [config, setConfig] = useState(null);
  const [origin, setOrigin] = useState({ name: 'Market Street, San Francisco', coordinates: [-122.4194, 37.7765] });
  const [destination, setDestination] = useState({ name: 'Ferry Building, San Francisco', coordinates: [-122.3937, 37.7955] });
  const [mode, setMode] = useState('drive');
  const [route, setRoute] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(30);
  const [progress, setProgress] = useState(0);
  const [street, setStreet] = useState(false);
  const [synthetic, setSynthetic] = useState(false);
  const [gps, setGps] = useState(false);
  const [connection, setConnection] = useState('idle');
  const [scene, setScene] = useState(null);
  const [sceneError, setSceneError] = useState('');
  const [intent, setIntent] = useState('continue');
  const [autoPrepare, setAutoPrepare] = useState(true);
  const [prepareRevision, setPrepareRevision] = useState(0);
  const values = useRef({ progress, speed }); values.current = { progress, speed };
  const queued = useRef(new Set());
  const { active, upcoming } = zoneFor(route, progress);
  const zone = active || upcoming;
  const zoneId = zone?.id;
  const arrived = route && progress >= route.distanceMeters;
  const currentStep = route?.steps.filter(step => step.atMeters <= progress).at(-1);

  useEffect(() => { const controller = new AbortController(); api('config', { signal: controller.signal }).then(setConfig).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => controller.abort(); }, []);
  useEffect(() => {
    if (!running || !route || gps) return;
    let last = performance.now();
    const timer = setInterval(() => { const now = performance.now(); const dt = Math.min(1, (now - last) / 1000); last = now; setProgress(value => advance(value, speed, dt, route.distanceMeters)); }, 100);
    return () => clearInterval(timer);
  }, [running, speed, route, gps]);
  useEffect(() => { if (arrived) { setRunning(false); setGps(false); } }, [arrived]);
  useEffect(() => { setRoute(null); setRunning(false); setGps(false); setProgress(0); setScene(null); setStreet(false); }, [origin, destination, mode]);
  useEffect(() => {
    if (!route) return;
    let disposed = false, socket, retry, interval;
    const connect = () => {
      setConnection('connecting'); socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
      socket.onopen = () => { if(disposed)return; setConnection('connected'); const send = () => { if(socket.readyState === 1) socket.send(JSON.stringify({ type: 'live-telemetry', ticket: route.ticket, progressMeters: values.current.progress, speedKmh: values.current.speed })); }; send(); interval = setInterval(send, 2000); };
      socket.onmessage = e => { try { const message = JSON.parse(e.data); if (message.type === 'error') {setConnection('session error');setError(message.error);} } catch {} };
      socket.onerror = () => { if(!disposed)setConnection('offline'); };
      socket.onclose = () => { clearInterval(interval); if(!disposed){setConnection('offline');retry=setTimeout(connect,5000);} };
    }; connect();
    return () => { disposed=true;clearTimeout(retry);clearInterval(interval);socket?.close(); };
  }, [route]);
  useEffect(() => {
    setScene(null); setSceneError('');
    if (!route || !zoneId || !autoPrepare) return;
    const controller = new AbortController(); let timer, disposed = false, attempts = 0;
    const poll = async () => {
      if(disposed)return;
      try {
        const data = await api(`scene/${encodeURIComponent(zoneId)}`, { signal: controller.signal, headers: { Authorization: `Bearer ${route.ticket}` } });
        if(disposed)return;setScene(data);
        if (['queued','processing'].includes(data.status) && ++attempts < 24) timer=setTimeout(poll,5000);
        else if (['queued','processing'].includes(data.status)) setSceneError('Preparation is taking longer than expected. Retry status below.');
      } catch(e) {if(e.name!=='AbortError')setSceneError(e.message);}
    };
    const prepare = async () => {
      try {
        if(!queued.current.has(zoneId)) {
          const data = await api('scene', { method:'POST',body:JSON.stringify({ticket:route.ticket,sceneId:zoneId,intent}),signal:controller.signal });
          if(disposed)return;queued.current.add(zoneId);setScene(data);
        }
        timer=setTimeout(poll,2000);
      } catch(e){if(e.name!=='AbortError')setSceneError(e.message);}
    }; prepare();
    return()=>{disposed=true;controller.abort();clearTimeout(timer);};
  }, [route, zoneId, autoPrepare, prepareRevision]);
  useEffect(() => {
    if(!gps||!route)return;
    if(!navigator.geolocation){setError('GPS is unavailable.');setGps(false);return;}
    const id=navigator.geolocation.watchPosition(fix=>{
      const match=projectPosition(route.coordinates,[fix.coords.longitude,fix.coords.latitude],route.distanceMeters);
      if(match.offset>150){setError('You are more than 150 m from this route. Replan from your current location; automatic rerouting is not enabled.');setGps(false);setRunning(false);return;}
      setProgress(match.meters);setSpeed(Math.max(0,(fix.coords.speed||0)*3.6));
    },()=>{setError('GPS permission denied or location unavailable.');setGps(false);setRunning(false);},{enableHighAccuracy:false,maximumAge:2000,timeout:15000});
    return()=>navigator.geolocation.clearWatch(id);
  },[gps,route]);

  async function plan() {
    setBusy(true);setError('');setRunning(false);setGps(false);setScene(null);setSceneError('');setRoute(null);setStreet(false);
    try { const result=await api('route',{method:'POST',body:JSON.stringify({origin:origin.coordinates,destination:destination.coordinates,mode})});setRoute(result);setProgress(0);queued.current.clear(); }
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  function play(){if(gps){setGps(false);setRunning(false);return;}if(arrived)setProgress(0);setRunning(!running);}
  const ai=scene?.services?.gemini, terrain=scene?.services?.earthEngine, spatial=scene?.services?.bigquery;
  return <div className="live-page">
    <section className="live-intro"><div><div className="eyebrow"><span/>CONNECTED TO THE REAL WORLD</div><h1>A real route. A clearer perspective.</h1><p>Google Maps routing and Street View, with cloud-prepared spatial insights.</p></div><span className="live-label"><span className="live-dot"/>LIVE SERVICES</span></section>
    <div className="live-layout"><section className="live-planner"><h2>Where are you headed?</h2><p className="live-subtle">Search explicitly to limit API usage. Choose a result before planning.</p>
      <PlaceSearch label="Starting from" place={origin} onSelect={setOrigin} allowGps/>
      <PlaceSearch label="Destination" place={destination} onSelect={setDestination}/>
      <div className="travel-toggle"><button className={mode==='drive'?'active':''} onClick={()=>{setMode('drive');setSpeed(30);}}>Driving</button><button className={mode==='walk'?'active':''} onClick={()=>{setMode('walk');setSpeed(5);}}>Walking</button></div>
      <button className="start-button" onClick={plan} disabled={!config?.enabled||!config?.mapsBrowserKey||!origin||!destination||busy}>{busy?<LoaderCircle className="spin" size={17}/>:<Navigation size={17}/>}<span>{busy?'Finding a real route…':'Plan with Google Maps'}</span><ArrowRight size={16}/></button>
      <p className="live-consent">Planning sends selected endpoints to Google and loads a Google Map. <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy</a> · <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a></p>
      {config&&!config.enabled&&<p className="live-inline-error">Live services are not enabled in this environment. The separate demo is still available.</p>}
      {error&&<div className="live-inline-error" role="alert">{error}</div>}
      {route&&<><div className="live-route-stats"><strong>{route.durationMinutes}<small>min</small></strong><span>{km(route.distanceMeters)}<small>{route.geofences.length} preview zones · {route.mode==='walk'?'walking':'driving'}</small></span></div><span className="google-attribution" translate="no">Google Maps</span>{route.warnings.map((warning,i)=><p key={i} className="live-warning">{warning}</p>)}<div className="live-steps">{route.geofences.map((fence,i)=><button key={fence.id} className={zoneId===fence.id?'selected':''} onClick={()=>{setGps(false);setRunning(false);setProgress(fence.startMeters);}}><span>{i+1}</span><div><strong>{fence.instruction}</strong><small>{km(Math.max(0,fence.startMeters-progress))} ahead</small></div></button>)}</div></>}
      <div className="live-privacy"><ShieldCheck size={17}/><p>Preview coordinates expire after 24 hours. No Google panorama images are downloaded or cached by AeroNav.</p></div>
    </section>
    <div className="live-main">
      {route?<GoogleViewport apiKey={config.mapsBrowserKey} route={route} progress={progress} showStreet={street} onStreetChange={setStreet}/>:<div className="live-placeholder"><span><Globe2 size={43}/></span><h2>The world is ready when you are.</h2><p>Choose an origin and a destination, then plan your route. Real imagery loads only when requested.</p><div><span><Navigation size={14}/>Google Routes</span><span><Cloud size={14}/>Google Cloud</span><span><Sparkles size={14}/>Vertex AI</span></div></div>}
      {route&&<><section className="live-controls"><div className="live-maneuver"><Navigation size={20}/><span><strong>{arrived?'Destination reached':currentStep?.instruction||'Follow the route'}</strong><small>Google Maps directions · {connection==='connected'?'WebSocket connected':connection}</small></span></div><div className="live-playback"><button className="play-button" onClick={play} aria-label={running||gps?'Pause real route playback':'Play real route simulation'}>{running||gps?<Pause size={15}/>:<Play size={15}/>}</button><label className="live-progress">{km(progress)} / {km(route.distanceMeters)}<input type="range" min="0" max={route.distanceMeters} value={progress} disabled={gps} aria-label="Real route progress" onChange={e=>setProgress(Number(e.target.value))}/></label><label className="live-speed">{Math.round(speed)} km/h<input type="range" min="0" max={mode==='walk'?12:90} value={Math.min(speed,mode==='walk'?12:90)} disabled={gps} aria-label="Real route speed" onChange={e=>setSpeed(Number(e.target.value))}/></label><button className="icon-button" onClick={()=>{setGps(false);setRunning(false);setProgress(0);}} aria-label="Reset real route"><RotateCcw size={17}/></button></div><button className="live-gps" onClick={()=>{setGps(!gps);setRunning(false);}}><LocateFixed size={14}/>{gps?'Stop GPS matching':'Use GPS on this route'}</button><span className="live-subtle">{gps?'Device GPS mode':'Simulation along a real route'}</span></section>
        <section className="cloud-panel"><div className="cloud-panel-title"><div><span className="eyebrow">PREDICTIVE SCENE PIPELINE</span><h2>{zone?'Your next preview, prepared in the cloud.':'Preparing when you are within 500 meters.'}</h2></div><label className="auto-toggle"><input type="checkbox" checked={autoPrepare} onChange={e=>setAutoPrepare(e.target.checked)}/>Auto prepare</label></div>
          <div className="cloud-status-grid"><Service name="Pub/Sub" state={scene?.services?.pubsub||'waiting'} icon={Cloud}/><Service name="Cloud Storage" state={scene?'delivered':'waiting'} icon={Layers3}/><Service name="BigQuery GIS" state={spatial?.status||'waiting'} icon={Database}/><Service name="Earth Engine" state={terrain?.status||'waiting'} icon={Globe2}/><Service name="Vertex AI / Gemini" state={ai?.status||'waiting'} icon={Sparkles}/></div>
          <div className="preview-intent"><label>AI preview intent <select value={intent} onChange={e=>setIntent(e.target.value)}><option value="continue">Continue / approach</option><option value="left">Left turn concept</option><option value="right">Right turn concept</option></select></label><small>Used for the next uncached scene. AI does not choose your lane or override route instructions.</small></div>
          {scene&&<div className="scene-metadata"><span>Scene: <strong>{scene.status}</strong></span>{spatial?.status==='ready'&&<span>{spatial.nearby} indexed point(s) within 500 m</span>}{terrain?.status==='ready'&&<span>Terrain: <strong>{Math.round(terrain.meters)} m</strong> · NASADEM 30 m</span>}</div>}
          {ai?.status==='ready'&&<div className="ai-explanation"><Sparkles size={18}/><div><strong>AI advisory · {ai.model}</strong><p>{ai.explanation}</p></div></div>}
          {terrain?.status==='ready'&&<p className="live-subtle">{terrain.note}</p>}
          {[spatial,terrain,ai].filter(service=>service?.status==='error').map(service=><p className="live-inline-error" key={service.provider}>{service.message}</p>)}
          {sceneError&&<p className="live-inline-error">{sceneError}</p>}{(sceneError||scene?.status==='partial')&&<button className="button-outline" onClick={()=>setPrepareRevision(prepareRevision+1)}>Refresh scene status</button>}
          {scene?.anchors&&<><button className="button-outline synthetic-toggle" onClick={()=>setSynthetic(!synthetic)}><Layers3 size={14}/>{synthetic?'Hide':'Show'} separate illustrative 3D arrows</button>{synthetic&&<div className="synthetic-scene"><Windshield progress={progress} speed={speed} running={running} expanded={false} onExpand={()=>setSynthetic(false)} heading={null} scenePack={scene} instruction="Illustrative anchors — not registered to Street View"/></div>}</>}
        </section></>}
    </div></div><footer className="live-footer"><Info size={15}/><p>Research prototype, not safety-critical guidance. Street View is historical and may be missing. Geofences are heuristic, not a trained predictor. Terrain data cannot identify road decks. Cloud/API charges can apply; a $50 budget is an alert target, not a spending cap.</p></footer>
  </div>;
}
function Service({name,state,icon:Icon}) { const good=['ready','delivered','published'].includes(state);return <div className={`service-tile ${good?'ready':''}`}><Icon size={17}/><strong>{name}</strong><span>{state}</span></div>; }
