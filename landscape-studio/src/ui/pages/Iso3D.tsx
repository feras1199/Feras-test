import { useState } from 'react';
import { RotateCw } from 'lucide-react';
import type { Material, Project } from '../../core/types.ts';
import { isoScene, MASSING_LABEL } from '../../core/iso.ts';

/** On-screen massing view. Same scene function as the drawing pack sheet. */
export function Iso3D({ project, materials, height = '100%' }: { project: Project; materials: Material[]; height?: string }) {
  const [turn, setTurn] = useState(0);
  const sc = isoScene(project, materials, turn);
  if (!sc) return <div style={{ display: 'grid', placeItems: 'center', height }} className="muted">Nothing to show yet. Draw the site first.</div>;
  const { minX, minY, maxX, maxY } = sc.bounds, pad = 0.6;
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  return <div style={{ height, position: 'relative', background: '#fbfcfa' }} data-testid="massing">
    <svg viewBox={vb} style={{ width: '100%', height: '100%' }} role="img" aria-label="3D massing view of the site" preserveAspectRatio="xMidYMid meet">
      {sc.prims.map((p, i) => p.t === 'poly' ? <polygon key={i} points={p.pts.map(q => q.join(',')).join(' ')} fill={p.fill} stroke={p.stroke} strokeWidth="0.03" strokeLinejoin="round" opacity={p.opacity ?? 1} />
        : p.t === 'line' ? <line key={i} x1={p.a[0]} y1={p.a[1]} x2={p.b[0]} y2={p.b[1]} stroke={p.stroke} strokeWidth={p.w * 0.04} strokeDasharray={p.dash?.map(v => v * 0.1).join(' ')} />
          : <circle key={i} cx={p.c[0]} cy={p.c[1]} r={p.r} fill={p.fill} stroke={p.stroke} strokeWidth="0.03" />)}
    </svg>
    <div style={{ position: 'absolute', right: 8, top: 56 }}><button className="btn sm" onClick={() => setTurn((turn + 1) % 4)}><RotateCw size={14} /> Rotate view</button></div>
    <div className="canvas-hint">{MASSING_LABEL}</div>
  </div>;
}
