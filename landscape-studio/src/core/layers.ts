import type { Material, Project, QtyLine, SiteObject } from './types.ts';
import { WALL_SYSTEMS, type WallSystem } from './assemblies.ts';
import { fmt, UNIT_LABEL } from './units.ts';

// Build layers: what an element is made of, top to bottom, with quantities taken from the
// deterministic take-off. Nothing here sizes a structure.

export type LayerStatus = 'verified' | 'assumed' | 'review';
export interface BuildLayer {
  name: string; purpose: string; product: string; qty: string; source: string; status: LayerStatus;
  instruction: string; hold?: string; thicknessMm?: number | null; fill: string;
}
export interface Assembly { objectId: string; title: string; concept: boolean; banner?: string; layers: BuildLayer[] }

export const ENGINEER_REQUIRED = 'Concept detail - engineer/manufacturer design required before construction.';

const q = (lines: QtyLine[], id: string, comp: string) => {
  const l = lines.find(x => x.objectId === id && x.component === comp);
  if (!l) return '-';
  if (l.gross == null) return 'unknown (input needed)';
  return `${fmt(l.gross)} ${UNIT_LABEL[l.unit]}${l.purchaseQty != null && l.purchaseUnit !== l.unit ? ` → buy ${fmt(l.purchaseQty)} ${UNIT_LABEL[l.purchaseUnit!]}` : ''}`;
};

export function assemblyFor(o: SiteObject, project: Project, lines: QtyLine[], materials: Material[]): Assembly | null {
  const mat = (id?: string) => materials.find(m => m.id === id);
  const name = (id?: string) => mat(id)?.name ?? 'to be confirmed';
  const st = (id?: string): LayerStatus => { const m = mat(id); return !m ? 'review' : m.priceStatus === 'verified' ? 'verified' : 'assumed'; };
  const p = o.props;
  if (o.type === 'paving') {
    const m = mat(o.materialId);
    return { objectId: o.id, title: o.name, concept: true, layers: [
      { name: 'Paver', purpose: 'Wearing surface', product: name(o.materialId), qty: q(lines, o.id, 'Pavers'), source: 'Selected product', status: st(o.materialId), instruction: `Lay in ${p.pattern} pattern; keep joints even; cut edges last.`, thicknessMm: m?.dims?.t ?? null, fill: '#e9d6b4' },
      { name: 'Jointing', purpose: 'Locks pavers, sheds water', product: name('sand-jointing'), qty: q(lines, o.id, 'Jointing sand'), source: p.jointCoverage ? 'Product coverage entered' : 'Coverage needed from datasheet', status: p.jointCoverage ? 'assumed' : 'review', instruction: 'Sweep in dry, compact, top up.', thicknessMm: null, fill: '#d8c79b' },
      { name: 'Bedding sand', purpose: 'Level bed for pavers', product: name('sand-bedding'), qty: q(lines, o.id, 'Bedding sand'), source: 'Assumption (depth editable)', status: 'assumed', instruction: `Screed to ${p.beddingDepth} mm; do not compact before laying.`, thicknessMm: Number(p.beddingDepth) || null, fill: '#f3e9cc' },
      { name: 'Base course', purpose: 'Load-bearing layer', product: name('base-roadbase-recycled'), qty: q(lines, o.id, 'Base course'), source: 'Supplier guidance (pedestrian), assumption', status: 'assumed', instruction: `Place and compact in layers to ${p.baseDepth} mm.`, hold: 'Vehicle areas or soft ground: designed pavement required.', thicknessMm: Number(p.baseDepth) || null, fill: '#cfc8b8' },
      { name: 'Subgrade', purpose: 'Existing ground', product: 'Existing soil', qty: q(lines, o.id, 'Excavation for paving'), source: 'Excavation volume from geometry', status: 'review', instruction: 'Excavate to formation level, remove soft spots, compact.', hold: 'Check services located before digging.', thicknessMm: null, fill: '#b7a58a' },
      { name: 'Falls', purpose: 'Drain water away', product: p.fallPct == null || p.fallPct === '' ? 'Fall not set' : `${p.fallPct}% to ${p.fallTo || 'direction not set'}`, qty: '-', source: 'Design input', status: p.fallPct ? 'assumed' : 'review', instruction: 'Set falls away from the house with string lines.', hold: 'Confirm where water discharges before laying.', thicknessMm: null, fill: 'none' },
      { name: 'Edge restraint', purpose: 'Stops pavers creeping', product: name('edge-restraint'), qty: q(lines, o.id, 'Edge restraint'), source: 'Perimeter from geometry', status: st('edge-restraint'), instruction: 'Install on open edges before laying.', thicknessMm: null, fill: 'none' },
    ] };
  }
  if (o.type === 'turf') return { objectId: o.id, title: o.name, concept: true, layers: [
    { name: 'Turf', purpose: 'Lawn surface', product: name(o.materialId), qty: q(lines, o.id, 'Turf'), source: 'Selected product', status: st(o.materialId), instruction: 'Lay same day as delivery, stagger joints, roll, water in.', thicknessMm: 30, fill: '#9fcf86' },
    { name: 'Underlay', purpose: 'Root zone', product: name('soil-turf-underlay'), qty: q(lines, o.id, 'Turf underlay'), source: 'Assumption (depth editable)', status: 'assumed', instruction: `Spread and level to ${p.underlayDepth} mm.`, thicknessMm: Number(p.underlayDepth) || null, fill: '#a98c63' },
    { name: 'Finished level', purpose: 'Match paving and edges', product: 'Finished surface flush with paving / edging', qty: '-', source: 'Site check', status: 'review', instruction: 'Check levels against paving and edging.', thicknessMm: null, fill: 'none' },
    { name: 'Prepared ground', purpose: 'Existing soil', product: 'Existing soil, ripped and cleared', qty: '-', source: '-', status: 'assumed', instruction: 'Remove weeds and old turf; break up compacted soil.', thicknessMm: null, fill: '#b7a58a' },
    { name: 'Irrigation', purpose: 'Optional', product: 'Not included', qty: '-', source: '-', status: 'assumed', instruction: 'Not in scope unless added.', thicknessMm: null, fill: 'none' },
  ] };
  if (o.type === 'garden') return { objectId: o.id, title: o.name, concept: true, layers: [
    { name: 'Mulch', purpose: 'Moisture and weed control', product: name('mulch'), qty: q(lines, o.id, 'Mulch'), source: 'Assumption (depth editable)', status: 'assumed', instruction: `Spread ${p.mulchDepth} mm after planting; keep off stems.`, thicknessMm: Number(p.mulchDepth) || null, fill: '#8a5a33' },
    { name: 'Plants', purpose: 'Planting', product: p.plantId ? `${name(p.plantId)} at ${p.plantSpacing ?? '?'} m centres` : 'Not selected', qty: q(lines, o.id, 'Plants'), source: 'Spacing from design', status: p.plantId && p.plantSpacing ? 'assumed' : 'review', instruction: 'Set out on grid before planting; water in.', thicknessMm: null, fill: 'none' },
    { name: 'Garden mix', purpose: 'Growing medium', product: name(o.materialId), qty: q(lines, o.id, 'Garden soil'), source: 'Selected product', status: st(o.materialId), instruction: `Place ${p.soilDepth} mm and blend with existing soil.`, thicknessMm: Number(p.soilDepth) || null, fill: '#6b4f33' },
    { name: 'Existing soil', purpose: 'Subsoil', product: 'Existing, loosened', qty: '-', source: '-', status: 'assumed', instruction: 'Loosen; remove rubble.', thicknessMm: null, fill: '#b7a58a' },
    { name: 'Edging', purpose: 'Defines bed', product: 'See garden edging items on the plan', qty: '-', source: 'Drawing', status: 'assumed', instruction: 'Install before soil.', thicknessMm: null, fill: 'none' },
  ] };
  if (o.type === 'wall') {
    const sys: WallSystem = p.system ?? 'concrete-sleeper';
    const approved = project.approvals.some(a => a.kind === 'engineering' && a.scope === o.id);
    const unit = sys === 'concrete-sleeper' ? 'Concrete sleepers' : sys === 'segmental-block' ? 'Wall blocks' : sys === 'sandstone-block' ? 'Sandstone blocks' : 'Timber sleepers (horizontal)';
    return { objectId: o.id, title: o.name, concept: !approved, banner: approved ? undefined : ENGINEER_REQUIRED, layers: [
      { name: 'Wall face', purpose: 'Retains soil', product: `${WALL_SYSTEMS[sys].label}: ${name(o.materialId)}`, qty: q(lines, o.id, unit), source: 'Selected product', status: st(o.materialId), instruction: 'Build course by course, level and true.', thicknessMm: null, fill: '#9aa1a9' },
      ...(sys === 'segmental-block' && p.capping ? [{ name: 'Capping', purpose: 'Finish', product: name('cap-versawall'), qty: q(lines, o.id, 'Capping units'), source: 'Selected product', status: st('cap-versawall'), instruction: 'Fix with adhesive per manufacturer.', thicknessMm: null, fill: '#c4c9d0' } as BuildLayer] : []),
      { name: 'Drainage aggregate', purpose: 'Relieves water pressure', product: name('agg-bluemetal-20'), qty: q(lines, o.id, 'Drainage aggregate behind wall'), source: 'Manufacturer guidance (≥300 mm zone)', status: 'assumed', instruction: 'Place as the wall rises; do not use soil here.', thicknessMm: (Number(p.drainWidth) || 0.3) * 1000, fill: '#c9d7e6' },
      { name: 'Filter fabric', purpose: 'Keeps fines out of drainage', product: name('geo-2000x50'), qty: q(lines, o.id, 'Geotextile filter fabric'), source: 'Assumption', status: 'assumed', instruction: 'Line back of drainage zone; lap over top.', thicknessMm: null, fill: 'none' },
      { name: 'Subsoil drain', purpose: 'Carries water away', product: name(p.agpipeId || 'agpipe-100-20-bcs'), qty: q(lines, o.id, 'Subsoil drain (ag pipe)'), source: 'Geometry + outlet allowance', status: 'review', instruction: 'Lay at base with fall to the outlet.', hold: 'Confirm drainage outlet before backfill.', thicknessMm: null, fill: 'none' },
      { name: 'Footing / foundation', purpose: 'Supports the wall', product: p.footingDia && p.footingDepth ? `Holes ${p.footingDia * 1000} dia × ${p.footingDepth * 1000} deep (entered from design)` : 'SIZE BY ENGINEER / MANUFACTURER', qty: q(lines, o.id, 'Post footing concrete'), source: approved ? 'Engineer approval recorded' : p.footingDia ? 'User-entered design values' : 'Not designed by this software', status: approved ? 'verified' : 'review', instruction: 'Build only to an approved detail.', hold: 'Engineer or manufacturer design before pouring.', thicknessMm: null, fill: '#c0c4c8' },
      { name: 'Retained ground', purpose: 'Soil behind wall', product: p.soil || 'Not assessed', qty: q(lines, o.id, 'Excavation for wall and drainage zone'), source: 'Not tested', status: 'review', instruction: 'Report water, fill or rock immediately.', hold: !p.surcharge || p.surcharge === 'unknown' ? 'Load behind wall not recorded: record it before building.' : p.surcharge !== 'none' ? `Load behind wall (${p.surcharge}): engineering review.` : undefined, thicknessMm: null, fill: '#b7a58a' },
    ] };
  }
  return null;
}

export const assemblies = (project: Project, lines: QtyLine[], materials: Material[]) =>
  project.objects.filter(o => o.layer === 'proposed').map(o => assemblyFor(o, project, lines, materials)).filter(Boolean) as Assembly[];
