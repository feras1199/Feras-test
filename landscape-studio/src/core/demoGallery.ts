import type { CompanySettings, DesignProposal, Material, Project, ProposalBrief, Supplier } from './types.ts';
import { newProject } from './project.ts';
import { rectPoints } from './geometry.ts';
import { defaultProps } from './assemblies.ts';
import { applyProposal, generateProposals, selectProposal } from './proposals.ts';
import { DEMO_ID } from './demo.ts';

// Three SYNTHETIC demo jobs built on real, freely licensed backyard photos (Wikimedia Commons).
// The photos are only pictures of the "before" yard. Site dimensions, customers, budgets and
// choices are invented for demonstration and labelled as such. The photos are not Sydney yards.

export interface PhotoCredit { file: string; title: string; license: string; author: string; source: string }

export const DEMO_PHOTOS: Record<string, PhotoCredit> = {
  'lawn-open.jpg': { file: 'lawn-open.jpg', title: 'Backyard Lawn Trees Hancock Village Brookline Town Massachusetts New England.jpg', license: 'CC BY-SA 4.0', author: 'EgorovaSvetlana', source: 'https://commons.wikimedia.org/wiki/File:Backyard_Lawn_Trees_Hancock_Village_Brookline_Town_Massachusetts_New_England.jpg' },
  'autumn-patio.jpg': { file: 'autumn-patio.jpg', title: 'Autumn backyard in Kleinburg (15807322738).jpg', license: 'CC BY 2.0', author: 'Cinzia P.', source: 'https://commons.wikimedia.org/wiki/File:Autumn_backyard_in_Kleinburg_(15807322738).jpg' },
  'garden-beds.jpg': { file: 'garden-beds.jpg', title: 'Backyard Garden1.JPG', license: 'Public domain', author: 'Klar at English Wikipedia', source: 'https://commons.wikimedia.org/wiki/File:Backyard_Garden1.JPG' },
};

export const credit = (c: PhotoCredit) => `Photo: "${c.title}" by ${c.author}, ${c.license}, via Wikimedia Commons (${c.source}). Not a Sydney site; used as a sample "before" photo.`;

export interface GalleryDemo {
  id: string; title: string; customer: string; photo: string; pick: DesignProposal['tier'];
  story: string; site: { w: number; d: number; houseW: number; houseD: number; tree?: { x: number; y: number; dbh: number; spread: number } };
  brief: ProposalBrief; afterApply?: (p: Project) => void;
}

export const GALLERY: GalleryDemo[] = [
  {
    id: 'prj_demo_family', title: 'DEMO A (synthetic): Young family, big flat lawn', customer: 'The Nguyen family (synthetic)', photo: 'lawn-open.jpg', pick: 'economy',
    story: 'Two kids and a dog. Wants a big lawn to play on, a small paved spot for the BBQ, tough plants along the fence and some path lights. Flat block, tight budget.',
    site: { w: 16, d: 14, houseW: 11, houseD: 1.5, tree: { x: 13.5, y: 11.5, dbh: 0.45, spread: 6 } },
    brief: { style: 'Low-maintenance', inclusions: ['paving', 'turf', 'garden', 'lighting', 'drainage'], budgetMax: 22000, constraints: 'Keep the big tree at the back. Dog-safe plants. Flat block.', sourceMediaIds: [] },
  },
  {
    id: 'prj_demo_entertainer', title: 'DEMO B (synthetic): Small courtyard for entertaining', customer: 'Sarah & Tom Kelly (synthetic)', photo: 'autumn-patio.jpg', pick: 'premium',
    story: 'Couple who host friends every weekend. Small yard. Wants a large stone entertaining area, a timber deck off the living room, a low feature wall with planting behind it and layered lighting. Happy to spend for quality.',
    site: { w: 10, d: 9, houseW: 10, houseD: 1.2 },
    brief: { style: 'Luxury', inclusions: ['paving', 'wall', 'garden', 'lighting', 'drainage', 'deck'], budgetMax: 55000, constraints: 'Side access only 1 m wide. Wants it ready before summer.', sourceMediaIds: [] },
  },
  {
    id: 'prj_demo_slope', title: 'DEMO C (synthetic): Sloping garden, retirees', customer: 'Margaret & John Ellis (synthetic)', photo: 'garden-beds.jpg', pick: 'balanced',
    story: 'Retired couple. The back half of the yard slopes up about 0.9 m. They want it terraced with a retaining wall, natural stone look, native gardens that need little care, and safe even paving near the house.',
    site: { w: 18, d: 15, houseW: 12, houseD: 1.5, tree: { x: 2.5, y: 13, dbh: 0.3, spread: 4 } },
    brief: { style: 'Sydney sandstone', inclusions: ['paving', 'wall', 'turf', 'garden', 'lighting', 'drainage'], budgetMax: 60000, constraints: 'Slope about 0.9 m at the back (estimated from photo). Prefer low maintenance. Keep the gum tree.', sourceMediaIds: [] },
    afterApply: p => { const w = p.objects.find(o => o.type === 'wall'); if (w) { w.props.exposedHeight = 0.9; w.props.retainedHeight = 0.9; w.props.surcharge = 'slope'; } },
  },
];

/** Builds a demo job. The photo itself is stored by the caller (it lives in public/demo). */
export function buildGalleryDemo(d: GalleryDemo, materials: Material[], suppliers: Supplier[], settings: CompanySettings): Project {
  let p = newProject(d.title);
  p.id = d.id; p.synthetic = true;
  p.customer = { id: `cus_${d.id}`, name: d.customer, phone: '0400 000 000', email: 'demo@example.com' };
  p.site = { address: 'Synthetic demo address', suburb: 'Sydney (assumed)', council: 'Northern Beaches Council', lotAreaM2: null, access: d.id === 'prj_demo_entertainer' ? 'restricted' : 'easy', heritage: 'no', floodControlLot: 'no', bushfire: 'unknown', easements: 'unknown', nearWaterbody: 'no', conditions: d.brief.constraints };
  p.brief = { description: d.story, scope: d.brief.inclusions.join(', '), budgetMin: null, budgetMax: d.brief.budgetMax, preferredMaterials: d.brief.style, targetCompletion: '', notes: 'Synthetic demo. Dimensions are invented, not measured from the photo.' };
  const mediaId = `med_${d.id}_photo`;
  const c = DEMO_PHOTOS[d.photo];
  p.media = [{ id: mediaId, name: `Before photo (${c.license}).jpg`, kind: 'photo', mime: 'image/jpeg', size: 0, addedAt: new Date().toISOString(), note: credit(c), tags: [] }];
  const { w, d: dep, houseW, houseD, tree } = d.site;
  const obj = (type: any, name: string, points: any, extra: any = {}, props: any = {}) => ({ id: `${d.id}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, type, name, layer: 'existing' as const, points, confidence: 'estimated' as const, props: { ...defaultProps(type), ...props }, ...extra });
  p.objects = [
    obj('boundary', 'Site outline', rectPoints(0, 0, w, dep), { confidence: 'verified', locked: true }),
    obj('building', 'House', rectPoints((w - houseW) / 2, 0, houseW, houseD), { locked: true }),
    obj('fence', 'Rear fence', [{ x: 0, y: dep }, { x: w, y: dep }]),
    ...(tree ? [obj('tree', 'Existing tree', [{ x: tree.x, y: tree.y }], {}, { dbh: tree.dbh, spread: tree.spread, retain: true })] : []),
  ];
  p.measurements = [
    { id: `${d.id}_m1`, label: 'Yard width', value: w, method: 'laser', source: 'Synthetic demo data', confidence: 'verified', date: '2026-11-16', verifiedBy: 'Demo', link: { objectId: `${d.id}_site_outline`, a: 0, b: 1 } },
    { id: `${d.id}_m2`, label: 'Yard depth', value: dep, method: 'laser', source: 'Synthetic demo data', confidence: 'verified', date: '2026-11-16', verifiedBy: 'Demo', link: { objectId: `${d.id}_site_outline`, a: 1, b: 2 } },
  ];
  // Same labelled demo allowances as the main demo, so the totals are comparable.
  p.priceAssumptions = Object.fromEntries(['sand-bedding:120', 'edge-restraint:12', 'mulch:110', 'plant-lomandra:9', 'plant-westringia:16', 'pvc-100-stormwater:14', 'pit-450:95', 'light-cable:4', 'light-spike:85', 'post-h-tbc:85', 'sand-jointing:25', 'deck-merbau-90:14', 'deck-framing:9', 'edging-steel:28', 'sst-stonefront-quote:260']
    .map(s => s.split(':')).map(([k, v]) => [k, { price: Number(v), note: 'DEMO ASSUMPTION, not a supplier price' }]));
  p.estimate.extras = [
    { id: 'x1', category: 'equipment', desc: 'Mini excavator hire, dry (ASSUMPTION)', qty: d.id === 'prj_demo_entertainer' ? 0 : 1, unit: 'day', rate: 400, assumption: true },
    { id: 'x2', category: 'disposal', desc: 'Spoil cart-away and tipping (ASSUMPTION rate)', qty: 6, unit: 'm3', rate: 90, assumption: true },
    { id: 'x3', category: 'delivery', desc: 'Delivery allowance, 3 suppliers (ASSUMPTION)', qty: 3, unit: 'order', rate: 120, assumption: true },
    { id: 'x4', category: 'subcontract', desc: 'Licensed electrician: lighting connection (ASSUMPTION)', qty: 1, unit: 'item', rate: 600, assumption: true },
  ];
  if (p.site.access === 'restricted') p.estimate.accessFactor = 1.15;
  const brief = { ...d.brief, sourceMediaIds: [mediaId] };
  p.proposals = generateProposals(p, brief, materials, suppliers, settings).proposals;
  p.status = 'concept';
  const chosen = p.proposals.find(x => x.tier === d.pick)!;
  p = selectProposal(p, chosen.id, d.customer, 'Demo');
  p = applyProposal(p, chosen.id, chosen.changes.map(c => c.id), 'Demo');
  d.afterApply?.(p);
  p.audit.push({ at: new Date().toISOString(), by: 'system', action: `Synthetic demo: ${d.customer} chose ${chosen.title}` });
  return p;
}

export const GALLERY_IDS = [DEMO_ID, ...GALLERY.map(g => g.id)];
