import { useEffect, useRef, useState } from 'react';
import { Globe2, Map, Navigation2, Camera, X } from 'lucide-react';
import { distance } from './navigation';

let mapsPromise;
export function loadMaps(key) {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    let timer;
    const fail = () => { clearTimeout(timer); mapsPromise = null; reject(new Error('Google Maps could not load. Check the restricted browser key, billing, and connectivity.')); };
    window.aeronavMapsReady = () => { clearTimeout(timer); resolve(window.google.maps); };
    window.gm_authFailure = fail;
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=aeronavMapsReady`;
    script.async = true; script.onerror = fail; timer = setTimeout(fail, 20000); document.head.appendChild(script);
  });
  return mapsPromise;
}

export function pointAlong(route, progress) {
  const points = route?.coordinates;
  if (!points?.length) return null;
  const lengths = points.slice(1).map((point, i) => distance(points[i], point));
  const total = lengths.reduce((sum, item) => sum + item, 0);
  let offset = total * Math.min(1, Math.max(0, progress / route.distanceMeters));
  for (let i = 0; i < lengths.length; i++) {
    if (offset <= lengths[i] || i === lengths.length - 1) {
      const t = Math.max(0, Math.min(1, offset / (lengths[i] || 1)));
      const a = points[i], b = points[i + 1];
      return { lat: a[1] + (b[1] - a[1]) * t, lng: a[0] + (b[0] - a[0]) * t, heading: (Math.atan2((b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI + 360) % 360 };
    }
    offset -= lengths[i];
  }
  return { lng: points[0][0], lat: points[0][1], heading: 0 };
}

export default function GoogleViewport({ apiKey, route, progress, showStreet, onStreetChange }) {
  const mapHost = useRef(null), panoramaHost = useRef(null), objects = useRef(null);
  const latest = useRef({ progress, route }); latest.current = { progress, route };
  const [error, setError] = useState('');
  const [imagery, setImagery] = useState('Street View is off. Load it to see available real imagery.');
  const [requests, setRequests] = useState(0);
  const position = pointAlong(route, progress);
  useEffect(() => {
    let cancelled = false;
    setError(''); setRequests(0);
    loadMaps(apiKey).then(maps => {
      if (cancelled) return;
      const map = new maps.Map(mapHost.current, { center: { lng: route.coordinates[0][0], lat: route.coordinates[0][1] }, zoom: 14, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, gestureHandling: 'cooperative' });
      const path = route.coordinates.map(([lng, lat]) => ({ lng, lat }));
      const line = new maps.Polyline({ map, path, strokeColor: '#315941', strokeOpacity: .9, strokeWeight: 6 });
      const bounds = new maps.LatLngBounds(); path.forEach(p => bounds.extend(p)); map.fitBounds(bounds, 55);
      const marker = new maps.Marker({ map, position: path[0], title: 'Route progress', icon: { path: maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 5, fillColor: '#34583e', fillOpacity: 1, strokeWeight: 2, strokeColor: '#ffffff' } });
      const destination = new maps.Marker({ map, position: path.at(-1), title: 'Destination' });
      objects.current = { maps, map, line, marker, destination, panorama: null, service: new maps.StreetViewService(), count: 0, lastProgress: -Infinity, lastRequest: 0, requestId: 0 };
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => {
      cancelled = true;
      const current = objects.current;
      if (current) { current.requestId++; current.line.setMap(null); current.marker.setMap(null); current.destination.setMap(null); current.panorama?.setVisible(false); current.maps.event.clearInstanceListeners(current.map); if (current.panorama) current.maps.event.clearInstanceListeners(current.panorama); }
      objects.current = null;
    };
  }, [apiKey, route.id]);

  useEffect(() => {
    const tick = () => {
      const o = objects.current;
      if (!o) return;
      const p = pointAlong(latest.current.route, latest.current.progress);
      o.marker.setPosition(p);
      if (!showStreet) { o.panorama?.setVisible(false); return; }
      if (!o.panorama) o.panorama = new o.maps.StreetViewPanorama(panoramaHost.current, { visible: false, addressControl: true, fullscreenControl: true, motionTracking: false, motionTrackingControl: false });
      else if (o.hasImagery) o.panorama.setVisible(true);
      if (o.count >= 8) { setImagery('Route imagery request limit reached (8). Last available panorama remains visible.'); return; }
      if (Math.abs(latest.current.progress - o.lastProgress) < 100 || Date.now() - o.lastRequest < 8000) return;
      o.lastProgress = latest.current.progress; o.lastRequest = Date.now(); o.count++; setRequests(o.count);
      const requestId = ++o.requestId;
      setImagery('Finding real Street View imagery near the route…');
      o.service.getPanorama({ location: p, radius: 80, preference: o.maps.StreetViewPreference.NEAREST, sources: [o.maps.StreetViewSource.OUTDOOR] }, (data, status) => {
        if (objects.current !== o || requestId !== o.requestId) return;
        if (status !== o.maps.StreetViewStatus.OK || !data?.location?.pano) { o.hasImagery = false; o.panorama.setVisible(false); setImagery('No outdoor panorama at this position. The Google route map remains available.'); return; }
        o.panorama.setPano(data.location.pano); o.panorama.setPov({ heading: p.heading, pitch: 0 }); o.panorama.setVisible(true); o.hasImagery = true;
        setImagery(`Real Google Street View${data.imageDate ? ` · captured ${data.imageDate}` : ''}. Historical imagery, not a live camera.`);
      });
    };
    tick(); const timer = setInterval(tick, 1000);
    return () => { clearInterval(timer); if (objects.current) objects.current.requestId++; };
  }, [showStreet, route.id]);
  useEffect(() => { if (position && objects.current) objects.current.marker.setPosition(position); }, [progress]);

  return <section className="google-workspace">
    <div className="google-toolbar"><span><Globe2 size={16}/>Google Maps · real route</span><button className="button-outline" onClick={() => onStreetChange(!showStreet)}>{showStreet ? <X size={14}/> : <Camera size={14}/>} {showStreet ? 'Close Street View' : 'Load real Street View'}</button></div>
    <div className={`google-viewports ${showStreet ? 'with-street' : ''}`}><div ref={mapHost} className="google-map-host" aria-label="Google Maps real route"/>
      <div className="google-panorama-wrap" hidden={!showStreet}><div className="google-panorama-host" ref={panoramaHost} aria-label="Real Google Street View panorama"/></div>
      {error && <div className="google-error" role="alert">{error}</div>}
    </div>
    <div className="imagery-status"><Camera size={14}/><span>{imagery}</span><small>{requests}/8 lookups</small></div>
  </section>;
}
