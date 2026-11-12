import type { Material, Project, QtyLine, SiteObject, Unit } from './types.ts';
import { GEOM } from './types.ts';
import { bbox, polygonArea, polylineLength } from './geometry.ts';
import { ceilInt, fmt, toPurchase } from './units.ts';

// Deterministic quantity take-off. Every line records its formula, inputs and assumptions.
// Nothing here is produced by an AI model.

export const WALL_SYSTEMS = {
  'concrete-sleeper': { label: 'Concrete sleepers + steel posts', group: 'wall-concrete-sleeper', defaultMaterial: 'slp-pioneer-2000-charcoal' },
  'segmental-block': { label: 'Segmental blocks (gravity)', group: 'wall-segmental', defaultMaterial: 'blk-versawall' },
  'sandstone-block': { label: 'Natural sandstone blocks', group: 'wall-sandstone', defaultMaterial: 'sst-blocks-m2' },
  'timber-sleeper': { label: 'Treated timber sleepers', group: 'wall-timber', defaultMaterial: 'slp-pine-2400' },
} as const;
export type WallSystem = keyof typeof WALL_SYSTEMS;

export const PATTERN_WASTE: Record<string, number> = { stack: 5, stretcher: 5, herringbone: 10, diagonal: 10, random: 7 };

/** Default editable parameters per object type. null means "unknown: must be entered", never a guess. */
export function defaultProps(type: SiteObject['type']): Record<string, any> {
  switch (type) {
    case 'wall': return { system: 'concrete-sleeper', exposedHeight: 0.6, retainedHeight: 0.6, surcharge: 'unknown', distToBoundary: null, footingDia: null, footingDepth: null, drainWidth: 0.3, outletAllowance: 3, capping: true, soil: '', engineerRef: '' };
    case 'paving': return { pattern: 'stretcher', baseDepth: 100, beddingDepth: 30, edgePct: 100, fallPct: null, fallTo: '', cutFill: null, jointCoverage: null };
    case 'garden': return { soilDepth: 300, mulchDepth: 75, plantId: '', plantSpacing: null };
    case 'turf': return { underlayDepth: 100 };
    case 'gravel': return { depth: 50 };
    case 'deck': return { height: null, joistSpacing: null, bearerSpacing: null, gap: 5, distToBoundary: null };
    case 'drain': return { kind: 'agpipe', trenchWidth: 0.3, trenchDepth: 0.4, dischargeTo: '' };
    case 'tree': return { dbh: null, retain: true, species: '', spread: 3 };
    case 'plant': return { qty: 1 };
    case 'steps': return { risers: null, riserHeight: null };
    case 'level': return { rl: null };
    case 'note': return { text: 'Note' };
    case 'fence': return { height: null };
    default: return {};
  }
}

export function defaultMaterial(type: SiteObject['type'], props: Record<string, any>): string | undefined {
  switch (type) {
    case 'wall': return WALL_SYSTEMS[(props.system as WallSystem) ?? 'concrete-sleeper'].defaultMaterial;
    case 'paving': return 'pav-travertine-610';
    case 'garden': return 'soil-garden-organic';
    case 'turf': return 'turf-sirwalter';
    case 'gravel': return 'gravel-deco';
    case 'deck': return 'deck-merbau-90';
    case 'drain': return props.kind === 'stormwater' ? 'pvc-100-stormwater' : props.kind === 'channel' ? 'channel-drain' : 'agpipe-100-20-bcs';
    case 'edging': return 'edging-steel';
    case 'cable': return 'light-cable';
    case 'light': return 'light-spike';
    case 'pit': return 'pit-450';
    case 'plant': return 'plant-lomandra';
    case 'tree': return 'tree-advanced';
    default: return undefined;
  }
}

export const objArea = (o: SiteObject) => (GEOM[o.type] === 'area' ? polygonArea(o.points) : 0);
export const objLength = (o: SiteObject) => (GEOM[o.type] === 'line' ? polylineLength(o.points) : GEOM[o.type] === 'area' ? polylineLength(o.points, true) : 0);

const num = (v: any): number | null => (v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v));

interface Ctx { project: Project; mats: Map<string, Material>; out: QtyLine[] }

function add(ctx: Ctx, o: SiteObject, component: string, opts: {
  materialId?: string; net: number | null; unit: Unit; wastePct?: number; formula: string;
  inputs?: Record<string, string>; assumptions?: string[]; source?: string; kind?: QtyLine['kind']; warning?: string; activity?: string;
}) {
  const key = `${o.id}:${component}`;
  const wastePct = opts.wastePct ?? 0;
  const assumptions = [...(opts.assumptions ?? [])];
  let gross = opts.net == null ? null : opts.net * (1 + wastePct / 100);
  const ov = ctx.project.overrides.find(v => v.key === key);
  if (ov) gross = ov.qty;
  const line: QtyLine = {
    key, objectId: o.id, objectName: o.name, component, kind: opts.kind ?? 'material', materialId: opts.materialId,
    formula: opts.formula, inputs: opts.inputs ?? {}, assumptions, net: opts.net, unit: opts.unit, wastePct, gross,
    source: opts.source ?? 'Geometry model', overridden: ov, warning: opts.warning, activity: opts.activity,
  };
  if (line.kind === 'material' && opts.materialId) {
    const m = ctx.mats.get(opts.materialId);
    if (!m) line.warning = 'Material not found in catalogue';
    else if (gross != null) {
      const p = toPurchase(m, gross, opts.unit);
      line.purchaseQty = p.qty; line.purchaseUnit = p.unit; line.purchaseNote = p.note;
      assumptions.push(...p.assumptions);
      if (p.qty == null) line.warning = p.note;
    }
  }
  ctx.out.push(line);
}

function labour(ctx: Ctx, o: SiteObject, activity: string, label: string, qty: number | null, unitLabel: string) {
  const rate = ctx.project.estimate.productivity[activity];
  const access = ctx.project.estimate.accessFactor;
  const net = qty == null || rate == null ? null : qty * rate * access;
  add(ctx, o, `Labour: ${label}`, {
    kind: 'labour', activity, net, unit: 'hr',
    formula: `quantity × productivity × access factor`,
    inputs: { quantity: qty == null ? 'unknown' : `${fmt(qty)} ${unitLabel}`, productivity: rate == null ? 'not set' : `${rate} h per ${unitLabel}`, 'access factor': String(access) },
    assumptions: ['Productivity rate is an editable assumption, not a verified market rate'],
    source: 'Estimate settings',
  });
}

function wall(ctx: Ctx, o: SiteObject) {
  const p = o.props;
  const L = polylineLength(o.points);
  const H = num(p.exposedHeight);
  const HR = num(p.retainedHeight) ?? H;
  const system: WallSystem = p.system ?? 'concrete-sleeper';
  const m = o.materialId ? ctx.mats.get(o.materialId) : undefined;
  const face = H == null ? null : L * H;
  const baseInputs = { length: `${fmt(L, 3)} m`, 'exposed height': H == null ? 'unknown' : `${fmt(H, 3)} m` };
  const corners = Math.max(0, o.points.length - 2);

  add(ctx, o, 'Wall face area', { net: face, unit: 'm2', formula: 'length × exposed height', inputs: baseInputs, kind: 'earthworks', source: 'Geometry model (reference quantity, not purchased)' });

  if (system === 'concrete-sleeper') {
    const sl = (m?.dims?.l ?? 2000) / 1000, sh = (m?.dims?.w ?? 200) / 1000;
    const spacing = sl + 0.03;
    const bays = ceilInt(L / spacing);
    const courses = H == null ? null : ceilInt(H / sh);
    add(ctx, o, 'Concrete sleepers', {
      materialId: o.materialId, net: courses == null ? null : bays * courses, unit: 'each', wastePct: 0,
      formula: 'bays × courses, where bays = ⌈length ÷ post spacing⌉ and courses = ⌈exposed height ÷ sleeper height⌉',
      inputs: { ...baseInputs, 'sleeper': `${sl} m long × ${sh} m high`, 'post spacing': `${fmt(spacing, 3)} m`, bays: String(bays), courses: courses == null ? 'unknown' : String(courses) },
      assumptions: ['Post centres = sleeper length + 30 mm (Austral Pioneer installation guide, guide only)', 'End bay may need a cut or shorter sleeper; whole sleepers counted'],
      source: 'Geometry model + manufacturer guide',
    });
    add(ctx, o, 'Steel posts', {
      materialId: p.postMaterialId || 'post-h-tbc', net: bays + 1, unit: 'each',
      formula: 'bays + 1', inputs: { bays: String(bays), 'changes of direction': String(corners) },
      assumptions: ['2 end posts plus one joiner post between bays; corner posts where the wall changes direction', 'Post section, length and embedment are NOT determined by this software'],
      source: 'Geometry model',
    });
    const fd = num(p.footingDia), fz = num(p.footingDepth);
    add(ctx, o, 'Post footing concrete', {
      materialId: 'concrete-footing', net: fd == null || fz == null ? null : (bays + 1) * Math.PI * (fd / 2) ** 2 * fz, unit: 'm3', wastePct: 10,
      formula: 'posts × π × (hole diameter ÷ 2)² × hole depth',
      inputs: { posts: String(bays + 1), 'hole diameter': fd == null ? 'unknown' : `${fd} m`, 'hole depth': fz == null ? 'unknown' : `${fz} m` },
      assumptions: ['Hole diameter and depth must be taken from an engineer or the manufacturer design table', 'Post volume not deducted'],
      warning: fd == null || fz == null ? 'Footing size not provided. Enter the engineer / manufacturer footing dimensions.' : undefined,
      source: 'Engineer-supplied dimensions',
    });
  } else if (system === 'segmental-block') {
    const bl = (m?.dims?.l ?? 400) / 1000, bh = (m?.dims?.w ?? 200) / 1000;
    const courses = H == null ? null : ceilInt(H / bh), per = ceilInt(L / bl);
    add(ctx, o, 'Wall blocks', {
      materialId: o.materialId, net: courses == null ? null : courses * per, unit: 'each', wastePct: 5,
      formula: '⌈length ÷ block length⌉ × ⌈exposed height ÷ block height⌉',
      inputs: { ...baseInputs, block: `${bl} m × ${bh} m face`, 'blocks per course': String(per), courses: courses == null ? 'unknown' : String(courses) },
      assumptions: ['5% for cuts and breakage (Adbri Masonry product calculator)', 'Buried or embedded base course not included unless added to exposed height'],
      source: 'Geometry model + manufacturer data',
    });
    if (p.capping) add(ctx, o, 'Capping units', {
      materialId: 'cap-versawall', net: L, unit: 'lm', wastePct: 5, formula: 'wall length', inputs: { length: `${fmt(L, 3)} m` },
      assumptions: ['5% for cuts'], source: 'Geometry model',
    });
  } else if (system === 'sandstone-block') {
    if (m?.unit === 'each' && m.dims?.l && m.dims?.w) {
      const bl = m.dims.l / 1000, bh = m.dims.w / 1000;
      const courses = H == null ? null : ceilInt(H / bh), per = ceilInt(L / bl);
      add(ctx, o, 'Sandstone blocks', {
        materialId: o.materialId, net: courses == null ? null : courses * per, unit: 'each', wastePct: 0,
        formula: '⌈length ÷ block length⌉ × ⌈exposed height ÷ block height⌉',
        inputs: { ...baseInputs, block: `${bl} m × ${bh} m face`, 'blocks per course': String(per), courses: courses == null ? 'unknown' : String(courses) },
        assumptions: ['Whole blocks counted; natural stone sizes vary'], source: 'Geometry model',
      });
    } else {
      add(ctx, o, 'Sandstone blocks', {
        materialId: o.materialId, net: face, unit: 'm2', wastePct: 10, formula: 'length × exposed height', inputs: baseInputs,
        assumptions: ['10% allowance for selection and trimming of natural stone (assumption)'], source: 'Geometry model',
      });
    }
  } else if (system === 'timber-sleeper') {
    const sl = (m?.dims?.l ?? 2400) / 1000, sh = (m?.dims?.w ?? 200) / 1000;
    const courses = H == null ? null : ceilInt(H / sh), per = ceilInt(L / sl);
    add(ctx, o, 'Timber sleepers (horizontal)', {
      materialId: o.materialId, net: courses == null ? null : courses * per, unit: 'each', wastePct: 5,
      formula: '⌈length ÷ sleeper length⌉ × ⌈exposed height ÷ sleeper height⌉',
      inputs: { ...baseInputs, 'sleepers per course': String(per), courses: courses == null ? 'unknown' : String(courses) },
      assumptions: ['Posts are not counted: post spacing and embedment need a verified design'],
      warning: 'Post quantity not calculated. A verified design is needed for post size, spacing and depth.', source: 'Geometry model',
    });
  }

  // Drainage behind the wall (applies to all systems as a concept allowance)
  const dw = num(p.drainWidth) ?? 0.3;
  add(ctx, o, 'Drainage aggregate behind wall', {
    materialId: 'agg-bluemetal-20', net: HR == null ? null : L * dw * HR, unit: 'm3', wastePct: 10,
    formula: 'length × drainage zone width × retained height',
    inputs: { length: `${fmt(L, 3)} m`, 'zone width': `${dw} m`, 'retained height': HR == null ? 'unknown' : `${fmt(HR, 3)} m` },
    assumptions: ['Drainage zone at least 300 mm wide of 10 to 20 mm aggregate (Adbri Masonry installation guide). Confirm against the system actually used.', '10% allowance for spillage and settlement (assumption)'],
    source: 'Geometry model + manufacturer guide',
  });
  const oa = num(p.outletAllowance) ?? 0;
  add(ctx, o, 'Subsoil drain (ag pipe)', {
    materialId: p.agpipeId || 'agpipe-100-20-bcs', net: L + oa, unit: 'lm', formula: 'wall length + outlet allowance',
    inputs: { length: `${fmt(L, 3)} m`, 'outlet allowance': `${oa} m` },
    assumptions: ['Outlet run length is an allowance; the discharge point must be confirmed on site'], source: 'Geometry model',
  });
  add(ctx, o, 'Geotextile filter fabric', {
    materialId: 'geo-2000x50', net: HR == null ? null : L * (HR + 2 * dw), unit: 'm2', wastePct: 10,
    formula: 'length × (retained height + 2 × zone width)',
    inputs: { length: `${fmt(L, 3)} m`, 'retained height': HR == null ? 'unknown' : `${fmt(HR, 3)} m`, 'zone width': `${dw} m` },
    assumptions: ['Fabric lines the back of the drainage zone and laps over the top (assumption)', '10% for laps'], source: 'Geometry model',
  });
  add(ctx, o, 'Excavation for wall and drainage zone', {
    kind: 'earthworks', net: HR == null ? null : L * (dw + 0.15) * HR, unit: 'm3',
    formula: 'length × (zone width + 0.15 m wall allowance) × retained height',
    inputs: { length: `${fmt(L, 3)} m`, 'retained height': HR == null ? 'unknown' : `${fmt(HR, 3)} m` },
    assumptions: ['Assumes cut is limited to the wall and drainage zone. Actual cut depends on existing levels, which need a level survey.'], source: 'Geometry model',
  });
  labour(ctx, o, `wall.${system}`, 'build wall', face, 'm²');
}

function paving(ctx: Ctx, o: SiteObject) {
  const p = o.props, A = polygonArea(o.points), P = polylineLength(o.points, true);
  const m = o.materialId ? ctx.mats.get(o.materialId) : undefined;
  const waste = num(p.wastePct) ?? PATTERN_WASTE[p.pattern] ?? 5;
  const base = (num(p.baseDepth) ?? 0) / 1000, bed = (num(p.beddingDepth) ?? 0) / 1000, pt = (m?.dims?.t ?? 0) / 1000;
  const a = { area: `${fmt(A, 3)} m²` };
  add(ctx, o, 'Pavers', {
    materialId: o.materialId, net: A, unit: 'm2', wastePct: waste, formula: 'paved area', inputs: { ...a, pattern: p.pattern },
    assumptions: [`${waste}% cutting waste for ${p.pattern} pattern (assumption; increase for curves and small pieces)`], source: 'Geometry model',
  });
  add(ctx, o, 'Base course', {
    materialId: 'base-roadbase-recycled', net: A * base, unit: 'm3', wastePct: 10, formula: 'area × compacted base depth',
    inputs: { ...a, 'base depth': `${num(p.baseDepth)} mm` },
    assumptions: ['Base depth is a pedestrian-paving allowance (BC Sands product guidance: 100 mm). Vehicle areas and poor subgrades need a designed pavement.', '10% allowance for compaction and spillage (assumption)'],
    source: 'Geometry model + supplier guidance',
  });
  add(ctx, o, 'Bedding sand', {
    materialId: 'sand-bedding', net: A * bed, unit: 'm3', wastePct: 10, formula: 'area × bedding depth',
    inputs: { ...a, 'bedding depth': `${num(p.beddingDepth)} mm` }, assumptions: ['10% allowance (assumption)'], source: 'Geometry model',
  });
  const jc = num(p.jointCoverage);
  add(ctx, o, 'Jointing sand', {
    materialId: 'sand-jointing', net: jc == null ? null : A / jc, unit: 'bag', formula: 'area ÷ coverage per bag',
    inputs: { ...a, coverage: jc == null ? 'unknown' : `${jc} m² per bag` },
    warning: jc == null ? 'Enter the jointing sand coverage from the product datasheet.' : undefined, source: 'Product datasheet (user-entered)',
  });
  const ep = num(p.edgePct) ?? 100;
  add(ctx, o, 'Edge restraint', {
    materialId: 'edge-restraint', net: (P * ep) / 100, unit: 'lm', formula: 'perimeter × restrained share',
    inputs: { perimeter: `${fmt(P, 3)} m`, 'restrained share': `${ep}%` },
    assumptions: ['Reduce the share where paving abuts a wall or building'], source: 'Geometry model',
  });
  add(ctx, o, 'Excavation for paving', {
    kind: 'earthworks', net: A * (base + bed + pt), unit: 'm3', formula: 'area × (base + bedding + paver thickness)',
    inputs: { ...a, depth: `${fmt((base + bed + pt) * 1000, 0)} mm` },
    assumptions: ['Assumes finished surface at existing ground level. Cut and fill to design levels are not included.'], source: 'Geometry model',
  });
  labour(ctx, o, 'paving', 'prepare base and lay paving', A, 'm²');
}

function garden(ctx: Ctx, o: SiteObject) {
  const p = o.props, A = polygonArea(o.points);
  const sd = (num(p.soilDepth) ?? 0) / 1000, md = (num(p.mulchDepth) ?? 0) / 1000;
  const a = { area: `${fmt(A, 3)} m²` };
  add(ctx, o, 'Garden soil', { materialId: o.materialId || 'soil-garden-organic', net: A * sd, unit: 'm3', wastePct: 5, formula: 'area × soil depth', inputs: { ...a, 'soil depth': `${num(p.soilDepth)} mm` }, assumptions: ['Soil depth is an editable assumption', '5% settlement allowance (assumption)'] });
  add(ctx, o, 'Mulch', { materialId: 'mulch', net: A * md, unit: 'm3', formula: 'area × mulch depth', inputs: { ...a, 'mulch depth': `${num(p.mulchDepth)} mm` }, assumptions: ['Mulch depth is an editable assumption'] });
  const sp = num(p.plantSpacing);
  if (p.plantId) add(ctx, o, 'Plants', {
    materialId: p.plantId, net: sp == null || sp <= 0 ? null : ceilInt(A / (sp * sp)), unit: 'each', formula: '⌈area ÷ spacing²⌉',
    inputs: { ...a, spacing: sp == null ? 'unknown' : `${sp} m centres` }, assumptions: ['Square grid spacing'], warning: sp == null ? 'Enter plant spacing.' : undefined,
  });
  labour(ctx, o, 'garden', 'prepare bed, place soil and mulch', A, 'm²');
  if (p.plantId && sp) labour(ctx, o, 'planting', 'planting', ceilInt(A / (sp * sp)), 'plant');
}

function deck(ctx: Ctx, o: SiteObject) {
  const p = o.props, A = polygonArea(o.points), b = bbox(o.points);
  const m = o.materialId ? ctx.mats.get(o.materialId) : undefined;
  const bw = m?.dims?.w ?? 90, gap = num(p.gap) ?? 5;
  add(ctx, o, 'Decking boards', {
    materialId: o.materialId, net: A / ((bw + gap) / 1000), unit: 'lm', wastePct: 10, formula: 'area ÷ (board width + gap)',
    inputs: { area: `${fmt(A, 3)} m²`, 'board width': `${bw} mm`, gap: `${gap} mm` }, assumptions: ['10% for end cuts and docking (assumption)'],
  });
  const js = num(p.joistSpacing), bs = num(p.bearerSpacing);
  const joists = js ? (ceilInt(b.w / js) + 1) * b.h : null;
  const bearers = bs ? (ceilInt(b.h / bs) + 1) * b.w : null;
  add(ctx, o, 'Framing (joists + bearers)', {
    materialId: 'deck-framing', net: joists == null || bearers == null ? null : joists + bearers, unit: 'lm', wastePct: 10,
    formula: '(⌈width ÷ joist spacing⌉ + 1) × depth + (⌈depth ÷ bearer spacing⌉ + 1) × width',
    inputs: { 'bounding size': `${fmt(b.w)} × ${fmt(b.h)} m`, 'joist spacing': js == null ? 'unknown' : `${js} m`, 'bearer spacing': bs == null ? 'unknown' : `${bs} m` },
    assumptions: ['Quantity allowance only. Member sizes, spans, footings and fixings must come from AS 1684 span tables, the board manufacturer or an engineer.'],
    warning: joists == null || bearers == null ? 'Enter joist and bearer spacing from a verified span table.' : undefined,
  });
  labour(ctx, o, 'deck', 'build deck', A, 'm²');
}

function simpleLine(ctx: Ctx, o: SiteObject) {
  const L = polylineLength(o.points), p = o.props;
  if (o.type === 'drain') {
    add(ctx, o, 'Drainage pipe / channel', { materialId: o.materialId, net: L, unit: 'lm', wastePct: 5, formula: 'drawn length', inputs: { length: `${fmt(L, 3)} m` }, assumptions: ['5% for joints and offcuts (assumption)', 'Concept route only. Pipe size, grade and discharge need verification.'] });
    const tw = num(p.trenchWidth) ?? 0, td = num(p.trenchDepth) ?? 0;
    add(ctx, o, 'Trench excavation', { kind: 'earthworks', net: L * tw * td, unit: 'm3', formula: 'length × trench width × trench depth', inputs: { length: `${fmt(L, 3)} m`, width: `${tw} m`, depth: `${td} m` }, assumptions: ['Trench size is an editable assumption'] });
    labour(ctx, o, 'drain', 'trench and lay drainage', L, 'm');
  } else if (o.type === 'edging') {
    add(ctx, o, 'Garden edging', { materialId: o.materialId, net: L, unit: 'lm', wastePct: 5, formula: 'drawn length', inputs: { length: `${fmt(L, 3)} m` }, assumptions: ['5% for cuts (assumption)'] });
    labour(ctx, o, 'edging', 'install edging', L, 'm');
  } else if (o.type === 'cable') {
    add(ctx, o, 'Lighting cable', { materialId: o.materialId, net: L, unit: 'lm', wastePct: 10, formula: 'drawn route length', inputs: { length: `${fmt(L, 3)} m` }, assumptions: ['10% for connections and slack (assumption)', 'Preliminary route. Electrical work must be done or certified by a licensed electrician where required.'] });
  }
}

export function takeoff(project: Project, materials: Material[]): QtyLine[] {
  const ctx: Ctx = { project, mats: new Map(materials.map(m => [m.id, m])), out: [] };
  for (const o of project.objects) {
    if (o.layer !== 'proposed') continue;
    switch (o.type) {
      case 'wall': wall(ctx, o); break;
      case 'paving': paving(ctx, o); break;
      case 'garden': garden(ctx, o); break;
      case 'deck': deck(ctx, o); break;
      case 'turf': {
        const A = polygonArea(o.points), d = (num(o.props.underlayDepth) ?? 0) / 1000;
        add(ctx, o, 'Turf', { materialId: o.materialId, net: A, unit: 'm2', wastePct: 5, formula: 'turf area', inputs: { area: `${fmt(A, 3)} m²` }, assumptions: ['5% for trimming (assumption)'] });
        add(ctx, o, 'Turf underlay', { materialId: 'soil-turf-underlay', net: A * d, unit: 'm3', wastePct: 5, formula: 'area × underlay depth', inputs: { area: `${fmt(A, 3)} m²`, depth: `${num(o.props.underlayDepth)} mm` }, assumptions: ['Underlay depth is an editable assumption'] });
        labour(ctx, o, 'turf', 'prepare and lay turf', A, 'm²');
        break;
      }
      case 'gravel': {
        const A = polygonArea(o.points), d = (num(o.props.depth) ?? 0) / 1000;
        add(ctx, o, 'Decorative gravel', { materialId: o.materialId, net: A * d, unit: 'm3', wastePct: 5, formula: 'area × depth', inputs: { area: `${fmt(A, 3)} m²`, depth: `${num(o.props.depth)} mm` }, assumptions: ['Depth is an editable assumption'] });
        add(ctx, o, 'Geotextile under gravel', { materialId: 'geo-2000x50', net: A, unit: 'm2', wastePct: 10, formula: 'area', inputs: { area: `${fmt(A, 3)} m²` }, assumptions: ['10% for laps'] });
        labour(ctx, o, 'garden', 'spread gravel', A, 'm²');
        break;
      }
      case 'steps': {
        const A = polygonArea(o.points);
        add(ctx, o, 'Step treads (plan area)', { materialId: o.materialId, net: A, unit: 'm2', wastePct: 10, formula: 'plan area', inputs: { area: `${fmt(A, 3)} m²` }, assumptions: ['Risers, going and landing dimensions must be checked against the NCC before construction'] });
        labour(ctx, o, 'paving', 'build steps', A, 'm²');
        break;
      }
      case 'drain': case 'edging': case 'cable': simpleLine(ctx, o); break;
      case 'light':
        add(ctx, o, 'Light fitting', { materialId: o.materialId, net: 1, unit: 'each', formula: 'count', source: 'Drawing' });
        labour(ctx, o, 'light', 'install fitting', 1, 'fitting');
        break;
      case 'pit':
        add(ctx, o, 'Drainage pit', { materialId: o.materialId, net: 1, unit: 'each', formula: 'count', source: 'Drawing' });
        labour(ctx, o, 'pit', 'install pit', 1, 'pit');
        break;
      case 'plant': {
        const q = num(o.props.qty) ?? 1;
        add(ctx, o, 'Plants', { materialId: o.materialId, net: q, unit: 'each', formula: 'quantity entered', inputs: { quantity: String(q) }, source: 'Drawing' });
        labour(ctx, o, 'planting', 'planting', q, 'plant');
        break;
      }
      case 'tree':
        add(ctx, o, 'Tree', { materialId: o.materialId, net: 1, unit: 'each', formula: 'count', source: 'Drawing' });
        labour(ctx, o, 'tree', 'plant tree', 1, 'tree');
        break;
    }
  }
  return ctx.out;
}

/** Combine purchase lines for the same product across objects, then re-apply purchase rounding once. */
export function purchaseSchedule(lines: QtyLine[], materials: Material[]) {
  const mats = new Map(materials.map(m => [m.id, m]));
  const groups = new Map<string, { material: Material; unit: Unit; gross: number; unknown: boolean; from: string[] }>();
  for (const l of lines) {
    if (l.kind !== 'material' || !l.materialId) continue;
    const m = mats.get(l.materialId);
    if (!m) continue;
    const k = `${l.materialId}|${l.unit}`;
    const g = groups.get(k) ?? { material: m, unit: l.unit, gross: 0, unknown: false, from: [] };
    if (l.gross == null) g.unknown = true; else g.gross += l.gross;
    g.from.push(`${l.objectName}: ${l.component}`);
    groups.set(k, g);
  }
  return [...groups.entries()].map(([key, g]) => {
    if (g.unknown) return { key, material: g.material, designQty: null as number | null, designUnit: g.unit, purchaseQty: null as number | null, purchaseUnit: g.material.unit, note: 'Missing input: see bill of quantities', assumptions: [] as string[], incomplete: true, from: g.from };
    const p = toPurchase(g.material, g.gross, g.unit);
    return { key, material: g.material, designQty: g.gross as number | null, designUnit: g.unit, purchaseQty: p.qty, purchaseUnit: p.unit, note: p.note, assumptions: p.assumptions, incomplete: p.qty == null, from: g.from };
  });
}
