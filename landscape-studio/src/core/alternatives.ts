import type { Material, Project, SiteObject, Supplier } from './types.ts';
import { takeoff } from './assemblies.ts';
import { computeEstimate, type Estimate } from './estimate.ts';
import { evaluateCompliance } from './compliance.ts';
import type { CompanySettings } from './types.ts';

export interface Alternative {
  tier: 'economy' | 'balanced' | 'premium'; name: string; objects: SiteObject[]; changes: string[];
  pros: string[]; cons: string[]; maintenance: string; estimate: Estimate; flags: string[]; assumptions: string[];
}

const PLAN: Record<Alternative['tier'], { name: string; wall: (h: number) => { system: string; materialId: string }; paving: string; edging: string; pattern: string; pros: string[]; cons: string[]; maintenance: string }> = {
  economy: {
    name: 'Economy',
    wall: h => (h <= 0.8 ? { system: 'segmental-block', materialId: 'blk-versawall' } : { system: 'concrete-sleeper', materialId: 'slp-pioneer-2000-charcoal' }),
    paving: 'pav-concrete-400', edging: 'edging-steel', pattern: 'stretcher',
    pros: ['Lowest material cost', 'Common products with short lead times', 'Simple laying patterns keep labour and cutting waste down'],
    cons: ['Plainer appearance', 'Concrete pavers can fade and show efflorescence', 'Segmental blocks are limited to low walls without engineering'],
    maintenance: 'Low. Occasional pressure clean and re-sanding of paver joints.',
  },
  balanced: {
    name: 'Balanced',
    wall: () => ({ system: 'concrete-sleeper', materialId: 'slp-pioneer-2000-charcoal' }),
    paving: 'pav-travertine-610', edging: 'edging-steel', pattern: 'stretcher',
    pros: ['Natural stone paving as the main visual feature', 'Concrete sleepers are durable and fast to install', 'Good value per square metre'],
    cons: ['Travertine needs sealing and is softer than porcelain or granite', 'Sleeper walls need steel posts with engineered embedment'],
    maintenance: 'Moderate. Seal travertine at installation and periodically after.',
  },
  premium: {
    name: 'Premium',
    wall: () => ({ system: 'sandstone-block', materialId: 'sst-blocks-m2' }),
    paving: 'pav-sandstone-600x400', edging: 'edging-sandstone', pattern: 'random',
    pros: ['Sydney sandstone character throughout', 'High perceived value', 'Wall and paving match'],
    cons: ['Highest material and labour cost', 'Heavy units need machine access or more labour', 'Natural stone varies in colour and size; sandstone marks and needs sealing'],
    maintenance: 'Moderate to high. Seal sandstone; clean organic staining in shaded areas.',
  },
};

export function generateAlternatives(project: Project, materials: Material[], suppliers: Supplier[], settings: CompanySettings): Alternative[] {
  return (Object.keys(PLAN) as Alternative['tier'][]).map(tier => {
    const plan = PLAN[tier];
    const changes: string[] = [];
    const objects = structuredClone(project.objects).map(o => {
      if (o.layer !== 'proposed') return o;
      const mname = (id?: string) => materials.find(m => m.id === id)?.name ?? id;
      if (o.type === 'wall') {
        const h = Number(o.props.retainedHeight ?? o.props.exposedHeight ?? 0);
        const w = plan.wall(h);
        if (o.props.system !== w.system || o.materialId !== w.materialId) changes.push(`${o.name}: ${mname(w.materialId)}`);
        o.props.system = w.system; o.materialId = w.materialId;
      } else if (o.type === 'paving') {
        if (o.materialId !== plan.paving) changes.push(`${o.name}: ${mname(plan.paving)}, ${plan.pattern} pattern`);
        o.materialId = plan.paving; o.props.pattern = plan.pattern; delete o.props.wastePct;
      } else if (o.type === 'edging') {
        if (o.materialId !== plan.edging) changes.push(`${o.name}: ${mname(plan.edging)}`);
        o.materialId = plan.edging;
      }
      return o;
    });
    const p2 = { ...project, objects };
    const lines = takeoff(p2, materials);
    const estimate = computeEstimate(p2, lines, materials, suppliers);
    const checks = evaluateCompliance(p2, estimate.priceInc, settings);
    return {
      tier, name: plan.name, objects, changes: changes.length ? changes : ['Same materials as the current design'],
      pros: plan.pros, cons: plan.cons, maintenance: plan.maintenance, estimate,
      flags: checks.filter(c => c.status === 'potential' && c.objectId).map(c => `${c.title}: ${c.result}`),
      assumptions: ['Layout and dimensions identical to the current drawing', 'Labour productivity and rates from Estimate settings (assumptions)', ...(estimate.flags.length ? [`${estimate.flags.length} pricing gaps: total excludes unpriced items`] : [])],
    };
  });
}
