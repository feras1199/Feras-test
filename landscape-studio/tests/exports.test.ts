import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { demoProject } from '../src/core/demo.ts';
import { SEED_MATERIALS as M, SEED_SUPPLIERS as S } from '../src/core/catalogue.ts';
import { takeoff } from '../src/core/assemblies.ts';
import { computeEstimate } from '../src/core/estimate.ts';
import { evaluateCompliance } from '../src/core/compliance.ts';
import { guidedMeasurements } from '../src/core/validation.ts';
import { DEFAULT_SETTINGS } from '../src/core/project.ts';
import { buildSheets } from '../src/core/exports/sheets.ts';
import { sheetsToPdf, sheetToSvg } from '../src/core/exports/render.ts';
import { boqCsv, estimateCsv, scheduleCsv, toDxf } from '../src/core/exports/data.ts';

const build = (size: 'A3' | 'A4') => {
  const project = demoProject();
  const lines = takeoff(project, M);
  const e = computeEstimate(project, lines, M, S);
  const checks = evaluateCompliance(project, e.priceInc, DEFAULT_SETTINGS);
  const tasks = guidedMeasurements(project, M);
  return { project, lines, e, sheets: buildSheets({ project, materials: M, settings: DEFAULT_SETTINGS, lines, checks, tasks, size }) };
};

describe('21.7 document output', () => {
  mkdirSync('test-output', { recursive: true });
  for (const size of ['A3', 'A4'] as const) {
    it(`${size} drawing pack: valid PDF, right project, dimensions, materials, scale and status labels, nothing off the sheet`, () => {
      const { project, sheets } = build(size);
      const pdf = Buffer.from(sheetsToPdf(sheets, project.name).output('arraybuffer'));
      writeFileSync(`test-output/demo-pack-${size}.pdf`, pdf);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.subarray(-6).toString()).toMatch(/%%EOF/);
      expect(sheets.length).toBeGreaterThanOrEqual(9);
      const texts = sheets.flatMap(s => s.prims.filter(p => p.t === 'text').map(p => (p as any).s as string));
      const all = texts.join('\n');
      expect(all).toContain(project.name.slice(0, 30));
      expect(all).toContain(project.id);
      expect(texts).toContain('CONCEPT'); expect(texts).toContain('NOT FOR CONSTRUCTION'); // title block stamp on every sheet
      for (const sh of sheets) expect(sh.prims.some(p => p.t === 'text' && p.s === 'NOT FOR CONSTRUCTION'), sh.number).toBe(true);
      expect(all).toContain('CONCEPT ONLY - NOT FOR CONSTRUCTION'); // wall section stamp
      expect(all).toContain('SYNTHETIC DEMONSTRATION DATA');
      expect(all).toMatch(/Scale 1:\d+ when printed at 100%/);
      expect(texts).toContain('7.00'); // verified paving side
      expect(texts).toContain('3.00');
      expect(texts).toContain('~10.0'); // wall length is an estimate and is shown as one
      expect(all).toContain('Pioneer 2.0m x 200 x 75mm Charcoal Smooth');
      expect(all).toContain('Cliftonvale 610 x 406 x 30mm travertine');
      expect(all).toContain('SIZE BY ENGINEER / MFR TABLE');
      // nothing drawn outside the sheet
      for (const s of sheets) for (const p of s.prims) {
        const tw = p.t === 'text' ? p.s.length * p.size * 0.6 : 0; // generous Helvetica width estimate
        const xs = p.t === 'line' ? [p.x1, p.x2] : p.t === 'poly' ? p.pts.map(q => q[0]) : p.t === 'circle' ? [p.x - p.r, p.x + p.r] : p.a === 'middle' ? [p.x - tw / 2, p.x + tw / 2] : p.a === 'end' ? [p.x - tw, p.x] : [p.x, p.x + tw];
        const ys = p.t === 'line' ? [p.y1, p.y2] : p.t === 'poly' ? p.pts.map(q => q[1]) : p.t === 'circle' ? [p.y - p.r, p.y + p.r] : [p.y];
        const what = `${s.number} ${p.t} ${p.t === 'text' ? p.s : ''}`;
        expect(Math.min(...xs), what).toBeGreaterThanOrEqual(8);
        expect(Math.max(...xs), what).toBeLessThanOrEqual(s.w - 8);
        expect(Math.min(...ys), what).toBeGreaterThanOrEqual(8);
        expect(Math.max(...ys), what).toBeLessThanOrEqual(s.h - 8);
      }
      sheets.forEach((s, i) => writeFileSync(`test-output/demo-${size}-${String(i + 1).padStart(2, '0')}.svg`, sheetToSvg(s)));
    });
  }
  it('plan is drawn at the stated scale', () => {
    const { sheets } = build('A3');
    const s = sheets[1];
    const scale = Number(s.scale.replace('1:', ''));
    // site outline is 12 m wide: its drawn width in mm must equal 12000 / scale
    const polys = s.prims.filter(p => p.t === 'poly' && p.closed && p.pts.length === 4) as any[];
    const widths = polys.map(p => Math.max(...p.pts.map((q: number[]) => q[0])) - Math.min(...p.pts.map((q: number[]) => q[0])));
    expect(widths.some((w: number) => Math.abs(w - 12000 / scale) < 0.01)).toBe(true);
  });
  it('CSV and DXF exports carry the same quantities as the model', () => {
    const { project, lines, e } = build('A3');
    const boq = boqCsv(project, lines, M);
    expect(boq).toContain('Retaining wall,Concrete sleepers');
    expect(boq).toMatch(/Retaining wall,Wall face area,earthworks,,length × exposed height,.*,6,m2/);
    const sched = scheduleCsv(project, lines, M, S);
    expect(sched).toContain('Pioneer 2.0m x 200 x 75mm Charcoal Smooth reinforced concrete sleeper');
    expect(sched).toContain('NOT PRICED');
    expect(estimateCsv(project, e)).toContain('Price inc GST');
    const dxf = toDxf(project);
    expect(dxf).toContain('PROPOSED_WALL');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
    writeFileSync('test-output/demo.dxf', dxf); writeFileSync('test-output/demo-boq.csv', boq); writeFileSync('test-output/demo-schedule.csv', sched);
  });
});
