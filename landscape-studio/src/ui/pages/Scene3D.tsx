import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Material, Project, SiteObject } from '../../core/types.ts';
import { GEOM } from '../../core/types.ts';
import { bbox, centroid, dist, pointInPolygon } from '../../core/geometry.ts';
import { materialColour } from '../../core/iso.ts';
import { STYLE } from '../../core/style.ts';

// Interactive 3D model built from the plan geometry: plan x → X, plan y → Z, height → Y (metres).
// Ground is flat because levels are not surveyed. Building and fence heights are display assumptions.

export const MODEL_LABEL = 'Conceptual 3D model from the plan - not structural design. Ground shown flat; levels not modelled.';

const SURFACE_H: Partial<Record<SiteObject['type'], number>> = { paving: 0.06, turf: 0.03, gravel: 0.04, garden: 0.18, feature: 0.04, steps: 0.3, building: 2.7 };

function shapeOf(o: SiteObject) {
  const s = new THREE.Shape();
  o.points.forEach((p, i) => (i ? s.lineTo(p.x, p.y) : s.moveTo(p.x, p.y)));
  s.closePath();
  return s;
}

/** Extrude a plan polygon upward from y0 to y0 + h. */
function slab(o: SiteObject, h: number, y0: number, mat: THREE.Material) {
  const g = new THREE.ExtrudeGeometry(shapeOf(o), { depth: h, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // shape XY → XZ, extrude along −Y
  g.translate(0, y0 + h, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = h > 0.1; m.receiveShadow = true;
  return m;
}

function buildScene(project: Project, materials: Material[]) {
  const group = new THREE.Group();
  const objs = project.objects.filter(o => !o.hidden);
  const all = objs.flatMap(o => o.points);
  const b = all.length ? bbox(all) : { minX: 0, minY: 0, maxX: 10, maxY: 10, w: 10, h: 10 };
  const std = (hex: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0, ...extra });
  // ground
  const pad = 4;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(b.w + 2 * pad, b.h + 2 * pad), std('#dfe5d6'));
  ground.rotation.x = -Math.PI / 2; ground.position.set(b.minX + b.w / 2, -0.001, b.minY + b.h / 2); ground.receiveShadow = true;
  group.add(ground);
  const colour = (o: SiteObject) => (o.layer === 'proposed' ? materialColour(o, materials) : STYLE[o.type].fill ?? '#cccccc');
  for (const o of objs) {
    const g = GEOM[o.type];
    if (g === 'area' && o.points.length >= 3) {
      if (o.type === 'pergola') {
        const h = Number(o.props.height) || 2.7, bb = bbox(o.points), timber = std('#6b5140');
        for (const [x, y] of [[bb.minX, bb.minY], [bb.maxX, bb.minY], [bb.minX, bb.maxY], [bb.maxX, bb.maxY]]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), timber); post.position.set(x, h / 2, y); post.castShadow = true; group.add(post); }
        for (let x = bb.minX; x <= bb.maxX + 0.001; x += 0.35) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, bb.h + 0.4), timber); r.position.set(x, h + 0.075, bb.minY + bb.h / 2); r.castShadow = true; group.add(r); }
        for (const y of [bb.minY, bb.maxY]) { const beam = new THREE.Mesh(new THREE.BoxGeometry(bb.w + 0.4, 0.2, 0.1), timber); beam.position.set(bb.minX + bb.w / 2, h - 0.05, y); group.add(beam); }
        continue;
      }
      if (o.type === 'boundary') {
        const pts = [...o.points, o.points[0]].map(p => new THREE.Vector3(p.x, 0.01, p.y));
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#b3261e', dashSize: 0.4, gapSize: 0.2 })).computeLineDistances());
        continue;
      }
      const h = o.type === 'deck' ? Number(o.props.height) || 0.3 : SURFACE_H[o.type] ?? 0.04;
      group.add(slab(o, h, 0, std(colour(o), o.type === 'feature' ? { transparent: true, opacity: 0.6 } : {})));
      if (o.type === 'garden' && o.props.plantId && Number(o.props.plantSpacing) > 0) {
        const sp = Math.max(0.3, Number(o.props.plantSpacing)), bb = bbox(o.points);
        const big = /westringia|lilly|syzygium/.test(String(o.props.plantId));
        const shrub = std(big ? '#4f7f4a' : '#6f9a4f');
        let n = 0;
        for (let x = bb.minX + sp / 2; x < bb.maxX && n < 160; x += sp) for (let y = bb.minY + sp / 2; y < bb.maxY && n < 160; y += sp) {
          if (!pointInPolygon({ x, y }, o.points)) continue;
          const r = big ? Math.min(0.45, sp * 0.5) : Math.min(0.3, sp * 0.45);
          const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), shrub);
          m.scale.y = big ? 1.3 : 0.9; m.position.set(x, 0.18 + r * 0.8, y); m.castShadow = true;
          group.add(m); n++;
        }
      }
    } else if (g === 'line' && o.points.length >= 2) {
      for (let i = 0; i < o.points.length - 1; i++) {
        const a = o.points[i], c = o.points[i + 1], L = dist(a, c);
        if (L < 0.01) continue;
        const ang = Math.atan2(c.y - a.y, c.x - a.x), mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
        if (o.type === 'wall' || o.type === 'fence' || o.type === 'edging') {
          const h = o.type === 'wall' ? Number(o.props.exposedHeight) || 0.4 : o.type === 'fence' ? Number(o.props.height) || 1.8 : 0.12;
          const t = o.type === 'wall' ? (o.props.system === 'sandstone-block' ? 0.3 : o.props.system === 'segmental-block' ? 0.22 : 0.12) : o.type === 'fence' ? 0.05 : 0.04;
          const m = new THREE.Mesh(new THREE.BoxGeometry(L, h, t), std(o.type === 'fence' ? '#9aa0a6' : colour(o), o.type === 'fence' ? { transparent: true, opacity: 0.55 } : {}));
          m.position.set(mid.x, h / 2, mid.y); m.rotation.y = -ang; m.castShadow = true; m.receiveShadow = true;
          group.add(m);
          if (o.type === 'wall' && o.props.system === 'concrete-sleeper') {
            const bay = 2.03, post = std('#7b8188', { metalness: 0.4 });
            for (let d = 0; d <= L + 0.001; d += bay) {
              const k = Math.min(d, L) / L, p = new THREE.Mesh(new THREE.BoxGeometry(0.1, h + 0.02, 0.1), post);
              p.position.set(a.x + (c.x - a.x) * k, (h + 0.02) / 2, a.y + (c.y - a.y) * k + 0.08); group.add(p);
            }
          }
        } else {
          const col = o.type === 'drain' ? '#1d5fa8' : o.type === 'cable' ? '#b45309' : '#374151';
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, 0.08, a.y), new THREE.Vector3(c.x, 0.08, c.y)]), new THREE.LineDashedMaterial({ color: col, dashSize: 0.3, gapSize: 0.15 }));
          line.computeLineDistances(); group.add(line);
        }
      }
    } else if (g === 'point') {
      const p = o.points[0];
      if (o.type === 'tree') {
        const r = (Number(o.props.spread) || 3) / 2;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 10), std('#6b4a2b'));
        trunk.position.set(p.x, 1.1, p.y); trunk.castShadow = true;
        const crown = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), std(o.layer === 'existing' ? '#4c7a43' : '#6aa25c'));
        crown.scale.y = 0.85; crown.position.set(p.x, 2.2 + r * 0.6, p.y); crown.castShadow = true;
        group.add(trunk, crown);
      } else if (o.type === 'light') {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 6), std('#2d3138'));
        pole.position.set(p.x, 0.225, p.y);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: '#fde68a', emissive: '#fbbf24', emissiveIntensity: 1.2 }));
        bulb.position.set(p.x, 0.47, p.y);
        const glow = new THREE.PointLight('#ffd27a', 0.6, 3, 2); glow.position.set(p.x, 0.5, p.y);
        group.add(pole, bulb, glow);
      } else if (o.type === 'firepit') {
        const r = (Number(o.props.diameter) || 1) / 2;
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, 0.45, 24), std('#3a3a3a', { metalness: 0.4 }));
        bowl.position.set(p.x, 0.225, p.y); bowl.castShadow = true;
        const flame = new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, 0.5, 12), new THREE.MeshStandardMaterial({ color: '#f59e0b', emissive: '#f97316', emissiveIntensity: 1.5 }));
        flame.position.set(p.x, 0.7, p.y);
        const glow = new THREE.PointLight('#ff9a3c', 1.2, 5, 2); glow.position.set(p.x, 0.9, p.y);
        group.add(bowl, flame, glow);
      } else if (o.type === 'pit') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 0.45), std('#3f4a55', { metalness: 0.5 }));
        m.position.set(p.x, 0.07, p.y); group.add(m);
      } else if (o.type === 'plant') {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), std('#5e9150'));
        m.position.set(p.x, 0.3, p.y); m.castShadow = true; group.add(m);
      }
    }
  }
  return { group, centre: new THREE.Vector3(b.minX + b.w / 2, 0, b.minY + b.h / 2), size: Math.max(b.w, b.h, 6) };
}

export default function Scene3D({ project, materials, height = '100%' }: { project: Project; materials: Material[]; height?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ reset: () => void; top: () => void } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const hasObjects = project.objects.length > 0;
  useEffect(() => {
    const el = host.current;
    if (!el || !hasObjects) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { setErr('3D needs WebGL, which this browser or device has turned off. The 2D plan and drawings still work.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block'; renderer.domElement.style.touchAction = 'none';
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#eaf1f6');
    const { group, centre, size } = buildScene(project, materials);
    scene.add(group);
    scene.add(new THREE.HemisphereLight('#ffffff', '#b8c4a8', 1.1));
    const sun = new THREE.DirectionalLight('#fff7e8', 1.6);
    sun.position.set(centre.x - size * 0.6, size * 1.2, centre.z - size * 0.4); sun.target.position.copy(centre);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = sc.bottom = -size; sc.right = sc.top = size; sc.far = size * 4;
    scene.add(sun, sun.target);
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.03; controls.minDistance = 2; controls.maxDistance = size * 4;
    const reset = () => { cam.position.set(centre.x + size * 0.75, size * 0.8, centre.z + size * 1.1); controls.target.copy(centre); controls.update(); };
    const top = () => { cam.position.set(centre.x, size * 1.6, centre.z + 0.01); controls.target.copy(centre); controls.update(); };
    reset(); api.current = { reset, top };
    const resize = () => { const w = el.clientWidth, h = el.clientHeight || 300; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);
    let raf = 0;
    const loop = () => { controls.update(); renderer.render(scene, cam); raf = requestAnimationFrame(loop); };
    loop();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      scene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mt = m.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(mt)) mt.forEach(x => x.dispose()); else mt?.dispose(); });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [project.objects, materials, hasObjects]); // eslint-disable-line
  if (!hasObjects) return <div style={{ display: 'grid', placeItems: 'center', height }} className="muted">Nothing to show yet. Draw the site first.</div>;
  return <div style={{ position: 'relative', height, minHeight: 260 }} data-testid="model3d">
    <div ref={host} style={{ position: 'absolute', inset: 0 }} aria-label="Interactive 3D model. Drag to rotate, scroll or pinch to zoom, right-drag or two-finger drag to pan." role="img" />
    {err && <div className="banner warn" style={{ position: 'absolute', inset: 12, height: 'fit-content' }}>{err}</div>}
    <div style={{ position: 'absolute', right: 8, top: 52, display: 'flex', gap: 6 }}>
      <button className="btn sm" onClick={() => api.current?.reset()}>Reset view</button>
      <button className="btn sm" onClick={() => api.current?.top()}>Top view</button>
    </div>
    <div className="canvas-hint">Drag to rotate · scroll or pinch to zoom · right-drag to pan. {MODEL_LABEL}</div>
  </div>;
}
