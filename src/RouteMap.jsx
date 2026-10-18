import { useMemo, useState } from 'react';
import { Crosshair, Layers, Minus, Plus, Navigation2 } from 'lucide-react';

const project = ([lon, lat]) => [100 + (lon + 122.435) / .055 * 900, 740 - (lat - 37.773) / .04 * 720];

export default function RouteMap({ route, progress, onGeofence, gpsPosition }) {
  const [zoom, setZoom] = useState(1);
  const [satellite, setSatellite] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(null);
  const points = useMemo(() => (route?.coordinates || [[-122.4194,37.7749],[-122.414,37.779],[-122.407,37.784],[-122.399,37.791],[-122.3937,37.7955]]).map(project), [route]);
  const lengths = points.slice(1).map((p,i) => Math.hypot(p[0]-points[i][0], p[1]-points[i][1]));
  const total = lengths.reduce((a,b) => a+b,0);
  function along(fraction) {
    let remaining = total * fraction;
    for (let i=0; i<lengths.length; i++) {
      if (remaining <= lengths[i]) { const t = remaining / (lengths[i] || 1); return [points[i][0]+(points[i+1][0]-points[i][0])*t, points[i][1]+(points[i+1][1]-points[i][1])*t]; }
      remaining -= lengths[i];
    }
    return points.at(-1);
  }
  const current = along(route ? progress / route.distanceMeters : 0);
  const end = points.at(-1);
  const path = points.map(p=>p.join(',')).join(' ');
  const bounds = { left: Math.min(0, ...points.map(p => p[0] - 65)), right: Math.max(1100, ...points.map(p => p[0] + 180)), top: Math.min(0, ...points.map(p => p[1] - 65)), bottom: Math.max(790, ...points.map(p => p[1] + 65)) };
  const fit = Math.min(1100 / (bounds.right - bounds.left), 790 / (bounds.bottom - bounds.top));
  const center = [(bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2];
  return <div className={`route-map ${satellite ? 'terrain' : ''}`}>
    <svg viewBox="0 0 1100 790" className="map-svg" aria-label="Schematic San Francisco demo route map" onPointerDown={e=>{setDrag({x:e.clientX-pan.x,y:e.clientY-pan.y});e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag) setPan({x:e.clientX-drag.x,y:e.clientY-drag.y});}} onPointerUp={()=>setDrag(null)} onPointerCancel={()=>setDrag(null)}>
      <defs><pattern id="blocks" width="78" height="64" patternUnits="userSpaceOnUse" patternTransform="rotate(-36)"><rect width="78" height="64" fill="var(--map-land)"/><rect x="5" y="5" width="65" height="51" rx="3" fill="var(--map-block)"/><path d="M0 0H78M0 0V64" stroke="#fff" strokeWidth="5"/><rect x="10" y="10" width="23" height="16" rx="2" fill="var(--map-building)"/><rect x="38" y="10" width="27" height="40" rx="2" fill="var(--map-building)"/><rect x="10" y="31" width="23" height="19" rx="2" fill="var(--map-building)"/></pattern><filter id="pinshadow"><feDropShadow dx="0" dy="3" stdDeviation="5" floodOpacity=".17"/></filter></defs>
      <rect width="1100" height="790" fill="var(--map-water)"/>
      <g transform={`translate(${550+pan.x} ${395+pan.y}) scale(${zoom * fit}) translate(${-center[0]} ${-center[1]})`}>
        <path d="M-600-600H645L650 65 690 140 750 215 785 278 807 350 871 453 970 580 1250 780V1300H-600Z" fill="url(#blocks)"/>
        <path d="M643 -30 655 65 693 142 753 217 789 278 811 350 875 453 974 580 1240 780" fill="none" stroke="#fdfef9" strokeWidth="15"/>
        <path d="M643 -30 655 65 693 142 753 217 789 278 811 350 875 453 974 580 1240 780" fill="none" stroke="#d4d5c7" strokeWidth="2"/>
        {[0,1,2,3,4,5].map(i=><g key={i} transform={`translate(${672+i*30} ${105+i*53}) rotate(-34)`}><rect width="130" height="24" rx="2" fill="#d8d8c9" stroke="#f9faf5" strokeWidth="5"/><path d="M10 12H120" stroke="#bbbfae" strokeWidth="1"/></g>)}
        <path d="M-100 745 750 116" stroke="#fff" strokeWidth="23" fill="none"/><path d="M-100 745 750 116" stroke="#e4dfbe" strokeWidth="9" fill="none"/>
        <path d="M-50 335 430 690 1110 195" stroke="#fff" strokeWidth="16" fill="none"/><path d="M-50 335 430 690 1110 195" stroke="#e7e2c7" strokeWidth="5" fill="none"/>
        <path d="M172 64 230 22 307 82 246 128Z" fill="#ccdbb7" stroke="#fff" strokeWidth="6"/>
        <path d="M341 182 390 145 437 180 383 221Z" fill="#c6d8b4" stroke="#fff" strokeWidth="5"/>
        <path d="M328 518 408 460 459 499 379 558Z" fill="#c8dab8" stroke="#fff" strokeWidth="6"/>
        <path d="M530 381 573 351 631 393 588 425Z" fill="#c7d8b4" stroke="#fff" strokeWidth="5"/>
        <g className="map-neighborhood"><text x="164" y="245">RUSSIAN HILL</text><text x="334" y="315">NOB HILL</text><text x="446" y="150">NORTH BEACH</text><text x="517" y="264">CHINATOWN</text><text x="600" y="355">FINANCIAL</text><text x="614" y="373">DISTRICT</text><text x="240" y="542">TENDERLOIN</text><text x="518" y="641">SOUTH OF MARKET</text><text x="51" y="439">POLK GULCH</text></g>
        <g className="map-street"><text x="393" y="405" transform="rotate(-36 393 405)">California Street</text><text x="414" y="539" transform="rotate(-36 414 539)">Market Street</text><text x="731" y="332" transform="rotate(54 731 332)">The Embarcadero</text><text x="372" y="145" transform="rotate(36 372 145)">Columbus Avenue</text><text x="159" y="372" transform="rotate(36 159 372)">Broadway</text><text x="522" y="70">Bay Street</text></g>
        <text x="901" y="252" className="water-label" transform="rotate(-65 901 252)">San Francisco Bay</text>
        <g fill="#809876" className="map-poi"><circle cx="383" cy="185" r="4"/><text x="395" y="190">Washington Square</text><circle cx="368" cy="504" r="4"/><text x="314" y="575">Union Square</text><circle cx="237" cy="77" r="4"/></g>
        <polyline points={path} stroke="#fff" strokeWidth="13" fill="none" strokeLinejoin="round" strokeLinecap="round"/><polyline points={path} stroke="#385e4b" strokeWidth="7" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
        {route?.geofences.map((zone,i)=>{const p=along(zone.startMeters/route.distanceMeters); const active=progress>=zone.startMeters&&progress<zone.endMeters;return <g key={zone.id} onClick={e=>{e.stopPropagation();onGeofence(zone);}} className="geofence-pin" role="button" tabIndex="0" aria-label={`Preview ${zone.name}`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onGeofence(zone);}}}><circle cx={p[0]} cy={p[1]} r="44" fill={active?'#badb7880':'#c1d49735'} stroke="#88a96a" strokeWidth="1.5" strokeDasharray="5 5"/><circle cx={p[0]} cy={p[1]} r="13" fill="#e4efc9" stroke="#5a7949" strokeWidth="2"/><text x={p[0]} y={p[1]+4} textAnchor="middle" fill="#405f37" fontSize="11" fontWeight="700">{i+1}</text></g>;})}
        <g transform={`translate(${end[0]},${end[1]})`} filter="url(#pinshadow)"><path d="M0 5C-5-7-17-14-17-25a17 17 0 1 1 34 0C17-14 5-7 0 5" fill="#2d513f"/><circle cy="-25" r="6" fill="#e1f2be"/><rect x="23" y="-48" width="156" height="43" rx="8" fill="#fff"/><text x="35" y="-29" fontSize="12" fill="#253f31" fontWeight="600">{route?.name || 'Ferry Building'}</text><text x="35" y="-14" fontSize="9" fill="#8a9388">YOUR DESTINATION</text></g>
        <g transform={`translate(${current[0]},${current[1]})`} filter="url(#pinshadow)"><circle r="28" fill="#b1cf8a60"/><circle r="17" fill="#fff"/><circle r="13" fill="#315941"/><path d="M0-8 7 7 0 3-7 7Z" fill="#e5f7bc"/></g>
        {gpsPosition&&<g transform={`translate(${project(gpsPosition)[0]},${project(gpsPosition)[1]})`}><circle r="17" fill="#67a8e055"/><circle r="7" fill="#3781c5" stroke="#fff" strokeWidth="3"/></g>}
      </g>
    </svg>
    <div className="map-city"><span className="live-dot"/>San Francisco, CA <span className="map-city-divider"/> Schematic demo map</div>
    <button className="map-layers" onClick={()=>setSatellite(!satellite)} aria-pressed={satellite}><Layers size={16}/>{satellite?'Light map':'Terrain'}</button>
    <div className="map-tools"><button onClick={()=>setZoom(Math.min(2.5,zoom+.25))} aria-label="Zoom in"><Plus size={18}/></button><button onClick={()=>setZoom(Math.max(.65,zoom-.25))} aria-label="Zoom out"><Minus size={18}/></button><span/><button onClick={()=>{setZoom(1);setPan({x:0,y:0});}} aria-label="Recenter map"><Crosshair size={18}/></button></div>
    <div className="map-compass"><Navigation2 size={19}/><span>N</span></div>
    <div className="map-credit">AeroNav original map · Illustrative, not for road use</div>
  </div>;
}
