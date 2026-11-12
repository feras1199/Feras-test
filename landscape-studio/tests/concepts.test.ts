import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { demoProject } from '../src/core/demo.ts';
import { SEED_MATERIALS as M, SEED_SUPPLIERS as S } from '../src/core/catalogue.ts';
import { DEFAULT_SETTINGS, newProject } from '../src/core/project.ts';
import { applyProposal, generateProposals, ILLUSTRATIVE_LABEL, selectProposal } from '../src/core/proposals.ts';
import { takeoff } from '../src/core/assemblies.ts';
import { computeEstimate } from '../src/core/estimate.ts';
import { assemblyFor, ENGINEER_REQUIRED } from '../src/core/layers.ts';
import { quoteBlockers, statusChangeError } from '../src/core/approval.ts';
import { isoScene, MASSING_LABEL } from '../src/core/iso.ts';
import { buildSheets } from '../src/core/exports/sheets.ts';
import { sheetsToPdf } from '../src/core/exports/render.ts';
import { evaluateCompliance, issueBlockers } from '../src/core/compliance.ts';
import { guidedMeasurements } from '../src/core/validation.ts';
import { polygonArea, resizeRectangle } from '../src/core/geometry.ts';
import { stageByMaterial } from '../src/core/sequence.ts';
import type { Project, ProposalBrief } from '../src/core/types.ts';

const BRIEF: ProposalBrief = { style: 'Modern', inclusions: ['paving', 'wall', 'turf', 'garden', 'lighting', 'drainage'], budgetMax: 30000, constraints: '', sourceMediaIds: ['med_photo1'] };
/** Demo site with the proposed design removed: only the measured existing site remains. */
const bareSite = (): Project => { const p = demoProject(); p.objects = p.objects.filter(o => o.layer === 'existing'); p.measurements = p.measurements.filter(m => !m.link || p.objects.some(o => o.id === m.link!.objectId)); return p; };
const est = (p: Project) => computeEstimate(p, takeoff(p, M), M, S);

describe('design proposals', () => {
  it('Economy, Balanced and Premium are distinct structured proposals with real geometry changes', () => {
    const r = generateProposals(bareSite(), BRIEF, M, S, DEFAULT_SETTINGS);
    expect(r.error).toBeUndefined();
    const [e, b, pr] = r.proposals;
    expect(r.proposals.map(x => x.tier)).toEqual(['economy', 'balanced', 'premium']);
    for (const x of r.proposals) {
      expect(x.changes.some(c => c.op.op === 'addObject' && c.op.object.type === 'paving')).toBe(true);
      expect(x.changes.some(c => c.op.op === 'addObject' && c.op.object.type === 'wall')).toBe(true);
      expect(x.costLow).toBeGreaterThan(0);
      expect(x.costHigh).toBeGreaterThan(x.costLow);
      expect(x.reviewFlags.join(' ')).toMatch(/Structural review|Underground services/);
    }
    const paving = (x: typeof e) => x.changes.find(c => c.op.op === 'addObject' && c.op.object.type === 'paving')!.op as any;
    expect(paving(e).object.materialId).not.toBe(paving(pr).object.materialId);
    expect(polygonArea(paving(pr).object.points)).toBeGreaterThan(polygonArea(paving(e).object.points));
    expect(e.costLow).toBeLessThan(b.costLow);
    expect(b.costLow).toBeLessThan(pr.costLow);
    expect(ILLUSTRATIVE_LABEL).toMatch(/not surveyed, not to scale, not for construction/);
  });

  it('is refused without a drawn site outline (photos never create geometry)', () => {
    const r = generateProposals(newProject(), BRIEF, M, S, DEFAULT_SETTINGS);
    expect(r.proposals).toEqual([]);
    expect(r.error).toMatch(/Draw the site outline/);
  });

  it('with an existing design, proposals change materials only and keep dimensions', () => {
    const p = demoProject();
    const r = generateProposals(p, BRIEF, M, S, DEFAULT_SETTINGS);
    for (const x of r.proposals) for (const c of x.changes) expect(['setMaterial', 'setWallSystem', 'setProp']).toContain(c.op.op);
  });

  it('customer selection is required, applying changes real geometry, previous version is restorable', () => {
    let p = bareSite();
    p.proposals = generateProposals(p, BRIEF, M, S, DEFAULT_SETTINGS).proposals;
    const bal = p.proposals[1];
    expect(() => applyProposal(p, bal.id, bal.changes.map(c => c.id), 'Tester')).toThrow(/customer selection/);
    p = selectProposal(p, bal.id, 'Jane Customer', 'Tester');
    expect(p.status).toBe('customer-selected');
    expect(p.proposals![1].selection?.customerName).toBe('Jane Customer');
    const before = structuredClone(p.objects);
    const skip = bal.changes.find(c => c.op.op === 'addObject' && c.op.object.type === 'deck' || c.text.includes('garden light 1'))!;
    const approved = bal.changes.filter(c => c.id !== skip.id).map(c => c.id);
    const q = applyProposal(p, bal.id, approved, 'Tester');
    expect(q.objects.length).toBe(before.length + approved.length);
    expect(q.objects.some(o => o.name === 'Garden light 1')).toBe(false); // rejected change not applied
    expect(est(q).priceInc).toBeGreaterThan(0);
    expect(q.activeProposalId).toBe(bal.id);
    const [vBefore, vAfter] = q.versions.slice(-2);
    expect(vBefore.objects).toEqual(before);
    expect(vAfter.proposalId).toBe(bal.id);
    // restore previous version
    const restored = { ...q, objects: structuredClone(vBefore.objects) };
    expect(restored.objects.filter(o => o.layer === 'proposed')).toEqual([]);
  });

  it('renders are linked to their proposal and design version', () => {
    let p = bareSite();
    p.proposals = generateProposals(p, BRIEF, M, S, DEFAULT_SETTINGS).proposals;
    p.proposals[2].renders.push({ id: 'rnd_1', mediaId: 'med_r1', origin: 'imported', sourceMediaIds: ['med_photo1'], createdAt: '2026-11-12T00:00:00Z', createdBy: 'Tester', status: 'ok' });
    p = selectProposal(p, p.proposals[2].id, 'C', 'T');
    const q = applyProposal(p, p.proposals![2].id, p.proposals![2].changes.map(c => c.id), 'T');
    expect(q.versions.at(-1)!.renderIds).toEqual(['rnd_1']);
  });
});

describe('linked outputs after applying a concept', () => {
  const applied = () => { let p = bareSite(); p.proposals = generateProposals(p, BRIEF, M, S, DEFAULT_SETTINGS).proposals; p = selectProposal(p, p.proposals![1].id, 'C', 'T'); return applyProposal(p, p.proposals![1].id, p.proposals![1].changes.map(c => c.id), 'T'); };

  it('resizing the applied paving updates quantities, estimate and 3D massing', () => {
    const p = applied();
    const pav = p.objects.find(o => o.type === 'paving' && o.layer === 'proposed')!;
    const area0 = polygonArea(pav.points), e0 = est(p), sc0 = isoScene(p, M)!;
    pav.points = resizeRectangle(pav.points, 6, 4);
    expect(polygonArea(pav.points)).toBeCloseTo(24, 9);
    const l = takeoff(p, M).find(x => x.objectId === pav.id && x.component === 'Pavers')!;
    expect(l.net).toBeCloseTo(24, 9);
    expect(est(p).priceInc).not.toBeCloseTo(e0.priceInc, 0);
    expect(isoScene(p, M)!.prims).not.toEqual(sc0.prims);
    expect(area0).not.toBeCloseTo(24, 3);
  });

  it('changing a material changes its 3D colour and the build-layer product', () => {
    const p = applied();
    const pav = p.objects.find(o => o.type === 'paving' && o.layer === 'proposed')!;
    const fills = (q: Project) => isoScene(q, M)!.prims.filter(x => x.t === 'poly').map(x => (x as any).fill);
    const before = fills(p);
    pav.materialId = 'pav-sandstone-600x400';
    expect(fills(p)).not.toEqual(before);
    const a = assemblyFor(pav, p, takeoff(p, M), M)!;
    expect(a.layers[0].product).toMatch(/Sandstone paver/);
  });

  it('wall build layers never invent a footing and carry the engineer banner', () => {
    const p = applied();
    const w = p.objects.find(o => o.type === 'wall')!;
    const a = assemblyFor(w, p, takeoff(p, M), M)!;
    expect(a.banner).toBe(ENGINEER_REQUIRED);
    const footing = a.layers.find(l => l.name === 'Footing / foundation')!;
    expect(footing.product).toBe('SIZE BY ENGINEER / MANUFACTURER');
    expect(footing.status).toBe('review');
    expect(a.layers.find(l => l.name === 'Subsoil drain')!.hold).toMatch(/Confirm drainage outlet before backfill/);
    expect(a.layers.find(l => l.name === 'Drainage aggregate')!.qty).toMatch(/m³ → buy [\d.]+ t/);
  });

  it('paving layer quantity is the same number as the take-off', () => {
    const p = applied();
    const pav = p.objects.find(o => o.type === 'paving' && o.layer === 'proposed')!;
    const l = takeoff(p, M).find(x => x.objectId === pav.id && x.component === 'Base course')!;
    const a = assemblyFor(pav, p, takeoff(p, M), M)!;
    expect(a.layers.find(x => x.name === 'Base course')!.qty.startsWith(`${Number(l.gross!.toFixed(2))} m³`)).toBe(true);
  });

  it('procurement knows which stage needs each material', () => {
    const p = applied();
    const st = stageByMaterial(p, takeoff(p, M));
    expect(st.get('agg-bluemetal-20')).toBe('Retaining wall');
    expect(st.get('turf-sirwalter')).toBe('Turf');
  });

  it('drawing pack contains the selected concept, 3D massing and build layers with safety labels, nothing clipped', () => {
    const p = applied();
    const lines = takeoff(p, M), e = est(p), checks = evaluateCompliance(p, e.priceInc, DEFAULT_SETTINGS);
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z';
    const sheets = buildSheets({ project: p, materials: M, settings: DEFAULT_SETTINGS, lines, checks, tasks: guidedMeasurements(p, M), size: 'A3', renderDataUrl: jpeg, renderAspect: 1 });
    const titles = sheets.map(s => s.title);
    expect(titles.some(t => t.startsWith('Selected design concept: Balanced'))).toBe(true);
    expect(titles).toContain('Conceptual 3D massing');
    expect(titles.filter(t => t.endsWith('build layers')).length).toBeGreaterThanOrEqual(4);
    const text = sheets.flatMap(s => s.prims.filter(x => x.t === 'text').map(x => (x as any).s)).join('\n');
    expect(text).toContain(MASSING_LABEL);
    expect(text).toContain(ILLUSTRATIVE_LABEL);
    expect(text).toContain(ENGINEER_REQUIRED);
    expect(text).toMatch(/Customer selection = design direction/);
    expect(sheets.some(s => s.prims.some(x => x.t === 'image'))).toBe(true);
    for (const s of sheets) for (const x of s.prims) {
      const xs = x.t === 'line' ? [x.x1, x.x2] : x.t === 'poly' ? x.pts.map(q => q[0]) : x.t === 'circle' ? [x.x - x.r, x.x + x.r] : x.t === 'image' ? [x.x, x.x + x.w] : [x.x];
      const ys = x.t === 'line' ? [x.y1, x.y2] : x.t === 'poly' ? x.pts.map(q => q[1]) : x.t === 'circle' ? [x.y - x.r, x.y + x.r] : x.t === 'image' ? [x.y, x.y + x.h] : [x.y];
      expect(Math.min(...xs), s.number).toBeGreaterThanOrEqual(8); expect(Math.max(...xs), s.number).toBeLessThanOrEqual(s.w - 8);
      expect(Math.min(...ys), s.number).toBeGreaterThanOrEqual(8); expect(Math.max(...ys), s.number).toBeLessThanOrEqual(s.h - 8);
    }
    const pdf = Buffer.from(sheetsToPdf(sheets, p.name).output('arraybuffer'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    mkdirSync('test-output', { recursive: true });
    writeFileSync('test-output/concept-pack-A3.pdf', pdf);
  });
});

describe('approval and quotation gates', () => {
  it('crew cannot change status; only a reviewer can approve or issue; open technical items block issue', () => {
    const p = demoProject();
    const blockers = issueBlockers(p, evaluateCompliance(p, 25000, DEFAULT_SETTINGS));
    expect(blockers.length).toBeGreaterThan(0);
    expect(statusChangeError(p, 'issued', 'crew', [])).toMatch(/crew/);
    expect(statusChangeError(p, 'approved', 'owner', [])).toMatch(/Authorised reviewer/);
    expect(statusChangeError(p, 'approved', 'reviewer', blockers)).toMatch(/open technical item/);
    expect(statusChangeError(p, 'issued', 'reviewer', [])).toMatch(/Approve the project before issuing/);
    expect(statusChangeError({ ...p, status: 'approved' }, 'issued', 'reviewer', [])).toBeNull();
    expect(statusChangeError(p, 'customer-selected', 'owner', [])).toMatch(/Record which concept/);
  });

  it('a missing price blocks a final quotation; markup and margin stay distinct', () => {
    const p = demoProject();
    delete p.priceAssumptions!['sand-bedding'];
    const e = est(p);
    expect(quoteBlockers(e).some(f => /Washed river sand/.test(f))).toBe(true);
    expect(e.marginPct).toBeCloseTo(20, 6); // 25% markup
  });
});
