import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Maximize2, Glasses, MoveUpRight } from 'lucide-react';

export default function Windshield({ progress, speed, running, expanded, onExpand, heading, scenePack, instruction }) {
  const mount = useRef(null);
  const engine = useRef(null);
  const state = useRef({ progress, heading, scenePack });
  const [xr, setXr] = useState(false);
  const [error, setError] = useState('');
  state.current = { progress, heading, scenePack };

  useEffect(() => {
    const host = mount.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }); }
    catch { setError('3D graphics are unavailable. The 2D route remains usable.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor('#b9cfce');
    renderer.xr.enabled = true;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#bccfca', 40, 190);
    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 350);
    camera.position.set(1.8, 2.3, 8);
    const ambient = new THREE.HemisphereLight('#fff8e7', '#677760', 2.6);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight('#fff3d0', 2.3);
    sun.position.set(-30, 60, 20); scene.add(sun);
    const box = (w, h, d, color, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
      mesh.position.set(x, y, z); scene.add(mesh); return mesh;
    };
    box(240, .2, 420, '#9dad8c', 0, -.3, -150);
    box(15, .15, 420, '#697571', 0, -.1, -150);
    [-1, 1].forEach(side => {
      box(3.5, .25, 420, '#c9ccbf', side * 9.2, .01, -150);
      box(.12, .04, 420, '#e7e4cc', side * 6.8, .02, -150);
    });
    const world = new THREE.Group(); scene.add(world);
    const colors = ['#c5c5b4', '#d1ccba', '#a2b4ad', '#d6d0bd', '#9dafa7'];
    for (let i = 0; i < 24; i++) {
      const z = 30 - i * 15;
      [-1, 1].forEach(side => {
        const height = 12 + ((i * 13 + (side + 1) * 7) % 29);
        const building = box(11, height, 12, colors[i % colors.length], side * 17, height / 2, z);
        world.attach(building);
        for (let row = 0; row < Math.floor(height / 3) - 1; row++) {
          for (let col = 0; col < 3; col++) {
            const pane = box(.03, 1.5, 1.8, '#6e8983', side * 11.48, 3 + row * 3, z - 3.5 + col * 3.5);
            world.attach(pane);
          }
        }
        const trunk = box(.28, 3.6, .28, '#727c60', side * 9.4, 1.8, z + 5);
        world.attach(trunk);
        const tree = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), new THREE.MeshStandardMaterial({ color: i % 2 ? '#728f67' : '#88a577' }));
        tree.position.set(side * 9.4, 4.4, z + 5); world.add(tree);
      });
      [-2.4, 2.4].forEach(x => {
        const stripe = box(.1, .03, 5, '#e8e6d8', x, .02, z); world.attach(stripe);
      });
    }
    const vectors = new THREE.Group(); scene.add(vectors);
    for (let i = 0; i < 8; i++) {
      const shape = new THREE.Shape();
      shape.moveTo(-1.1, 0); shape.lineTo(0, 1.25); shape.lineTo(1.1, 0); shape.lineTo(.7, -.4); shape.lineTo(0, .4); shape.lineTo(-.7, -.4); shape.closePath();
      const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#daff8b', side: THREE.DoubleSide, transparent: true, opacity: 1 - i * .065 }));
      arrow.rotation.x = -Math.PI / 2;
      arrow.position.set(0, .08, -i * 7); vectors.add(arrow);
    }
    const lane = box(2.2, .012, 74, '#9fb88b', 0, .028, -29);
    lane.material.transparent = true; lane.material.opacity = .28;
    let lastFrame = 0, lastState = '', dirty = true;
    let yaw = 0, dragging = false, lastX = 0, disposed = false;
    const down = e => { dragging = true; lastX = e.clientX; host.setPointerCapture(e.pointerId); };
    const move = e => { if (dragging) { yaw = Math.max(-.6, Math.min(.6, yaw + (e.clientX - lastX) * .003)); lastX = e.clientX; } };
    const up = () => { dragging = false; };
    host.addEventListener('pointerdown', down); host.addEventListener('pointermove', move); host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
    const observer = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      renderer.setSize(width, height); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); dirty = true;
    }); observer.observe(host);
    renderer.setAnimationLoop(time => {
      const current = state.current;
      const signature = `${current.progress}|${current.heading}|${current.scenePack?.id}|${yaw}`;
      if (!renderer.xr.isPresenting && ((!dirty && signature === lastState) || time - lastFrame < 33)) return;
      lastFrame = time; lastState = signature; dirty = false;
      world.position.z = current.progress % 15;
      const anchor = current.scenePack?.anchors.find(item => item.kind === 'arrow');
      vectors.position.set(anchor?.position[0] || 0, anchor ? Math.max(0, anchor.position[1] - .08) : 0, current.progress % 7);
      vectors.rotation.y = -THREE.MathUtils.degToRad(anchor?.headingDegrees || 0);
      const bearing = current.heading == null ? 0 : THREE.MathUtils.degToRad(((current.heading + 180) % 360) - 180) * .08;
      camera.lookAt(Math.sin(yaw + bearing) * 35, 2.6, -45);
      renderer.render(scene, camera);
    });
    engine.current = renderer;
    if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then(supported => { if (!disposed) setXr(supported); }).catch(() => {});
    return () => {
      disposed = true; observer.disconnect(); renderer.setAnimationLoop(null);
      renderer.xr.getSession()?.end().catch(() => {});
      host.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', move); host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up);
      scene.traverse(object => { object.geometry?.dispose(); if (object.material) object.material.dispose(); });
      renderer.dispose(); renderer.domElement.remove(); engine.current = null;
    };
  }, []);

  async function enterXR() {
    try { const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] }); await engine.current.xr.setSession(session); }
    catch { setError('XR session could not start. Continue in the browser view.'); }
  }

  return <div className={`windshield ${expanded ? 'expanded' : ''}`}>
    <div className="three-host" ref={mount} role="img" aria-label="Interactive procedural 3D street preview with road-anchored navigation arrows" />
    <div className="scene-top"><span className="scene-badge"><span className="live-dot" />3D SPATIAL PREVIEW</span><button className="glass-icon" onClick={onExpand} aria-label={expanded ? 'Collapse 3D view' : 'Expand 3D view'}><Maximize2 size={16}/></button></div>
    <div className="scene-direction"><MoveUpRight size={24}/><div>{instruction || 'Follow the highlighted route'}<small>Illustrative street · not real-world guidance</small></div></div>
    <div className="scene-bottom"><span className="scene-speed">{Math.round(speed)}<small>km/h</small></span><span className="scene-sync"><span className="live-dot"/>{running && speed > 0 ? 'Velocity synced' : 'Playback paused'}<small>{scenePack ? 'Scene pack ready' : 'Procedural demo scene'}</small></span>{xr && <button className="glass-icon" aria-label="Enter immersive XR" onClick={enterXR}><Glasses size={19}/></button>}</div>
    {error && <div className="scene-error" role="alert">{error}</div>}
  </div>;
}
