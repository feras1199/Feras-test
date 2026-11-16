import type { Material, Project, SiteObject } from './types.ts';
import { GEOM } from './types.ts';
import { asRectangle, resizeRectangle, setPolylineLength } from './geometry.ts';
import { WALL_SYSTEMS, type WallSystem, takeoff } from './assemblies.ts';
import { computeEstimate, objectDirectCost } from './estimate.ts';
import { guidedMeasurements } from './validation.ts';
import { exGst, money } from './units.ts';
import type { Supplier } from './types.ts';

// Structured change operations. Both the built-in command parser and the optional
// AI assistant produce these; they are applied to the project only after the user approves.

export type Op =
  | { op: 'setMaterial'; objectId: string; materialId: string }
  | { op: 'setWallSystem'; objectId: string; system: WallSystem; materialId?: string }
  | { op: 'setProp'; objectId: string; prop: string; value: any }
  | { op: 'setLength'; objectId: string; length: number }
  | { op: 'setRect'; objectId: string; w: number; h: number }
  | { op: 'setEstimate'; field: 'markupPct' | 'contingencyPct' | 'overheadPct'; value: number }
  | { op: 'addObject'; object: SiteObject }
  | { op: 'removeObject'; objectId: string };

export function describeOp(op: Op, project: Project, materials: Material[]): string {
  const name = (id: string) => project.objects.find(o => o.id === id)?.name ?? id;
  const mat = (id?: string) => materials.find(m => m.id === id)?.name ?? id ?? '';
  switch (op.op) {
    case 'setMaterial': return `${name(op.objectId)}: change material to ${mat(op.materialId)}`;
    case 'setWallSystem': return `${name(op.objectId)}: change wall system to ${WALL_SYSTEMS[op.system].label}${op.materialId ? ` (${mat(op.materialId)})` : ''}`;
    case 'setProp': return `${name(op.objectId)}: set ${op.prop} to ${op.value}`;
    case 'setLength': return `${name(op.objectId)}: set length to ${op.length} m`;
    case 'setRect': return `${name(op.objectId)}: resize to ${op.w} × ${op.h} m`;
    case 'setEstimate': return `Estimate: set ${op.field} to ${op.value}%`;
    case 'addObject': return `Add ${op.object.name}`;
    case 'removeObject': return `Remove ${name(op.objectId)}`;
  }
}

export function applyOps(project: Project, ops: Op[]): Project {
  const p: Project = structuredClone(project);
  const find = (id: string) => p.objects.find(o => o.id === id);
  for (const op of ops) {
    if (op.op === 'setEstimate') { p.estimate[op.field] = op.value; continue; }
    if (op.op === 'addObject') { if (!p.objects.some(o => o.id === op.object.id)) p.objects.push(structuredClone(op.object)); continue; }
    if (op.op === 'removeObject') { const o = find(op.objectId); if (o && !o.locked) p.objects = p.objects.filter(x => x.id !== op.objectId); continue; }
    const o = find(op.objectId);
    if (!o || o.locked) continue;
    switch (op.op) {
      case 'setMaterial': o.materialId = op.materialId; break;
      case 'setWallSystem': o.props.system = op.system; o.materialId = op.materialId ?? WALL_SYSTEMS[op.system].defaultMaterial; break;
      case 'setProp': o.props[op.prop] = op.value; break;
      case 'setLength': if (GEOM[o.type] === 'line' && op.length > 0) { o.points = setPolylineLength(o.points, op.length); o.confidence = 'estimated'; } break;
      case 'setRect': if (asRectangle(o.points) && op.w > 0 && op.h > 0) { o.points = resizeRectangle(o.points, op.w, op.h); o.confidence = 'estimated'; } break;
    }
  }
  return p;
}

export interface Impact { before: number; after: number; delta: number; beforeFlags: number; afterFlags: number }

export function impactOf(project: Project, ops: Op[], materials: Material[], suppliers: Supplier[]): Impact {
  const e0 = computeEstimate(project, takeoff(project, materials), materials, suppliers);
  const p1 = applyOps(project, ops);
  const e1 = computeEstimate(p1, takeoff(p1, materials), materials, suppliers);
  return { before: e0.priceInc, after: e1.priceInc, delta: e1.priceInc - e0.priceInc, beforeFlags: e0.flags.length, afterFlags: e1.flags.length };
}

export interface CommandResult { ops: Op[]; answer: string; understood: boolean }

const SYSTEM_WORDS: [RegExp, WallSystem][] = [
  [/concrete sleeper|sleeper wall|concrete sleepers/, 'concrete-sleeper'],
  [/segmental|block wall|blocks|versawall/, 'segmental-block'],
  [/sandstone/, 'sandstone-block'],
  [/timber|pine/, 'timber-sleeper'],
];

/**
 * Built-in command interpreter. This is ordinary pattern matching, not a language model.
 * It handles a small set of phrasings and says so when it does not understand.
 */
export function parseCommand(text: string, project: Project, materials: Material[], suppliers: Supplier[], selectedId?: string): CommandResult {
  const t = text.toLowerCase().trim();
  const proposed = project.objects.filter(o => o.layer === 'proposed');
  const walls = proposed.filter(o => o.type === 'wall');
  const pick = (type: SiteObject['type']) => proposed.find(o => o.id === selectedId && o.type === type) ?? proposed.find(o => o.type === type);
  const lines = takeoff(project, materials);

  // What measurements are missing?
  if (/missing|what.*measure|measurements? (are )?(needed|required)/.test(t)) {
    const g = guidedMeasurements(project, materials, 8);
    return { ops: [], understood: true, answer: g.length ? 'Measurements still needed, most important first:\n' + g.map((x, i) => `${i + 1}. ${x.text} (${x.why})`).join('\n') : 'All key set-out measurements have a verified record.' };
  }

  // Why does the wall need engineering?
  if (/why.*engineer|engineering review|need.*engineer/.test(t)) {
    if (!walls.length) return { ops: [], understood: true, answer: 'There is no proposed retaining wall in this design.' };
    const a = walls.map(w => {
      const h = Number(w.props.retainedHeight ?? w.props.exposedHeight);
      const r: string[] = [];
      if (!isFinite(h)) r.push('its retained height is not recorded');
      else if (h > 0.8) r.push(`it retains ${h.toFixed(2)} m, above the 800 mm lower bound of AS 4678`);
      if ((w.props.surcharge ?? 'unknown') === 'unknown') r.push('the load behind it (slope, fence, driveway, structure) has not been recorded');
      else if (w.props.surcharge !== 'none') r.push(`there is a surcharge behind it (${w.props.surcharge})`);
      if (w.props.system === 'concrete-sleeper') r.push('post size, embedment and footing dimensions for sleeper walls come from an engineer or the manufacturer design table, which this software does not produce');
      return `${w.name}: ${r.length ? r.join('; ') : 'no engineering trigger found in the recorded data, but soil and groundwater are not assessed'}.`;
    });
    return { ops: [], understood: true, answer: a.join('\n') + '\nThis software does not check sliding, overturning or bearing.' };
  }

  // Cheaper equivalent materials
  if (/cheaper (equivalent )?materials|show.*cheaper|alternatives? for/.test(t) && !/\$\s?\d/.test(t)) {
    const rows: string[] = [];
    for (const o of proposed) {
      const m = materials.find(x => x.id === o.materialId);
      if (!m?.group) continue;
      const alts = materials.filter(x => x.group === m.group && x.id !== m.id);
      if (!alts.length) continue;
      rows.push(`${o.name} (now ${m.name}, ${m.price == null ? 'unpriced' : money(m.price) + '/' + m.unit}):\n` + alts.map(x => `   - ${x.name}: ${x.price == null ? 'quote required' : money(x.price) + '/' + x.unit + (x.priceStatus !== 'verified' ? ' [' + x.priceStatus + ']' : '')} (${suppliers.find(s => s.id === x.supplierId)?.name ?? ''})`).join('\n'));
    }
    return { ops: [], understood: true, answer: rows.length ? rows.join('\n') + '\nUnit prices are not directly comparable across different units and sizes. Use "make it $X cheaper" for an installed-cost comparison.' : 'No substitutes found in the Materials Library for the materials in use.' };
  }

  // Replace wall system
  const rep = t.match(/(replace|change|swap|switch).*(with|to|for)\s+(.*)$/);
  if (rep && /wall|sandstone|sleeper|block|timber/.test(t)) {
    const target = SYSTEM_WORDS.find(([re]) => re.test(rep[3]));
    if (target && walls.length) {
      const sel = walls.find(w => w.id === selectedId);
      const list = sel ? [sel] : walls;
      return { ops: list.map(w => ({ op: 'setWallSystem' as const, objectId: w.id, system: target[1] })), understood: true, answer: `Change ${list.length} wall${list.length > 1 ? 's' : ''} to ${WALL_SYSTEMS[target[1]].label}. Heights and positions are unchanged. A different wall system has different engineering and installation requirements.` };
    }
  }

  // Wall length / height
  const len = t.match(/wall.*?(?:length|long)?.*?(\d+(?:\.\d+)?)\s*m(?:etres?)?\b.*(long|length)?/);
  if (/(make|set|change|extend|shorten).*wall/.test(t)) {
    const w = pick('wall');
    const hm = t.match(/(?:height|high)\D*(\d+(?:\.\d+)?)\s*(mm|m)\b/) || t.match(/(\d+(?:\.\d+)?)\s*(mm|m)\s*(?:high|height)/);
    if (w && hm) { const v = hm[2] === 'mm' ? Number(hm[1]) / 1000 : Number(hm[1]); return { ops: [{ op: 'setProp', objectId: w.id, prop: 'exposedHeight', value: v }, { op: 'setProp', objectId: w.id, prop: 'retainedHeight', value: v }], understood: true, answer: `Set ${w.name} exposed and retained height to ${v} m. Height changes can change the engineering and approval pathway.` }; }
    if (w && len) return { ops: [{ op: 'setLength', objectId: w.id, length: Number(len[1]) }], understood: true, answer: `Set ${w.name} length to ${len[1]} m by moving its end point. The geometry becomes "estimated" until re-measured.` };
  }

  // Paving size
  const rect = t.match(/(paving|patio|deck|turf|lawn).*?(\d+(?:\.\d+)?)\s*m?\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)/);
  if (rect) {
    const type = /deck/.test(rect[1]) ? 'deck' : /turf|lawn/.test(rect[1]) ? 'turf' : 'paving';
    const o = pick(type);
    if (o && asRectangle(o.points)) return { ops: [{ op: 'setRect', objectId: o.id, w: Number(rect[2]), h: Number(rect[3]) }], understood: true, answer: `Resize ${o.name} to ${rect[2]} × ${rect[3]} m, keeping its first corner fixed.` };
    if (o) return { ops: [], understood: true, answer: `${o.name} is not a rectangle, so it cannot be resized by width and length. Drag its corners in Site Drawing.` };
  }

  // Cost reduction
  if (/cheaper|reduce (the )?cost|save|under budget|lower (the )?cost/.test(t)) {
    const tm = t.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(k)?/);
    const target = tm ? Number(tm[1].replace(/,/g, '')) * (tm[2] ? 1000 : 1) : null;
    const cands: { op: Op; saving: number; note: string }[] = [];
    for (const o of proposed) {
      const m = materials.find(x => x.id === o.materialId);
      if (!m?.group) continue;
      const base = objectDirectCost(project, o.id, lines, materials);
      for (const alt of materials.filter(x => x.group === m.group && x.id !== m.id && x.price != null)) {
        const p1 = applyOps(project, [{ op: 'setMaterial', objectId: o.id, materialId: alt.id }]);
        const c1 = objectDirectCost(p1, o.id, takeoff(p1, materials), materials);
        if (c1.missing !== base.missing) continue; // only compare like with like
        if (c1.cost < base.cost - 1) cands.push({ op: { op: 'setMaterial', objectId: o.id, materialId: alt.id }, saving: base.cost - c1.cost, note: `${o.name}: ${m.name} → ${alt.name}${alt.priceStatus !== 'verified' ? ' [' + alt.priceStatus + ' price]' : ''}` });
      }
      if (o.type === 'wall') for (const sys of Object.keys(WALL_SYSTEMS) as WallSystem[]) {
        if (sys === o.props.system) continue;
        const dm = materials.find(x => x.id === WALL_SYSTEMS[sys].defaultMaterial);
        if (!dm || dm.price == null) continue;
        const p1 = applyOps(project, [{ op: 'setWallSystem', objectId: o.id, system: sys }]);
        const c1 = objectDirectCost(p1, o.id, takeoff(p1, materials), materials);
        if (c1.missing === base.missing && c1.cost < base.cost - 1) cands.push({ op: { op: 'setWallSystem', objectId: o.id, system: sys }, saving: base.cost - c1.cost, note: `${o.name}: change to ${WALL_SYSTEMS[sys].label}${dm.priceStatus !== 'verified' ? ' [' + dm.priceStatus + ' price]' : ''}` });
      }
    }
    cands.sort((a, b) => b.saving - a.saving);
    const chosen: typeof cands = [], used = new Set<string>();
    const s = project.estimate;
    const k = (1 + s.overheadPct / 100) * (1 + s.contingencyPct / 100) * (1 + s.markupPct / 100) * (1 + s.gstPct / 100);
    let got = 0;
    for (const c of cands) { const id = (c.op as any).objectId; if (used.has(id)) continue; chosen.push(c); used.add(id); got += c.saving * k; if (target != null && got >= target) break; }
    if (!chosen.length) return { ops: [], understood: true, answer: 'No cheaper priced substitute was found in the Materials Library without changing the layout. Unpriced materials are not considered: get quotes for alternatives first, or reduce areas and lengths.' };
    return { ops: chosen.map(c => c.op), understood: true, answer: `Layout unchanged. Proposed substitutions (approximate saving on the customer price ${money(got, 0)} inc GST${target != null ? `, target ${money(target, 0)}` : ''}):\n` + chosen.map(c => `- ${c.note} (direct cost saving ${money(c.saving, 0)})`).join('\n') + (target != null && got < target ? '\nThis does not reach the target. Further savings need a smaller scope or new supplier quotes.' : '') + '\nCheck durability, maintenance and installation differences before accepting. Mandatory drainage and structural items were not reduced.' };
  }

  return { ops: [], understood: false, answer: 'The built-in assistant did not understand that. It handles: "make the wall 12 m long", "set wall height to 0.8 m", "replace the wall with concrete sleepers / blocks / sandstone", "make the paving 6 x 4", "make this design $2,000 cheaper", "show cheaper materials", "what measurements are missing?", "why does the wall need engineering?".' };
}

void exGst;

/** Check operations that came from outside (e.g. an AI model) before they can be shown for approval. */
export function validateOps(raw: unknown, project: Project, materials: Material[]): { ops: Op[]; rejected: string[] } {
  const ops: Op[] = [], rejected: string[] = [];
  const objs = new Map(project.objects.map(o => [o.id, o])), mats = new Set(materials.map(m => m.id));
  const NUMERIC_PROPS = new Set(['exposedHeight', 'retainedHeight', 'baseDepth', 'beddingDepth', 'soilDepth', 'mulchDepth', 'plantSpacing', 'underlayDepth', 'depth', 'edgePct', 'wastePct', 'qty']);
  const TEXT_PROPS = new Set(['pattern', 'plantId']);
  for (const r of Array.isArray(raw) ? raw : []) {
    const o: any = r;
    const bad = (why: string) => rejected.push(`${JSON.stringify(o).slice(0, 120)}: ${why}`);
    if (!o || typeof o !== 'object') { bad('not an object'); continue; }
    if (o.op === 'setEstimate') { if (['markupPct', 'contingencyPct', 'overheadPct'].includes(o.field) && typeof o.value === 'number' && o.value >= 0 && o.value <= 200) ops.push(o); else bad('invalid estimate field or value'); continue; }
    const target = objs.get(o.objectId);
    if (!target) { bad('unknown object'); continue; }
    if (target.layer !== 'proposed') { bad('existing site objects cannot be changed by the assistant'); continue; }
    if (o.op === 'setMaterial') { if (mats.has(o.materialId)) ops.push(o); else bad('unknown material'); }
    else if (o.op === 'setWallSystem') { if (target.type === 'wall' && o.system in WALL_SYSTEMS && (o.materialId == null || mats.has(o.materialId))) ops.push(o); else bad('invalid wall system'); }
    else if (o.op === 'setLength') { if (GEOM[target.type] === 'line' && typeof o.length === 'number' && o.length > 0 && o.length < 500) ops.push(o); else bad('invalid length'); }
    else if (o.op === 'setRect') { if (asRectangle(target.points) && o.w > 0 && o.h > 0 && o.w < 500 && o.h < 500) ops.push(o); else bad('not a rectangle or invalid size'); }
    else if (o.op === 'setProp') {
      if (NUMERIC_PROPS.has(o.prop) && typeof o.value === 'number' && o.value >= 0 && o.value < 10000) ops.push(o);
      else if (TEXT_PROPS.has(o.prop) && typeof o.value === 'string') ops.push(o);
      else bad('property not allowed (structural, drainage and footing inputs cannot be set by the assistant)');
    } else bad('unknown operation');
  }
  return { ops, rejected };
}

/** Compact, non-identifying project description sent to an AI provider (no customer name, address or photos). */
export function aiContext(project: Project, materials: Material[]) {
  return {
    objects: project.objects.filter(o => o.layer === 'proposed').map(o => ({ id: o.id, type: o.type, name: o.name, materialId: o.materialId, isRectangle: !!asRectangle(o.points), lengthM: GEOM[o.type] === 'line' ? Number(o.points.reduce((s, p, i, a) => (i ? s + Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) : 0), 0).toFixed(3)) : undefined, props: o.props })),
    materials: materials.map(m => ({ id: m.id, name: m.name, group: m.group, unit: m.unit, price: m.price, priceStatus: m.priceStatus })),
    estimate: { markupPct: project.estimate.markupPct, contingencyPct: project.estimate.contingencyPct, overheadPct: project.estimate.overheadPct },
    budgetMax: project.brief.budgetMax,
  };
}
