import { describe, expect, it } from 'vitest';
import { SEED_MATERIALS as M, SEED_SUPPLIERS as S } from '../src/core/catalogue.ts';
import { DEFAULT_SETTINGS, newProject, newObject } from '../src/core/project.ts';
import { IDEAS, NO_CONDITIONS, rankIdeas, ideaChanges } from '../src/core/ideas.ts';
import { generateProposals, applyProposal, selectProposal } from '../src/core/proposals.ts';
import { applyOps } from '../src/core/ops.ts';
import { validateProject } from '../src/core/validation.ts';
import { takeoff } from '../src/core/assemblies.ts';
import { computeEstimate } from '../src/core/estimate.ts';
import { evaluateCompliance } from '../src/core/compliance.ts';
import { rectPoints } from '../src/core/geometry.ts';
import type { Project } from '../src/core/types.ts';

const site = (w: number, d: number, houseW = w * 0.8, houseD = 1.2): Project => {
  const p = newProject('t');
  const b = newObject('boundary', rectPoints(0, 0, w, d), []);
  const h = newObject('building', rectPoints((w - houseW) / 2, 0, houseW, houseD), [b]);
  p.objects.push(b, h);
  return p;
};
const YARDS: [string, number, number][] = [['wide', 16, 12], ['deep', 10, 18], ['small', 7, 7], ['narrow side yard', 3.2, 14]];
const name = (id: string) => M.find(m => m.id === id)?.name ?? id;

describe('design ideas', () => {
  for (const [label, w, d] of YARDS) for (const idea of IDEAS) for (const tier of ['economy', 'balanced', 'premium'] as const) {
    it(`${idea.name} / ${tier} fits a ${label} yard (${w} × ${d} m): inside boundary, no overlaps, priced`, () => {
      const p = site(w, d, label === 'narrow side yard' ? 0 : undefined);
      if (label === 'narrow side yard') p.objects = p.objects.filter(o => o.type !== 'building');
      const ch = ideaChanges(p, idea.id, tier, name);
      const fits = rankIdeas(p, NO_CONDITIONS).find(r => r.idea.id === idea.id)!;
      if (!fits.fits) { expect(ch).toEqual([]); expect(fits.why[0]).toMatch(/needs a yard at least/); return; }
      expect(ch.length).toBeGreaterThan(2);
      const q = applyOps(p, ch.map(c => c.op));
      const bad = validateProject(q).filter(i => ['outside-boundary', 'overlap', 'self-intersection', 'zero-area', 'zero-length', 'open'].includes(i.kind));
      expect(bad.map(i => i.message)).toEqual([]);
      const e = computeEstimate(q, takeoff(q, M), M, S);
      expect(e.priceInc).toBeGreaterThan(0);
    });
  }

  it('ranks ideas from the yard shape and the photo checklist', () => {
    expect(rankIdeas(site(3.2, 14, 0), NO_CONDITIONS)[0].idea.id).toBe('side-path');
    expect(rankIdeas(site(16, 12), { ...NO_CONDITIONS, entertaining: true })[0].idea.id).toBe('entertainer');
    expect(rankIdeas(site(12, 10), { ...NO_CONDITIONS, overgrown: true, lowMaintenance: true })[0].idea.id).toBe('zen-path');
    expect(rankIdeas(site(14, 12), { ...NO_CONDITIONS, kidsPets: true })[0].idea.id).toBe('family-play');
    expect(rankIdeas(site(14, 12), { ...NO_CONDITIONS, slope: true })[0].idea.id).toBe('terraced');
    expect(rankIdeas(site(14, 12), NO_CONDITIONS)[0].why.length).toBeGreaterThanOrEqual(0);
  });

  it('an idea becomes three tiers of real proposals with different materials and costs', () => {
    const p = site(14, 11);
    const r = generateProposals(p, { style: 'Modern', inclusions: [], budgetMax: null, constraints: '', sourceMediaIds: [], ideaId: 'entertainer' }, M, S, DEFAULT_SETTINGS);
    expect(r.error).toBeUndefined();
    const [e, b, pr] = r.proposals;
    expect(e.title).toBe("Entertainer's terrace: Economy");
    expect(e.changes.some(c => c.op.op === 'addObject' && c.op.object.type === 'pergola')).toBe(false); // economy leaves the pergola out
    expect(b.changes.some(c => c.op.op === 'addObject' && c.op.object.type === 'pergola')).toBe(true);
    expect(e.costLow).toBeLessThan(b.costLow);
    expect(b.costLow).toBeLessThan(pr.costLow);
  });

  it('stepping stones are counted as units without jointing sand or edge restraint', () => {
    const p = site(12, 10);
    const q = applyOps(p, ideaChanges(p, 'zen-path', 'balanced', name).map(c => c.op));
    const stones = q.objects.filter(o => o.props.isStepper);
    expect(stones.length).toBeGreaterThan(10);
    const lines = takeoff(q, M).filter(l => stones.some(s => s.id === l.objectId));
    expect(lines.some(l => l.component === 'Jointing sand' || l.component === 'Edge restraint')).toBe(false);
    expect(lines.filter(l => l.component === 'Pavers').every(l => l.purchaseQty === 1)).toBe(true); // 0.405 m² + 2% → 1 stone each
  });

  it('pergola and fire pit get planning and safety checks', () => {
    let p = site(16, 12);
    p.proposals = generateProposals(p, { style: 'Modern', inclusions: [], budgetMax: null, constraints: '', sourceMediaIds: [], ideaId: 'entertainer' }, M, S, DEFAULT_SETTINGS).proposals;
    p = selectProposal(p, p.proposals![2].id, 'C', 'T');
    p = applyProposal(p, p.proposals![2].id, p.proposals![2].changes.map(c => c.id), 'T');
    const c = evaluateCompliance(p, 50000, DEFAULT_SETTINGS);
    const perg = c.find(x => x.id.startsWith('pergola-exempt:'))!;
    expect(perg.result).toMatch(/less than 900 mm/); // placed 0.3 m from the side boundary in the concept
    let f = site(16, 12);
    f = applyOps(f, ideaChanges(f, 'firepit-lawn', 'premium', name).map(x => x.op));
    expect(evaluateCompliance(f, 30000, DEFAULT_SETTINGS).some(x => x.id.startsWith('firepit:') && x.status === 'potential')).toBe(true);
  });
});
