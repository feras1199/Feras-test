import { lazy, Suspense } from 'react';
import type { Material, Project } from '../../core/types.ts';

// The interactive 3D model (three.js) is loaded only when first shown.
const Scene3D = lazy(() => import('./Scene3D.tsx'));

export function Iso3D({ project, materials, height = '100%' }: { project: Project; materials: Material[]; height?: string }) {
  return <Suspense fallback={<div style={{ display: 'grid', placeItems: 'center', height }} className="muted">Loading 3D model…</div>}>
    <Scene3D project={project} materials={materials} height={height} />
  </Suspense>;
}
