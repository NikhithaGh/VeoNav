import React, { useEffect, useRef, useState } from 'react';
import { advanceProgress, clampProgress, positionAt, forwardTime, validatePuneRoute } from './pune-navigation';
import { loadMaps } from './GoogleViewport';
import { Navigation, Globe2, Compass, MapPin, Play, Pause, RotateCcw, Leaf, Route as RouteIcon } from 'lucide-react';
import './pune-v2.css';

function Preview({ route, progress }) {
  const video = useRef(null);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (ready && video.current) video.current.currentTime = forwardTime(route, progress);
  }, [progress, route, ready]);
  return <><video ref={video} src={route.forward.src} muted playsInline preload="auto" aria-label="Forward-only Pune road preview"
    onLoadedMetadata={() => setReady(true)} onError={() => setError('Preview unavailable. Reload to retry.')} />
    {!ready && !error && <p role="status">Loading preview…</p>}{error && <p role="alert">{error}</p>}</>;
}
function PuneMap({ route, progress }) {
  const host = useRef(null), objects = useRef(null), latest = useRef(progress);
  latest.current = progress;
  const [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/live/config').then(r => { if (!r.ok) throw new Error('Map configuration unavailable'); return r.json(); })
      .then(config => { if (!config.mapsBrowserKey) throw new Error('Google Maps is not configured'); return loadMaps(config.mapsBrowserKey); })
      .then(maps => {
        if (cancelled) return;
        const path = route.points.map(p => ({ lng: p.coordinates[0], lat: p.coordinates[1] }));
        const map = new maps.Map(host.current, { center: path[0], zoom: 16, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: 'cooperative', zoomControlOptions: { position: maps.ControlPosition.LEFT_BOTTOM } });
        const line = new maps.Polyline({ map, path, strokeColor: '#345b43', strokeWeight: 6 });
        const [lng, lat] = positionAt(route.points, latest.current);
        const marker = new maps.Marker({ map, position: { lng, lat }, title: 'Simulated position', icon: { path: maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, fillColor: '#345b43', fillOpacity: 1, strokeColor: 'white', strokeWeight: 2 } });
        const end = new maps.Marker({ map, position: path.at(-1), title: 'End of recorded track' });
        const bounds = new maps.LatLngBounds(); path.forEach(p => bounds.extend(p)); map.fitBounds(bounds, 65);
        objects.current = { marker, end, line, map, maps }; setLoaded(true);
      }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; const o = objects.current; if (o) { o.marker.setMap(null); o.end.setMap(null); o.line.setMap(null); o.maps.event.clearInstanceListeners(o.map); } objects.current = null; };
  }, [route]);
  useEffect(() => {
    const o = objects.current;
    if (o) {
      const [lng, lat] = positionAt(route.points, progress);
      o.marker.setPosition({ lng, lat });
      const next = positionAt(route.points, Math.min(progress + 2, route.distanceMeters));
      const heading = Math.atan2((next[0] - lng) * Math.cos(lat * Math.PI / 180), next[1] - lat) * 180 / Math.PI;
      o.marker.setIcon({ ...o.marker.getIcon(), rotation: heading });
    }
  }, [progress, route]);
  return <><div className="pv-map-host" ref={host} aria-label="Google Map of recorded Pune track" />{error ? <div className="pv-map-message" role="alert">{error}. The preview and simulation still work.</div> : !loaded && <div className="pv-map-message" role="status">Loading Google Maps…</div>}</>;
}
export default function PuneV2({ embedded = false }) {
  const [route, setRoute] = useState(null), [error, setError] = useState('');
  const [progress, setProgress] = useState(0), [playing, setPlaying] = useState(false), [started, setStarted] = useState(false), [mapShown, setMapShown] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/v2-pune/route.json', { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Pune route is unavailable');
      return response.json();
    }).then(validatePuneRoute).then(setRoute).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!playing || !route) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min((now - previous) / 1000, 0.5);
      previous = now;
      setProgress(value => advanceProgress(value, elapsed, route.speedMetersPerSecond, route.distanceMeters));
    }, 33);
    return () => clearInterval(timer);
  }, [playing, route]);
  useEffect(() => { if (route && progress >= route.distanceMeters) setPlaying(false); }, [progress, route]);
  const ended = route && progress >= route.distanceMeters;
  const play = () => { if (ended) setProgress(0); setStarted(true); setPlaying(!playing); };
  return <div className={`pune-v2 ${embedded ? 'pv-embedded' : ''}`}>
    {embedded && <><section className="page-heading"><div><div className="eyebrow"><span/>CONNECTED TO THE REAL WORLD</div><h1>A real route. A clearer perspective.</h1><p>Explore a recorded Pune route on Google Maps, with a forward-facing video preview.</p></div></section><div className="pv-demo-banner" role="note">Demo only — video previews are available only for this recorded Pune route.</div></>}
    {!embedded && <aside className="pv-sidebar"><a className="pv-brand" href="/"><Navigation fill="currentColor" /> AeroNav.</a><small>YOUR NEXT CHAPTER, CLOSER</small>
      <nav><a className="active" href="/"><Globe2 size={19} />Pune navigation <span>•</span></a><a href="/old"><Compass size={19} />Original workspace</a></nav>
      <div className="pv-difference"><small>THE AERONAV DIFFERENCE</small><p>See the road. Before you reach it.</p><p>Forward only. No repeated locations.</p><p>Just a link. No downloads.</p></div>
      <div className="pv-leaf"><Leaf /><h3>A lighter way to go.</h3><p>Built for the journey.<br />A recorded Pune experience.</p><small>V2 · HISTORICAL DEMO</small></div>
    </aside>}
    {error ? <section role="alert"><h2>Unable to load the demo</h2><p>{error}</p><button onClick={() => location.reload()}>Retry</button></section>
      : !route ? <p role="status">Loading Pune route…</p> : <div className="pv-workspace">
        <aside className="pv-route-panel"><h2>Where are you headed?</h2><p>Your Pune route is ready. Show it on Google Maps, then simulate the journey.</p>
          <label>STARTING FROM</label><div className="pv-field"><MapPin size={17} />Pune · recorded start</div>
          <label>DESTINATION</label><div className="pv-field"><MapPin size={17} />Pune · recorded end</div>
          <div className="pv-mode">Recorded track · simulation</div><button className="pv-primary" onClick={() => setMapShown(true)}><Navigation size={17} />{mapShown ? 'Route shown on Google Maps' : 'Show route on Google Maps'}</button><button className="pv-simulate" disabled={!mapShown} onClick={play}>{playing ? <Pause size={17} /> : <Play size={17} />}{playing ? 'Pause simulation' : ended ? 'Replay simulation' : 'Simulate'}</button>
          <div className="pv-distance"><strong>{(route.distanceMeters / 1000).toFixed(2)} <small>km</small></strong><span>40 panoramas<br />Forward-facing preview</span></div>
          <h3>Recorded journey</h3>{['Start in Pune', 'Follow the recorded street', 'End of available footage'].map((label, i) => <div className="pv-step" key={label}><span>{i + 1}</span><div>{label}<small>{Math.round(i * route.distanceMeters / 2)} m along track</small></div></div>)}
          <p className="pv-note">This line is a recorded GPS track, not a Google-calculated route. No verified turn or flyover instructions.</p>
        </aside>
        <div className="pv-main">{!mapShown ? <section className="pv-placeholder"><Globe2 size={50}/><h2>The world is ready when you are.</h2><p>Your recorded Pune route is selected.<br/>Show the route on Google Maps, then click Simulate to see the road ahead.</p><small>Google Maps · Panoramax imagery · Pune demo</small></section> : <><section className="pv-map-card"><header><span><Globe2 size={15} />Google Maps · recorded Pune track</span><span className="pv-badge">V2 / PUNE</span></header>
          <div className="pv-map-wrap"><PuneMap route={route} progress={progress} />
            {started && <div className="pv-preview"><div className="pv-preview-title"><Navigation size={15} /><strong>{ended ? 'End of recorded track' : 'Your road ahead'}</strong><span>{playing ? 'PLAYING' : 'PAUSED'}</span></div><Preview route={route} progress={progress} /><div className="pv-preview-caption">{ended ? 'Preview complete — no automatic replay' : `${Math.round(Math.min(progress + route.lookAheadMeters, route.distanceMeters))} m along track · forward only`}</div></div>}
          </div><div className="pv-map-footer">Historical Panoramax imagery · {route.captureDate} · {started ? 'Preview follows simulated progress' : 'Press Play to open the preview'}</div>
        </section>
        <section className="pv-controls"><h3><Navigation size={18} />{ended ? 'You reached the end of the recorded track' : 'Continue along the recorded Pune street'}</h3><p>Simulation · not real-time driving guidance</p>
          <div className="pv-control-row"><button aria-label={playing ? 'Pause' : 'Play'} onClick={play}>{playing ? <Pause size={18} /> : <Play size={18} />}</button><div className="pv-slider"><label htmlFor="pune-progress">{Math.round(progress)} m / {Math.round(route.distanceMeters)} m</label><input id="pune-progress" aria-label="Route progress" type="range" min="0" max={route.distanceMeters} step="any" value={progress} onChange={e => setProgress(clampProgress(Number(e.target.value), route.distanceMeters))} /></div><span>{Math.round(route.speedMetersPerSecond * 3.6)} km/h</span><button aria-label="Reset journey" onClick={() => { setPlaying(false); setProgress(0); setStarted(false); }}><RotateCcw size={18} /></button></div>
          <p role="status">{ended ? 'Stopped at route end. Replay only when you choose.' : playing ? 'Moving forward — past footage is not replayed.' : 'Paused. Dragging the slider deliberately changes your location.'}</p>
        </section>
        </>}
        <section className="pv-about"><h3><RouteIcon size={18} />Your next preview, already on the route.</h3><p>Historical photos blended into a forward-facing preview. No loop reset, reverse motion, or generated road details. The final view holds when no further imagery exists.</p><p>{route.creator} / Panoramax · {route.license} · perspective cropped and animated.</p><a href="/v2-pune/credits.json" target="_blank" rel="noreferrer">Image sources &amp; attribution</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">License</a></section>
        </div>
      </div>}
  </div>;
}
