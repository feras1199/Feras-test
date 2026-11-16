import type { DesignProposal, Pt, SiteObject } from './types.ts';
import { obj, TIERS, type Tier, type TierSpec, yardOf } from './proposals.ts';
import { polygonArea, polylineLength, rectPoints } from './geometry.ts';
import { fmt } from './units.ts';
import type { Project } from './types.ts';

// Design ideas: whole-yard layout patterns, each fitted to the drawn yard. The yard is the
// rectangle inside the site outline beyond the house (house along the top edge, y grows to the back fence).
// Ideas are suggestions to discuss with the customer, never measurements.

export interface Conditions {
  overgrown: boolean; slope: boolean; kidsPets: boolean; entertaining: boolean; lowMaintenance: boolean; keepTrees: boolean; existingPatio: boolean;
}
export const CONDITION_LABEL: Record<keyof Conditions, string> = {
  overgrown: 'Overgrown / neglected', slope: 'Noticeable slope', kidsPets: 'Kids or pets use the yard', entertaining: 'Customer entertains often',
  lowMaintenance: 'Wants low maintenance', keepTrees: 'Trees to keep', existingPatio: 'Existing patio to replace',
};
export const NO_CONDITIONS: Conditions = { overgrown: false, slope: false, kidsPets: false, entertaining: false, lowMaintenance: false, keepTrees: false, existingPatio: false };

type Yard = NonNullable<ReturnType<typeof yardOf>>;
type Change = DesignProposal['changes'][number];

export interface Idea {
  id: string; name: string; pitch: string; inspiredBy: string;
  /** Smallest yard (width × depth, m) the layout fits. */
  min: { w: number; d: number };
  fit: (y: Yard, c: Conditions) => { score: number; why: string[] };
  layout: (y: Yard, t: TierSpec, tier: Tier) => SiteObject[];
}

const circle = (cx: number, cy: number, r: number, n = 20): Pt[] => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) }));
const clampRect = (y: Yard, x: number, yy: number, w: number, h: number) => { const x0 = Math.max(y.x0 + 0.3, x), y0 = Math.max(y.y0, yy); const x1 = Math.min(y.x1 - 0.3, x + w), y1 = Math.min(y.y1 - 0.2, yy + h); return x1 - x0 > 0.3 && y1 - y0 > 0.3 ? rectPoints(x0, y0, x1 - x0, y1 - y0) : null; };
const lights = (n: number, pts: Pt[]) => pts.slice(0, n).map((p, i) => obj('light', `Garden light ${i + 1}`, [p], 'light-spike'));
const along = (x0: number, x1: number, yy: number, n: number): Pt[] => Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * (i + 0.5)) / n, y: yy }));
const narrow = (y: Yard) => y.w < 4.5 || y.d / y.w > 3;
const stepperMat = (tier: Tier) => (tier === 'premium' ? 'pav-stepper-sandstone' : 'pav-stepper-900');
const gravelMat = (tier: Tier) => (tier === 'premium' ? 'gravel-pebble-black' : 'gravel-deco');

/** Stepping stones 0.9 × 0.45 at 0.6 m centres along a straight run. */
function steppers(x: number, yStart: number, yEnd: number, tier: Tier): SiteObject[] {
  const out: SiteObject[] = [];
  for (let yy = yStart, i = 1; yy + 0.45 <= yEnd; yy += 0.6, i++) out.push(obj('paving', `Stepping stone ${i}`, rectPoints(x - 0.45, yy, 0.9, 0.45), stepperMat(tier), { pattern: 'stack', baseDepth: 75, beddingDepth: 30, edgePct: 0, wastePct: 2, isStepper: true }));
  return out;
}

export const IDEAS: Idea[] = [
  {
    id: 'entertainer', min: { w: 5, d: 6 }, name: 'Entertainer\'s terrace', inspiredBy: 'Large paved terrace with pergola lounge, central lawn, planted borders and path lights.',
    pitch: 'Wide paved terrace along the house with a pergola lounge, a lawn in the middle and planted borders all round. Lights along the paths.',
    fit: (y, c) => { const why: string[] = []; let s = 50; if (c.entertaining) { s += 30; why.push('customer entertains'); } if (y.w >= 8 && y.d >= 7) { s += 15; why.push(`room for terrace and lawn (${fmt(y.w, 1)} × ${fmt(y.d, 1)} m)`); } if (narrow(y)) { s -= 40; why.push('yard is too narrow for a terrace and lawn'); } if (c.lowMaintenance) s -= 5; return { score: s, why }; },
    layout: (y, t, tier) => {
      const terr = Math.min(Math.max(2.8, y.d * 0.32), 4.5), out: SiteObject[] = [];
      const pav = clampRect(y, y.x0 + 0.3, y.y0, y.w - 0.6, terr)!;
      out.push(obj('paving', 'Terrace', pav, t.paving, { pattern: t.pattern, fallPct: 1.5, fallTo: 'lawn / grated drain (confirm outlet)' }));
      const pw = Math.min(4, y.w * 0.35), pd = Math.min(3.6, terr - 0.2);
      if (tier !== 'economy') out.push(obj('pergola', 'Pergola lounge', rectPoints(y.x1 - 0.3 - pw, y.y0 + 0.1, pw, pd), 'pergola-kit', { height: 2.7, attached: false, distToBoundary: 0.3 }));
      const b = 1.2, lawn = clampRect(y, y.x0 + b + 0.3, y.y0 + terr + 0.3, y.w - 2 * b - 0.6, y.d - terr - b - 0.5);
      if (lawn) out.push(obj('turf', 'Lawn', lawn, 'turf-sirwalter'));
      const sp = t.spacing;
      out.push(obj('garden', 'Back border', rectPoints(y.x0 + 0.3, y.y1 - b - 0.2, y.w - 0.6, b), 'soil-garden-organic', { plantId: t.plant, plantSpacing: sp }));
      out.push(obj('garden', 'Left border', rectPoints(y.x0 + 0.3, y.y0 + terr + 0.3, b - 0.1, Math.max(0.5, y.d - terr - b - 0.8)), 'soil-garden-organic', { plantId: t.plant, plantSpacing: sp }));
      out.push(obj('garden', 'Right border', rectPoints(y.x1 - 0.3 - (b - 0.1), y.y0 + terr + 0.3, b - 0.1, Math.max(0.5, y.d - terr - b - 0.8)), 'soil-garden-organic', { plantId: t.plant, plantSpacing: sp }));
      if (lawn) out.push(obj('edging', 'Lawn edge', [{ x: y.x0 + b + 0.3, y: y.y0 + terr + 0.3 }, { x: y.x0 + b + 0.3, y: y.y1 - b - 0.2 }, { x: y.x1 - b - 0.3, y: y.y1 - b - 0.2 }, { x: y.x1 - b - 0.3, y: y.y0 + terr + 0.3 }], t.edging));
      out.push(...lights(t.lights, along(y.x0 + 0.8, y.x1 - 0.8, y.y0 + terr + 0.15, t.lights)));
      const d = obj('drain', 'Terrace drain', [{ x: y.x0 + 0.6, y: y.y0 + terr - 0.15 }, { x: y.x1 - 0.6, y: y.y0 + terr - 0.15 }], 'channel-drain', { kind: 'channel', dischargeTo: 'Existing stormwater - NOT verified' });
      out.push(d);
      return out;
    },
  },
  {
    id: 'zen-path', min: { w: 2.5, d: 3 }, name: 'Stepping-stone gravel garden', inspiredBy: 'Overgrown yard turned into a pebble garden with large stepping stones, structural planting and fence lighting.',
    pitch: 'Clears the yard into a pebble garden crossed by large stepping stones, with structural plants along the fences and lights washing the fence. No mowing.',
    fit: (y, c) => { const why: string[] = []; let s = 45; if (c.overgrown) { s += 25; why.push('suits an overgrown yard: clear, level, gravel'); } if (c.lowMaintenance) { s += 25; why.push('no lawn to mow'); } if (c.kidsPets) { s -= 25; why.push('little soft play space'); } if (y.d >= 5) s += 5; return { score: s, why }; },
    layout: (y, t, tier) => {
      const out: SiteObject[] = [], b = Math.min(1.4, y.w * 0.22), cx = (y.x0 + y.x1) / 2;
      const field = clampRect(y, y.x0 + 0.3 + b, y.y0 + 0.4, y.w - 0.6 - 2 * b, y.d - 0.6)!;
      const g = obj('gravel', 'Pebble garden', field, gravelMat(tier), { depth: 60 });
      out.push(g, ...steppers(cx, y.y0 + 0.5, y.y1 - 0.4, tier).map(s => ({ ...s, props: { ...s.props, hostId: g.id } })));
      out.push(obj('garden', 'Left planting', rectPoints(y.x0 + 0.3, y.y0 + 0.4, b, y.d - 0.6), 'soil-garden-organic', { plantId: tier === 'premium' ? 'plant-westringia' : 'plant-dianella', plantSpacing: tier === 'economy' ? 0.9 : 0.7 }));
      out.push(obj('garden', 'Right planting', rectPoints(y.x1 - 0.3 - b, y.y0 + 0.4, b, y.d - 0.6), 'soil-garden-organic', { plantId: tier === 'premium' ? 'plant-westringia' : 'plant-dianella', plantSpacing: tier === 'economy' ? 0.9 : 0.7 }));
      out.push(obj('edging', 'Gravel edge', [{ x: y.x0 + 0.3 + b, y: y.y0 + 0.4 }, { x: y.x0 + 0.3 + b, y: y.y1 - 0.2 }], t.edging), obj('edging', 'Gravel edge 2', [{ x: y.x1 - 0.3 - b, y: y.y0 + 0.4 }, { x: y.x1 - 0.3 - b, y: y.y1 - 0.2 }], t.edging));
      const n = Math.max(3, Math.round(t.lights * 0.8));
      out.push(...lights(n, Array.from({ length: n }, (_, i) => ({ x: y.x1 - 0.45, y: y.y0 + 0.8 + ((y.d - 1.4) * i) / Math.max(1, n - 1) }))));
      return out;
    },
  },
  {
    id: 'firepit-lawn', min: { w: 6, d: 6 }, name: 'Lawn with fire-pit circle', inspiredBy: 'Neglected yard restored to lawn, flower borders and a round paved fire-pit area with chairs.',
    pitch: 'Restores a soft green lawn, adds deep flower borders and a round paved fire-pit area in the back corner for evenings outside.',
    fit: (y, c) => { const why: string[] = []; let s = 50; if (c.overgrown) { s += 15; why.push('restores a neglected yard'); } if (c.kidsPets) { s += 10; why.push('keeps a lawn for play'); } if (c.entertaining) { s += 10; why.push('fire-pit gathering spot'); } if (y.w < 6 || y.d < 6) { s -= 30; why.push('circle needs about 4 m clear in a corner'); } return { score: s, why }; },
    layout: (y, t, tier) => {
      const out: SiteObject[] = [], r = Math.min(2.0, Math.min(y.w, y.d) * 0.22), b = 1.2;
      const cx = y.x1 - 0.3 - b - r - 0.2, cy = y.y1 - 0.2 - b - r - 0.2;
      const lawn = clampRect(y, y.x0 + 0.3 + b, y.y0 + 0.4, y.w - 0.6 - b, y.d - 0.6 - b);
      if (lawn) out.push(obj('turf', 'Lawn', lawn, 'turf-sirwalter'));
      out.push(obj('paving', 'Fire-pit circle', circle(cx, cy, r), t.paving, { pattern: tier === 'economy' ? 'stretcher' : 'random', fallPct: 1.5, fallTo: 'surrounding lawn', wastePct: 15, hostId: out.find(o => o.type === 'turf')?.id }));
      out.push(obj('firepit', 'Fire pit', [{ x: cx, y: cy }], tier === 'premium' ? 'firepit-gas' : 'firepit-steel', { diameter: 1.0 }));
      out.push(obj('garden', 'Flower border (left)', rectPoints(y.x0 + 0.3, y.y0 + 0.4, b, y.d - 0.6), 'soil-garden-organic', { plantId: t.plant, plantSpacing: t.spacing }));
      out.push(obj('garden', 'Flower border (back)', rectPoints(y.x0 + 0.3 + b, y.y1 - 0.2 - b, y.w - 0.6 - b, b), 'soil-garden-organic', { plantId: t.plant, plantSpacing: t.spacing }));
      if (lawn) out.push(obj('edging', 'Border edge', [{ x: y.x0 + 0.3 + b, y: y.y0 + 0.4 }, { x: y.x0 + 0.3 + b, y: y.y1 - 0.2 - b }, { x: y.x1 - 0.3, y: y.y1 - 0.2 - b }], t.edging));
      out.push(...lights(Math.min(t.lights, 6), circle(cx, cy, r + 0.35, Math.min(t.lights, 6))));
      return out;
    },
  },
  {
    id: 'side-path', min: { w: 2, d: 5 }, name: 'Side-yard path and lounge nook', inspiredBy: 'Narrow gravel side yard turned into a paver path, turf strips and a small lounge pad at the end.',
    pitch: 'For long narrow yards: a paver path along one side, turf strips beside it and a small paved lounge nook at the end.',
    fit: (y, c) => { const why: string[] = []; let s = 30; if (narrow(y)) { s += 55; why.push(`long narrow yard (${fmt(y.w, 1)} m wide)`); } else why.push('works best in yards under about 4.5 m wide'); if (c.lowMaintenance) { s += 5; why.push('synthetic turf option'); } return { score: s, why }; },
    layout: (y, t, tier) => {
      const out: SiteObject[] = [], pw = Math.min(1.2, y.w * 0.4), nook = Math.min(3, y.d * 0.3);
      out.push(obj('paving', 'Path', rectPoints(y.x0 + 0.3, y.y0 + 0.2, pw, y.d - nook - 0.4), t.paving, { pattern: 'stretcher', fallPct: 1.5, fallTo: 'turf strip' }));
      out.push(obj('paving', 'Lounge nook', rectPoints(y.x0 + 0.3, y.y1 - 0.2 - nook, y.w - 0.6, nook), t.paving, { pattern: t.pattern, fallPct: 1.5, fallTo: 'away from house' }));
      const tw = y.w - 0.6 - pw - 0.5;
      if (tw > 0.4) out.push(obj('turf', 'Turf strip', rectPoints(y.x0 + 0.3 + pw + 0.1, y.y0 + 0.2, tw, y.d - nook - 0.5), tier === 'economy' ? 'turf-sirwalter' : 'turf-synthetic', { underlayDepth: tier === 'economy' ? 100 : 0 }));
      if (y.w - 0.6 - pw - 0.1 - Math.max(tw, 0) > 0.25) out.push(obj('gravel', 'Gravel edge strip', rectPoints(y.x1 - 0.6, y.y0 + 0.2, 0.3, y.d - nook - 0.5), 'gravel-deco', { depth: 50 }));
      out.push(...lights(Math.min(t.lights, 5), Array.from({ length: Math.min(t.lights, 5) }, (_, i) => ({ x: y.x0 + 0.3 + pw + 0.05, y: y.y0 + 0.6 + ((y.d - nook - 1.2) * i) / Math.max(1, Math.min(t.lights, 5) - 1) }))));
      return out;
    },
  },
  {
    id: 'family-play', min: { w: 4, d: 5 }, name: 'Family play lawn', inspiredBy: 'Big open lawn for kids and pets, small paved BBQ spot and hardy plants along the fences.',
    pitch: 'Keeps the biggest possible lawn for play, a compact paved BBQ area by the house and tough low-care plants along the fences.',
    fit: (y, c) => { const why: string[] = []; let s = 45; if (c.kidsPets) { s += 35; why.push('kids or pets need lawn'); } if (y.w * y.d > 80) { s += 10; why.push(`big yard (${fmt(y.w * y.d, 0)} m²)`); } if (narrow(y)) { s -= 30; why.push('narrow yard leaves little lawn'); } return { score: s, why }; },
    layout: (y, t) => {
      const out: SiteObject[] = [], pd = Math.min(2.6, y.d * 0.22), pw = Math.min(5.5, y.w * 0.45), b = 1.0;
      out.push(obj('paving', 'BBQ patio', rectPoints(y.x0 + (y.w - pw) / 2, y.y0, pw, pd), t.paving, { pattern: t.pattern, fallPct: 1.5, fallTo: 'lawn' }));
      const lawn = clampRect(y, y.x0 + 0.3, y.y0 + pd + 0.3, y.w - 0.6, y.d - pd - b - 0.7);
      if (lawn) out.push(obj('turf', 'Play lawn', lawn, 'turf-sirwalter'));
      out.push(obj('garden', 'Fence border', rectPoints(y.x0 + 0.3, y.y1 - 0.2 - b, y.w - 0.6, b), 'soil-garden-organic', { plantId: 'plant-lomandra', plantSpacing: t.spacing }));
      if (lawn) out.push(obj('edging', 'Lawn edge', [{ x: y.x0 + 0.3, y: y.y1 - 0.4 - b }, { x: y.x1 - 0.3, y: y.y1 - 0.4 - b }], t.edging));
      out.push(...lights(Math.min(t.lights, 4), along(y.x0 + (y.w - pw) / 2, y.x0 + (y.w + pw) / 2, y.y0 + pd + 0.15, Math.min(t.lights, 4))));
      return out;
    },
  },
  {
    id: 'terraced', min: { w: 4, d: 5 }, name: 'Terraced slope', inspiredBy: 'Sloping yard levelled with a low retaining wall, lawn on the lower level and native planting above.',
    pitch: 'Levels a sloping yard with a low retaining wall: paving and lawn on the lower level, native garden on the upper level.',
    fit: (y, c) => { const why: string[] = []; let s = 25; if (c.slope) { s += 60; why.push('yard slopes: a wall creates two usable levels'); } else why.push('only needed if the yard slopes'); if (y.d < 6) s -= 15; return { score: s, why }; },
    layout: (y, t) => {
      const out: SiteObject[] = [], pd = Math.min(3, y.d * 0.25), wallY = y.y0 + y.d * 0.6;
      out.push(obj('paving', 'Lower terrace', rectPoints(y.x0 + 0.3, y.y0, y.w - 0.6, pd), t.paving, { pattern: t.pattern, fallPct: 1.5, fallTo: 'away from house (confirm outlet)' }));
      if (wallY - 0.2 - (y.y0 + pd + 0.3) > 0.8) out.push(obj('turf', 'Lower lawn', rectPoints(y.x0 + 0.8, y.y0 + pd + 0.3, y.w - 1.6, wallY - 0.2 - (y.y0 + pd + 0.3)), 'turf-sirwalter'));
      const w = t.wall(0.6);
      out.push(obj('wall', 'Retaining wall', [{ x: y.x0 + 0.5, y: wallY }, { x: y.x1 - 0.5, y: wallY }], w.materialId, { system: w.system, exposedHeight: 0.6, retainedHeight: 0.6, surcharge: 'slope' }));
      out.push(obj('garden', 'Upper garden', rectPoints(y.x0 + 0.5, wallY + 0.2, y.w - 1, y.y1 - 0.2 - wallY - 0.2), 'soil-garden-organic', { plantId: t.plant, plantSpacing: t.spacing }));
      out.push(...lights(t.lights, along(y.x0 + 1, y.x1 - 1, wallY - 0.15, t.lights)));
      out.push(obj('drain', 'Stormwater line', [{ x: y.x1 - 1, y: y.y0 + pd + 0.15 }, { x: y.x0 + 0.5, y: y.y0 + pd + 0.15 }], 'pvc-100-stormwater', { kind: 'stormwater', dischargeTo: 'Existing stormwater - NOT verified' }));
      return out;
    },
  },
];

export function rankIdeas(project: Project, c: Conditions) {
  const y = yardOf(project);
  if (!y) return [];
  return IDEAS.map(i => {
    const fits = y.w >= i.min.w && y.d >= i.min.d;
    const r = i.fit(y, c);
    return { idea: i, fits, score: fits ? r.score : -1, why: fits ? r.why : [`needs a yard at least ${i.min.w} × ${i.min.d} m; this one is ${fmt(y.w, 1)} × ${fmt(y.d, 1)} m`] };
  }).sort((a, b) => b.score - a.score);
}

/** Change list for one idea at one tier. */
export function ideaChanges(project: Project, ideaId: string, tier: Tier, materialName: (id: string) => string): Change[] {
  const y = yardOf(project);
  const idea = IDEAS.find(i => i.id === ideaId);
  if (!y || !idea || y.w < idea.min.w || y.d < idea.min.d) return [];
  return idea.layout(y, TIERS[tier], tier).map(o => {
    const g = o.points.length > 2 ? polygonArea(o.points) : 0, L = o.points.length > 1 ? polylineLength(o.points) : 0;
    const what = o.type === 'light' ? `Add ${o.name.toLowerCase()} (low-voltage)` : o.props.isStepper ? `Add ${o.name.toLowerCase()} (${materialName(o.materialId!)})`
      : ['wall', 'edging', 'drain', 'cable'].includes(o.type) ? `Add ${fmt(L, 1)} m ${o.name.toLowerCase()} (${materialName(o.materialId!)})`
        : o.type === 'firepit' ? `Add fire pit (${materialName(o.materialId!)})` : `Add ${fmt(g, 1)} m² ${o.name.toLowerCase()} (${materialName(o.materialId!)})`;
    return { id: `chg_${o.id}`, text: what, op: { op: 'addObject' as const, object: o } };
  });
}
