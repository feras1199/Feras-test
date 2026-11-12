import type { Project } from './types.ts';

export interface Step { n: number; title: string; items: string[]; hold?: string }

/** Short, crew-facing construction sequence built from what is actually in the design. */
export function constructionSequence(p: Project): Step[] {
  const has = (t: string) => p.objects.some(o => o.layer === 'proposed' && o.type === t);
  const steps: Omit<Step, 'n'>[] = [];
  steps.push({ title: 'Before starting', items: ['Before You Dig enquiry lodged and services located', 'Check set-out dimensions against this drawing on site', 'Confirm access route and protect existing surfaces', p.objects.some(o => o.type === 'tree' && o.layer === 'existing') ? 'Fence off tree protection zones' : ''].filter(Boolean), hold: 'Do not excavate until services are located.' });
  if (p.objects.some(o => o.layer === 'existing' && /demolish/i.test(String(o.props.note ?? '')))) steps.push({ title: 'Demolition', items: ['Remove items marked "to be demolished"', 'Cart away and dispose to a licensed facility'] });
  steps.push({ title: 'Set-out', items: ['Set out from the datum corner shown on the set-out plan', 'Check diagonals for square', 'Mark levels from the site datum'] });
  if (has('wall')) steps.push({ title: 'Retaining wall', items: ['Excavate for wall and drainage zone', 'Install posts / base course to the approved detail', 'Place wall units course by course', 'Lay filter fabric, ag pipe to outlet, then drainage aggregate as the wall rises', 'Backfill in layers; cap'], hold: 'Footing and post details must be on an approved engineering or manufacturer detail before pouring.' });
  if (has('drain') || has('pit')) steps.push({ title: 'Drainage', items: ['Trench to grade', 'Lay pipe and pits; connect by licensed plumber/drainer', 'Test with water before backfilling'], hold: 'Connection point and discharge to be confirmed before covering.' });
  if (has('cable') || has('light')) steps.push({ title: 'Lighting first-fix', items: ['Lay conduits / cable along the marked route before surfaces go down', 'Leave tails at each fitting position'], hold: 'Licensed electrician for any wiring work.' });
  if (has('paving')) steps.push({ title: 'Paving', items: ['Excavate to formation level', 'Place and compact base course in layers', 'Screed bedding sand', 'Lay pavers to pattern with falls away from the house', 'Install edge restraint; fill joints; compact; clean'] });
  if (has('deck')) steps.push({ title: 'Deck', items: ['Set out footings', 'Build frame to the verified span table / engineer detail', 'Fix boards with consistent gaps'], hold: 'Frame sizes and footings must be verified before building.' });
  if (has('garden') || has('plant') || has('tree')) steps.push({ title: 'Garden beds and planting', items: ['Install edging', 'Place garden soil to depth shown', 'Set out plants at spacing shown, plant and water in', 'Mulch to depth shown'] });
  if (has('turf')) steps.push({ title: 'Turf', items: ['Spread and level underlay', 'Lay turf, butt joints, roll and water in'] });
  if (has('light')) steps.push({ title: 'Lighting fit-off', items: ['Fit lights, connect and test', 'Aim and adjust at night with the customer'] });
  steps.push({ title: 'Completion', items: ['Clean site', 'Record actual quantities, hours and variations in Project Performance', 'Walk through with the customer'] });
  return steps.map((s, i) => ({ n: i + 1, ...s }));
}

const STAGE_BY_TYPE: Record<string, string> = { wall: 'Retaining wall', drain: 'Drainage', pit: 'Drainage', cable: 'Lighting first-fix', light: 'Lighting fit-off', paving: 'Paving', steps: 'Paving', deck: 'Deck', garden: 'Garden beds and planting', plant: 'Garden beds and planting', tree: 'Garden beds and planting', edging: 'Garden beds and planting', gravel: 'Garden beds and planting', turf: 'Turf' };

/** Earliest construction stage that needs each material, keyed by material id. */
export function stageByMaterial(p: Project, lines: { objectId: string; materialId?: string; kind: string }[]): Map<string, string> {
  const order = constructionSequence(p).map(s => s.title);
  const out = new Map<string, string>();
  for (const l of lines) {
    if (l.kind !== 'material' || !l.materialId) continue;
    const o = p.objects.find(x => x.id === l.objectId);
    const st = o ? STAGE_BY_TYPE[o.type] : undefined;
    if (!st) continue;
    const cur = out.get(l.materialId);
    if (!cur || order.indexOf(st) < order.indexOf(cur)) out.set(l.materialId, st);
  }
  return out;
}
