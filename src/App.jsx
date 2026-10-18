import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, AudioLines, Bookmark, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, Cloud, Compass, Flag, Footprints, Github, Globe2, Info, Layers3, Leaf, Link, LoaderCircle, LocateFixed, Map, MapPin, Navigation, Navigation2, Pause, Play, Radio, RotateCcw, Route, Search, Settings2, ShieldCheck, Sparkles, Volume2, VolumeX, X, Zap, CarFront } from 'lucide-react';
import RouteMap from './RouteMap';
import Windshield from './Windshield';
import LiveNavigator from './LiveNavigator';
import { advance, destinations, projectPosition, zoneFor } from './navigation';

function readSaved() { try { const value = JSON.parse(localStorage.getItem('aeronav-saved') || '[]'); return Array.isArray(value) ? value.filter(id => destinations.some(place => place.id === id)) : []; } catch { return []; } }
const distanceLabel = meters => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;

export default function App() {
  const [destination, setDestination] = useState('ferry');
  const [mode, setMode] = useState('drive');
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(36);
  const [view, setView] = useState('hybrid');
  const [expanded, setExpanded] = useState(false);
  const [auto3d, setAuto3d] = useState(true);
  const [modal, setModal] = useState(null);
  const [tab, setTab] = useState('live');
  const isLive = tab === 'live';
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [saved, setSaved] = useState(readSaved);
  const [toast, setToast] = useState('');
  const [sound, setSound] = useState(false);
  const [gps, setGps] = useState(false);
  const [gpsPosition, setGpsPosition] = useState(null);
  const [heading, setHeading] = useState(null);
  const [socketStatus, setSocketStatus] = useState('connecting');
  const [scenePack, setScenePack] = useState(null);
  const [serverEvent, setServerEvent] = useState(null);
  const [sceneError, setSceneError] = useState('');
  const [retry, setRetry] = useState(0);
  const ws = useRef(null);
  const telemetry = useRef({ progress, speed, running });
  const orientationCleanup = useRef(null);
  telemetry.current = { progress, speed, running };
  const selected = destinations.find(d=>d.id===destination);
  const { active, upcoming } = zoneFor(route, progress);
  const arrived = !!route && progress >= route.distanceMeters;
  const next = route?.geofences.find(zone=>zone.endMeters > progress);
  const remaining = Math.max(0, (route?.distanceMeters || 0) - progress);
  const minutes = Math.max(0, Math.ceil((route?.durationMinutes || 0) * remaining / (route?.distanceMeters || 1)));
  const effectiveView = auto3d && active && running ? 'hybrid' : view;

  useEffect(()=>{
    if (isLive) { setRunning(false); setGps(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(''); setRunning(false); setProgress(0); setScenePack(null); setServerEvent(null); setGps(false); setGpsPosition(null);
    fetch('/api/route', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({destinationId:destination,mode}), signal:controller.signal })
      .then(async response=>{if(!response.ok) throw new Error('Route service is unavailable. Please try again.'); return response.json();})
      .then(data=>{setRoute(data);setLoading(false);})
      .catch(e=>{if(e.name!=='AbortError'){setError(e.message);setLoading(false);setRoute(null);}});
    return ()=>controller.abort();
  },[destination,mode,retry,isLive]);

  useEffect(()=>{
    if (!route || isLive) return;
    let disposed = false, socket, timer, reconnect;
    const connect = () => {
      setSocketStatus('connecting');
      socket = new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`);
      ws.current = socket;
      socket.onopen = ()=>{if(disposed)return;setSocketStatus('connected'); const send=()=>{if(socket.readyState===1) socket.send(JSON.stringify({type:'telemetry',routeId:route.id,progressMeters:telemetry.current.progress,speedKmh:telemetry.current.speed}));};send();timer=setInterval(send,1000);};
      socket.onmessage=e=>{try {const event=JSON.parse(e.data); if(event.type==='geofence')setServerEvent(event);}catch{/* Ignore malformed network messages. */}};
      socket.onclose=()=>{clearInterval(timer);if(!disposed){setSocketStatus('offline');reconnect=setTimeout(connect,4000);}};
      socket.onerror=()=>{if(!disposed)setSocketStatus('offline');};
    }; connect();
    return ()=>{disposed=true;clearTimeout(reconnect);clearInterval(timer);socket?.close();ws.current=null;};
  },[route,isLive]);

  useEffect(()=>{
    if(!running||!route||gps) return;
    let last=performance.now();
    const timer=setInterval(()=>{const now=performance.now();const dt=Math.min((now-last)/1000,1);last=now;setProgress(value=>advance(value,speed,dt,route.distanceMeters));},100);
    return ()=>clearInterval(timer);
  },[running,speed,route,gps]);

  useEffect(()=>{if(arrived){setRunning(false);setGps(false);}},[arrived]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{if(!modal)return;const onKey=e=>{if(e.key==='Escape')setModal(null);};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[modal]);
  useEffect(()=>()=>orientationCleanup.current?.(),[]);

  const sceneId = active?.sceneId || upcoming?.sceneId;
  useEffect(()=>{
    if(!sceneId){setScenePack(null);setSceneError('');return;}
    const controller=new AbortController();setSceneError('');
    fetch(`/api/scenes/${encodeURIComponent(sceneId)}`,{signal:controller.signal}).then(response=>{if(!response.ok)throw new Error('Scene pack unavailable');return response.json();}).then(setScenePack).catch(e=>{if(e.name!=='AbortError'){setScenePack(null);setSceneError('Scene metadata unavailable. Local preview still works.');}});
    return()=>controller.abort();
  },[sceneId]);

  useEffect(()=>{
    if(!active||!sound||!running||!('speechSynthesis' in window))return;
    const speech=new SpeechSynthesisUtterance(active.instruction); speech.rate=.95; window.speechSynthesis.speak(speech);
    return()=>window.speechSynthesis.cancel();
  },[active?.id,sound,running]);

  useEffect(()=>{
    if(!gps||!route)return;
    if(!navigator.geolocation){setToast('Geolocation is not supported in this browser.');setGps(false);return;}
    let lastFix=null;
    const id=navigator.geolocation.watchPosition(position=>{
      const point=[position.coords.longitude,position.coords.latitude];setGpsPosition(point);
      const match=projectPosition(route.coordinates,point,route.distanceMeters);
      const derived=lastFix ? Math.max(0,(match.meters-lastFix.meters)/Math.max(.1,(position.timestamp-lastFix.time)/1000)*3.6):0;
      const measured=position.coords.speed == null ? derived : position.coords.speed*3.6;
      setSpeed(Math.min(200,Math.max(0,measured)));
      if(position.coords.heading!=null)setHeading(position.coords.heading);
      if(match.offset>150){setRunning(false);setToast('Your GPS location is outside this San Francisco demo route. Use simulation to explore it.');setGps(false);return;}
      if(telemetry.current.running) setProgress(match.meters);
      lastFix={meters:match.meters,time:position.timestamp};
    },e=>{setToast(e.code===1?'Location permission denied. Simulation is still available.':'GPS could not get a location. Try outdoors or use simulation.');setGps(false);setRunning(false);}, {enableHighAccuracy:false,maximumAge:2000,timeout:15000});
    return()=>navigator.geolocation.clearWatch(id);
  },[gps,route]);

  function choose(id){setDestination(id);setSearchOpen(false);setSearch('');setTab('explore');}
  function toggleSaved(){const list=saved.includes(destination)?saved.filter(id=>id!==destination):[...saved,destination];setSaved(list);try{localStorage.setItem('aeronav-saved',JSON.stringify(list));}catch{setToast('Browser storage unavailable. Saved for this session only.');}}
  function previewZone(zone){setGps(false);setProgress(zone.startMeters);setView('hybrid');setExpanded(false);setToast(`Previewing ${zone.name}`);}
  async function enableOrientation(){try{if(!window.DeviceOrientationEvent)throw new Error();if(typeof DeviceOrientationEvent.requestPermission==='function'&&await DeviceOrientationEvent.requestPermission()!=='granted')throw new Error();orientationCleanup.current?.();const handler=e=>{if(e.alpha!=null)setHeading(e.webkitCompassHeading??(360-e.alpha));};window.addEventListener('deviceorientation',handler);orientationCleanup.current=()=>window.removeEventListener('deviceorientation',handler);setToast('Device orientation enabled where sensor data is available.');}catch{setToast('Orientation unavailable or permission denied. Drag the 3D preview to look around.');}}
  async function share(){try{await navigator.clipboard.writeText(`${location.origin}/?destination=${destination}`);setToast('Shareable demo link copied.');}catch{setToast(`Share this URL: ${location.origin}/?destination=${destination}`);}}
  useEffect(()=>{const id=new URLSearchParams(location.search).get('destination');if(destinations.some(d=>d.id===id))setDestination(id);},[]);

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="AeroNav home"><span className="brand-icon"><Navigation2 size={24} fill="currentColor"/></span><span>AeroNav<span className="brand-period">.</span></span></a>
      <div className="workspace-label">YOUR NEXT CHAPTER, CLOSER</div>
      <nav className="main-nav" aria-label="Main navigation">
        <button className={isLive?'selected':''} onClick={()=>setTab('live')}><Globe2 size={19}/>Live navigation<span className="nav-dot"/></button>
        <button className={tab==='explore'?'selected':''} onClick={()=>setTab('explore')}><Compass size={19}/>Explore<span className="nav-dot"/></button>
        <button className={tab==='saved'?'selected':''} onClick={()=>setTab('saved')}><Bookmark size={18}/>Saved places{saved.length>0&&<span className="count">{saved.length}</span>}</button>
        <button className={tab==='journey'?'selected':''} onClick={()=>setTab('journey')}><Route size={19}/>Your journey</button>
      </nav>
      <div className="sidebar-divider"/>
      <div className="sidebar-subtitle">THE AERONAV DIFFERENCE</div>
      <div className="sidebar-feature"><Layers3 size={17}/><span>See the turn. Before the turn.</span></div>
      <div className="sidebar-feature"><Zap size={17}/><span>Less processing. More exploring.</span></div>
      <div className="sidebar-feature"><Globe2 size={17}/><span>Just a link. No downloads.</span></div>
      <div className="sidebar-bottom"><div className="eco-card"><span className="eco-icon"><Leaf size={19}/></span><h3>A lighter way to go.</h3><p>Built for the journey.<br/>Not for draining your battery.</p><span>LOW-OVERHEAD BY DESIGN <ArrowUpRight size={13}/></span></div>
        <button className="sidebar-help" onClick={()=>setModal('about')}><Info size={17}/>About this prototype<ArrowUpRight size={14}/></button><div className="sidebar-footer"><span className="live-dot"/>OPEN WEB. OPEN POSSIBILITIES.<small>© 2026 AeroNav</small></div>
      </div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={14}/><strong>{isLive?'Live navigation':tab==='saved'?'Saved places':tab==='journey'?'Your journey':'Demo explorer'}</strong></div><div className="topbar-right"><span className="prototype-pill"><span className="live-dot"/>HACKATHON PROTOTYPE</span><button className="icon-button" onClick={()=>setModal(isLive?'live-settings':'settings')} aria-label="Navigation settings"><Settings2 size={18}/></button><span className="avatar">AN</span></div></header>
      <main>
        {isLive ? <LiveNavigator/> : <>
        <section className="page-heading"><div><div className="eyebrow"><span/>A CLEARER WAY FORWARD</div><h1>{tab==='saved'?'Good places, kept close.':tab==='journey'?'Every turn, in perspective.':'Less second-guessing. More going.'}</h1><p>{tab==='saved'?'Your next adventure is right where you left it.':tab==='journey'?'Follow the route, explore the details, and see what’s ahead.':'Predictive 3D navigation that makes the unfamiliar feel familiar.'}</p></div><button className="button-outline heading-action" onClick={()=>setModal('how')}><Play size={14} fill="currentColor"/>How it works</button></section>

        {tab==='saved'&&<section className="saved-section">{saved.length ? destinations.filter(d=>saved.includes(d.id)).map(d=><button className="saved-place" key={d.id} onClick={()=>choose(d.id)}><span className="saved-icon"><MapPin size={23}/></span><div><strong>{d.name}</strong><small>{d.address}</small></div><ArrowUpRight size={20}/></button>):<div className="empty-saved"><Bookmark size={26}/><div><strong>A little inspiration for later.</strong><p>Save a destination using the bookmark beside your route.</p></div><button className="button-outline" onClick={()=>setTab('explore')}>Explore places <ArrowRight size={15}/></button></div>}</section>}

        <div className="explorer-grid">
          <section className="route-panel" aria-label="Route planner">
            <div className="panel-title"><h2>Your next destination</h2><span className="tiny-chip">DEMO ROUTE</span></div>
            <div className="travel-toggle"><button className={mode==='drive'?'active':''} onClick={()=>{setMode('drive');setSpeed(36);}}><CarFront size={17}/>Driving</button><button className={mode==='walk'?'active':''} onClick={()=>{setMode('walk');setSpeed(5);}}><Footprints size={16}/>Walking</button></div>
            <div className="route-inputs"><div className="route-origin"><span className="origin-dot"/><div><small>STARTING FROM</small><strong>Market Street, San Francisco</strong></div><button className={`icon-button ${gps?'active-icon':''}`} onClick={()=>{if(gps){setGps(false);setRunning(false);}else{setGps(true);setToast('Requesting GPS. Location stays on this device; only route progress is sent.');}}} aria-label={gps?'Disable device GPS':'Use device GPS'}><LocateFixed size={17}/></button></div><div className="input-connector"/><div className="destination-input"><MapPin size={18}/><div><label htmlFor="destination-search">GOING TO</label><input id="destination-search" value={searchOpen?search:selected.name} placeholder="Search 3 demo destinations" onFocus={()=>setSearchOpen(true)} onChange={e=>{setSearch(e.target.value);setSearchOpen(true);}} onKeyDown={e=>{if(e.key==='Escape')setSearchOpen(false);if(e.key==='Enter'){const result=destinations.find(d=>d.name.toLowerCase().includes(search.toLowerCase()));if(result)choose(result.id);}}} autoComplete="off"/></div><button className="icon-button" onClick={()=>setSearchOpen(!searchOpen)} aria-label="Show destinations"><ChevronDown size={17}/></button></div>
              {searchOpen&&<div className="search-results"><div className="search-caption">CURATED DEMO DESTINATIONS</div>{destinations.filter(d=>d.name.toLowerCase().includes(search.toLowerCase())).map(d=><button key={d.id} onClick={()=>choose(d.id)}><MapPin size={16}/><span><strong>{d.name}</strong><small>{d.address}</small></span>{destination===d.id&&<Check size={15}/>}</button>)}{!destinations.some(d=>d.name.toLowerCase().includes(search.toLowerCase()))&&<p>No demo destinations found.</p>}</div>}
            </div>
            <div className="route-summary"><div className="summary-top"><span className="recommended"><Sparkles size={13}/>THE CLEARER ROUTE</span><button className={`icon-button ${saved.includes(destination)?'active-icon':''}`} onClick={toggleSaved} aria-label={saved.includes(destination)?'Unsave destination':'Save destination'} aria-pressed={saved.includes(destination)}><Bookmark size={18} fill={saved.includes(destination)?'currentColor':'none'}/></button></div><div className="route-stats"><strong>{loading?'—':route?.durationMinutes || '—'}<span>min</span></strong><span className="stats-divider"/><span>{route?distanceLabel(route.distanceMeters):'—'}<small>via Market St & Embarcadero</small></span></div><div className="route-tags"><span><Layers3 size={13}/>{route?.geofences.length || 0} spatial previews</span><span><Leaf size={13}/>Light on your device</span></div></div>
            <button className="start-button" disabled={loading||!route} onClick={()=>{if(arrived)setProgress(0);setRunning(!running);}}>{loading?<LoaderCircle size={18} className="spin"/>:running?<Pause size={18} fill="currentColor"/>:<Navigation size={18}/>}<span>{loading?'Planning your route…':arrived?'Explore again':running?'Pause navigation':progress>0?'Resume navigation':'Start navigation'}</span><ArrowRight size={18}/></button>
            <div className="no-install"><ShieldCheck size={13}/>No camera. No downloads. Just go.</div>
            {error&&<div className="error-box" role="alert">{error}<button onClick={()=>setRetry(retry+1)}>Retry</button></div>}
            <div className="route-divider"/>
            <div className="up-next-title"><h3>Clarity, just ahead</h3><span>ON YOUR ROUTE</span></div>
            <div className="maneuver-list">{route?.geofences.map((zone,i)=><button key={zone.id} className={`maneuver ${active?.id===zone.id?'current':''} ${progress>=zone.endMeters?'passed':''}`} onClick={()=>previewZone(zone)}><span className="maneuver-icon">{progress>=zone.endMeters?<Check size={17}/>:i===route.geofences.length-1?<Flag size={17}/>:<ArrowUpRight size={20}/>}</span><span className="maneuver-copy"><strong>{zone.name}</strong><small>{zone.instruction}</small></span><span className="maneuver-distance">{progress>=zone.endMeters?'Passed':distanceLabel(Math.max(0,zone.startMeters-progress))}<ChevronRight size={13}/></span></button>)}</div>
            <div className="predictive-note"><span className="sparkle-box"><Sparkles size={17}/></span><p>A little foresight goes a long way.<br/><strong>3D scenes prepare 500 m before a turn.</strong></p></div>
          </section>

          <section className="map-panel" aria-label="Navigation workspace">
            <div className="map-panel-top"><div className="map-title"><span className="live-dot"/>{arrived?'You have arrived':running?'Your journey is in motion':'A new perspective on your route'}</div><div className="view-tabs" aria-label="Map view">{[['map','2D map'],['hybrid','Hybrid view'],['3d','3D preview']].map(([id,label])=><button key={id} className={effectiveView===id?'active':''} onClick={()=>{setView(id);setExpanded(false);if(active&&running)setAuto3d(false);}}>{id==='hybrid'&&<Layers3 size={13}/>} {label}</button>)}</div></div>
            <div className={`map-canvas view-${effectiveView}`}>
              <RouteMap route={route} progress={progress} onGeofence={previewZone} gpsPosition={gpsPosition}/>
              {effectiveView!=='map'&&<div className={`preview-container ${effectiveView==='3d'||expanded?'full-preview':''}`}><Windshield progress={progress} speed={speed} running={running} expanded={expanded} onExpand={()=>setExpanded(!expanded)} heading={heading} scenePack={scenePack} instruction={active?.instruction || upcoming?.instruction}/></div>}
              {effectiveView==='hybrid'&&!expanded&&<div className="preview-caption"><span className="mini-cube"><Layers3 size={14}/></span><span>Know what’s next.<strong>Before you get there.</strong></span><span className="preview-caption-tag">PROCEDURAL 3D</span></div>}
              {arrived&&<div className="arrival-card"><CheckCircle2 size={32}/><h3>You’re in the right place.</h3><p>Welcome to {selected.name}.</p><button className="button-outline" onClick={()=>{setProgress(0);setRunning(false);}}>Replay the journey <RotateCcw size={14}/></button></div>}
            </div>
            <div className="map-bottom-bar"><span><span className="live-dot"/>{gps?'DEVICE GPS': 'SIMULATION MODE'}</span><span><Cloud size={14}/>{socketStatus==='connected'?'Route service connected':'Local fallback active'}</span><button onClick={()=>setModal('about')}>Demo data <Info size={13}/></button></div>
          </section>
        </div>

        <section className="journey-bar" aria-label="Playback controls"><div className="journey-status"><span className={`journey-icon ${running?'moving':''}`}><Navigation2 size={21}/></span><div><strong>{arrived?'Journey complete':active?'Spatial preview active':running?'Taking the scenic (clearer) route.':'Your journey. At your pace.'}</strong><small>{arrived?'Explore another place or replay this route.':gps?'Matched to your device’s location':active?active.instruction:'Test the experience with live simulation controls.'}</small></div></div><div className="playback"><button className="play-button" disabled={!route} onClick={()=>{if(arrived)setProgress(0);setRunning(!running);}} aria-label={running?'Pause simulation':'Play simulation'}>{running?<Pause size={15} fill="currentColor"/>:<Play size={15} fill="currentColor"/>}</button><div className="playback-track"><div><span>{distanceLabel(progress)}</span><span>{distanceLabel(route?.distanceMeters||0)}</span></div><input type="range" min="0" max={route?.distanceMeters||1} value={progress} step="1" disabled={!route||gps} aria-label="Route progress" onChange={e=>setProgress(Number(e.target.value))} style={{'--progress':`${progress/(route?.distanceMeters||1)*100}%`}}/></div><button className="icon-button" onClick={()=>{setProgress(0);setRunning(false);setGps(false);}} aria-label="Reset journey"><RotateCcw size={16}/></button></div><div className="speed-control"><label htmlFor="speed"><Activity size={15}/>Speed <strong>{Math.round(speed)}<small>km/h</small></strong></label><input id="speed" type="range" min="0" max={mode==='walk'?12:100} step="1" value={Math.min(speed,mode==='walk'?12:100)} disabled={gps} onChange={e=>setSpeed(Number(e.target.value))}/></div><button className="icon-button volume-button" aria-label={sound?'Mute voice guidance':'Enable voice guidance'} onClick={()=>{if(!('speechSynthesis' in window)){setToast('Voice guidance is unavailable in this browser.');return;}setSound(!sound);}}>{sound?<Volume2 size={19}/>:<VolumeX size={19}/>}</button></section>

        {tab==='journey'&&<section className="journey-detail"><div><span className="eyebrow">ROUTE TELEMETRY</span><h2>{minutes} min · {distanceLabel(remaining)} remaining</h2><p>{next?`Next: ${next.name}`:'All preview zones complete.'}</p></div><div><span>Geofence state</span><strong>{serverEvent?.state||'clear'}</strong></div><div><span>Scene package</span><strong>{scenePack?'Ready':sceneError?'Unavailable':'Not needed yet'}</strong></div><div><span>Heading</span><strong>{heading==null?'No sensor':`${Math.round(heading)}°`}</strong></div></section>}
        <section className="benefits-row"><div><span className="benefit-icon"><Layers3 size={21}/></span><div><h3>Ahead of the curve.</h3><p>3D clarity at the turns that matter.</p></div></div><div><span className="benefit-icon"><Leaf size={21}/></span><div><h3>Big journeys. Small footprint.</h3><p>Designed without always-on camera processing.</p></div></div><div><span className="benefit-icon"><Globe2 size={21}/></span><div><h3>The open road. The open web.</h3><p>One link. Any modern browser. No install.</p></div></div></section>
        <footer className="page-footer"><span>A little more confidence. A whole new way to go.</span><button onClick={share}><Link size={13}/>Share this experience <ArrowUpRight size={13}/></button></footer>
        </>}
      </main>
    </div>
    {toast&&<div className="toast" role="status"><Info size={17}/><span>{toast}</span><button aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={16}/></button></div>}
    {modal&&<Modal onClose={()=>setModal(null)} title={modal==='settings'?'Make it your journey.':modal==='how'?'A little foresight. A lot of clarity.':'Built for a clearer way forward.'}>
      {modal==='live-settings'?<><p className="modal-intro">Live navigation controls are beside the route: enable device GPS, toggle automatic cloud preparation, choose an AI preview intent, and explicitly load Street View.</p><div className="honesty-card"><strong>Cost-conscious prototype limits</strong><p>100 searches, 30 routes, and 60 scene preparations per UTC day across this deployment. Street View lookups are limited to eight per route in the app. A ₹4,000 monthly gross-spend budget sends alerts, not a hard billing cutoff.</p><p>Route sessions expire in one hour. Cloud metadata is accessible for up to 24 hours. GPS requires permission and works only near the planned route.</p></div><p className="privacy-note"><a href="/privacy.html" target="_blank" rel="noreferrer">Read the privacy notice</a></p></>:modal==='settings'?<><p className="modal-intro">Your preferences are applied instantly for this session.</p><label className="setting-row"><span><strong>Predictive 3D transitions</strong><small>Automatically show a spatial preview inside a geofence.</small></span><input type="checkbox" checked={auto3d} onChange={e=>setAuto3d(e.target.checked)}/></label><label className="setting-row"><span><strong>Voice guidance</strong><small>Speak maneuver instructions using your browser.</small></span><input type="checkbox" checked={sound} onChange={e=>{if('speechSynthesis' in window)setSound(e.target.checked);else setToast('Voice guidance is not supported.');}}/></label><button className="settings-action" onClick={enableOrientation}><Compass size={19}/><span>Enable device orientation<small>Requires a supported mobile device and permission.</small></span><ChevronRight size={17}/></button><button className="settings-action" onClick={()=>{setGps(!gps);setModal(null);}}><LocateFixed size={19}/><span>{gps?'Disable GPS tracking':'Use device GPS'}<small>Works only near the San Francisco demo route.</small></span><ChevronRight size={17}/></button><p className="privacy-note"><ShieldCheck size={16}/>Coordinates stay in your browser. The service receives route ID, progress, and speed only.</p></>:modal==='how'?<><p className="modal-intro">Zero-friction, predictive 3D hyper-lapse navigation for the open web.</p>{[[Search,'01','Pick a place','Choose a curated San Francisco destination. The API returns a route with spatial geofences.'],[Sparkles,'02','See what’s coming','Scene metadata loads 500 meters before a complex turn, with live WebSocket geofence updates.'],[Navigation2,'03','Move at your own pace','Press play, adjust the speed, and watch the road-anchored arrows advance. Zero speed stops playback.']].map(([Icon,n,title,text])=><div className="how-step" key={n}><span><Icon size={21}/></span><div><small>STEP {n}</small><h3>{title}</h3><p>{text}</p></div></div>)}<button className="start-button" onClick={()=>{setModal(null);setRunning(true);}} disabled={!route}>Try the journey <ArrowRight size={17}/></button></>:<><span className="about-logo"><Navigation2 size={28}/>AeroNav<span> / VistaPath</span></span><p className="modal-intro">A working open-web prototype of predictive spatial navigation, built with React, Three.js, Node.js, and WebSockets.</p><div className="honesty-card"><strong><Info size={17}/>A prototype, with a clear distinction.</strong><p>In the Demo explorer, routes, map geometry, and 3D streets are illustrative. Live navigation separately provides real Google Maps routes and historical Street View panoramas. It is not suitable for driving or safety-critical navigation.</p><p>GPS, speed-matched playback, geofence events, scene metadata prefetch, and supported WebXR sessions are functional. Battery savings have not been measured.</p></div><h3 className="architecture-title">Architecture at a glance</h3><div className="architecture-flow"><span>React + Three.js</span><ArrowDown size={16}/><span>Node API + WebSockets · Cloud Run-ready</span><ArrowDown size={16}/><span>Procedural scenes + curated spatial data</span></div><p className="privacy-note">The separate Live navigation workspace connects Google Routes, Places, Street View, Pub/Sub, BigQuery GIS, Vertex AI / Gemini, Earth Engine, and private Cloud Storage. This demo workspace remains procedural. AI anchors are not calibrated to Street View pixels or road lanes.</p></>}
    </Modal>}
  </div>;
}

function Modal({ children, title, onClose }) {
  const ref=useRef(null);
  useEffect(()=>{const previous=document.activeElement;ref.current?.focus();const trap=e=>{if(e.key!=='Tab')return;const nodes=ref.current.querySelectorAll('button, input, a[href], [tabindex="0"]');const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};const element=ref.current;element.addEventListener('keydown',trap);return()=>{element.removeEventListener('keydown',trap);previous?.focus();};},[]);
  return <div className="modal-backdrop" onClick={onClose}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex="-1" ref={ref} onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" onClick={onClose} aria-label="Close dialog"><X size={21}/></button><div className="eyebrow">AERONAV / A NEW PERSPECTIVE</div><h2 id="modal-title">{title}</h2>{children}</section></div>;
}
