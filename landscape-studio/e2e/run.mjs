// End-to-end checks against a running server (default http://localhost:8787). Usage: node e2e/run.mjs [baseUrl]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const OUT = 'test-output/e2e';
mkdirSync(OUT, { recursive: true });
const results = [];
const errors = [];
async function step(name, fn) {
  const t = Date.now();
  try { const ev = await fn(); results.push({ name, pass: true, evidence: ev ?? '', ms: Date.now() - t }); console.log(`PASS ${name}${ev ? ' :: ' + ev : ''}`); }
  catch (e) { results.push({ name, pass: false, evidence: String(e.message ?? e).split('\n')[0], ms: Date.now() - t }); console.log(`FAIL ${name} :: ${e.message}`); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
const nav = name => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
const selectObj = async name => { const c = page.getByRole('button', { name: 'Close properties' }); if (await c.count()) await c.click(); await page.getByRole('button', { name, exact: true }).click(); await page.getByTestId('inspector').waitFor(); };
const priceInc = async () => Number((await page.getByTestId('price-inc').innerText()).replace(/[^0-9.]/g, ''));

await page.goto(BASE);

await step('21.2 create project and persist across reload', async () => {
  await page.getByLabel('New project name').fill('E2E Test Site');
  await page.getByRole('button', { name: 'New site' }).click();
  await page.getByText('Project and customer').waitFor();
  const cust = page.locator('label.field', { hasText: 'Customer name' }).locator('input');
  await cust.fill('Test Customer'); await cust.blur();
  await page.locator('label.field', { hasText: 'Local council' }).locator('select').selectOption('Randwick City Council').catch(() => page.locator('label.field', { hasText: 'Local council' }).locator('select').selectOption({ index: 25 }));
  await page.locator('[data-save-state="saved"]').waitFor({ timeout: 5000 });
  await page.reload();
  await page.getByText('Project and customer').waitFor();
  const v = await page.locator('label.field', { hasText: 'Customer name' }).locator('input').inputValue();
  expect(v === 'Test Customer', `customer after reload = ${v}`);
  return 'customer name survived reload (server SQLite)';
});

await step('21.1 every navigation item opens a working page', async () => {
  const items = ['Dashboard', 'Customers', 'Project', 'Site Capture', 'Site Drawing', 'Design Studio', 'Construction Details', 'Cost Estimator', 'Procurement', 'Documents', 'Project Performance', 'Materials Library', 'Settings'];
  if (!(await page.getByRole('button', { name: 'Project', exact: true }).isEnabled())) throw new Error('project nav disabled');
  for (const it of items) { await nav(it); await page.waitForTimeout(150); const txt = await page.locator('main').innerText(); expect(txt.trim().length > 30, `${it} page empty`); }
  return `${items.length} pages rendered content`;
});

await step('21.3 draw 5 x 4 m paving rectangle = 20 m2, resize to 6 x 4 = 24 m2, quantities update', async () => {
  await nav('Site Drawing');
  await page.locator('[data-tool="paving"]').click();
  const svg = page.locator('svg.plan'); const box = await svg.boundingBox();
  await page.mouse.move(box.x + 200, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 260, { steps: 5 }); await page.mouse.up();
  const insp = page.getByTestId('inspector');
  await insp.waitFor();
  const w = insp.getByLabel('Width in metres'), h = insp.getByLabel('Depth in metres');
  await w.fill('5'); await w.press('Enter'); await h.fill('4'); await h.press('Enter');
  await page.waitForTimeout(200);
  let t = await insp.innerText();
  expect(/Area 20 m²/.test(t), 'area not 20: ' + t.match(/Area [^\n]*/)?.[0]);
  const paversA = t.match(/Pavers\s*\n?\s*([\d.]+) m²/)?.[1];
  expect(paversA === '21', `pavers incl 5% waste expected 21 m², got ${paversA}`);
  await w.fill('6'); await w.press('Enter'); await page.waitForTimeout(200);
  t = await insp.innerText();
  expect(/Area 24 m²/.test(t), 'area not 24');
  const paversB = t.match(/Pavers\s*\n?\s*([\d.]+) m²/)?.[1];
  expect(paversB === '25.2', `pavers after resize expected 25.2, got ${paversB}`);
  await page.screenshot({ path: `${OUT}/drawing-paving.png` });
  return 'area 20 → 24 m²; pavers 21 → 25.2 m² (5% waste)';
});

await step('21.4 wall 10 m x 0.6 m = 6 m2 face; 12 m = 7.2 m2; estimate recalculates', async () => {
  await page.keyboard.press('Escape');
  await page.locator('[data-tool="wall"]').click();
  const box = await page.locator('svg.plan').boundingBox();
  await page.mouse.click(box.x + 150, box.y + 420); await page.mouse.click(box.x + 450, box.y + 420);
  await page.getByRole('button', { name: 'Finish' }).click();
  const insp = page.getByTestId('inspector'); await insp.waitFor();
  const L = insp.getByLabel('Length in metres'); await L.fill('10'); await L.press('Enter'); await page.waitForTimeout(200);
  let t = await insp.innerText();
  expect(/Wall face area\s*\n?\s*6 m²/.test(t), 'face area not 6: ' + t.match(/Wall face area[^\n]*\n?[^\n]*/)?.[0]);
  expect(/Concrete sleepers\s*\n?\s*15 ea/.test(t), 'sleepers not 15');
  await nav('Cost Estimator'); const p10 = await priceInc();
  await nav('Site Drawing');
  await selectObj('Retaining wall 1');
  const L2 = page.getByTestId('inspector').getByLabel('Length in metres'); await L2.fill('12'); await L2.press('Enter'); await page.waitForTimeout(200);
  t = await page.getByTestId('inspector').innerText();
  expect(/Wall face area\s*\n?\s*7.2 m²/.test(t), 'face area not 7.2');
  expect(/Concrete sleepers\s*\n?\s*18 ea/.test(t), 'sleepers not 18');
  await nav('Cost Estimator'); const p12 = await priceInc();
  expect(p12 > p10, `price did not increase ${p10} -> ${p12}`);
  return `face 6 → 7.2 m²; sleepers 15 → 18; price inc GST $${p10} → $${p12}`;
});

await step('Material change updates estimate', async () => {
  await nav('Site Drawing');
  await selectObj('Paving 1');
  const before = (await page.getByTestId('inspector').innerText()).match(/Direct cost of this object[\s\S]*?\$([\d,]+)/)?.[1];
  await page.getByTestId('inspector').getByRole('combobox', { name: 'Product', exact: true }).selectOption('pav-sandstone-600x400');
  await page.waitForTimeout(200);
  const after = (await page.getByTestId('inspector').innerText()).match(/Direct cost of this object[\s\S]*?\$([\d,]+)/)?.[1];
  expect(before && after && before !== after, `object cost unchanged ${before} ${after}`);
  return `paving object cost $${before} → $${after} after switching to sandstone`;
});

await step('21.10 invalid dimension rejected, not saved', async () => {
  const w = page.getByTestId('inspector').getByLabel('Width in metres');
  await w.fill('-3'); await w.press('Enter');
  const msg = await page.getByTestId('inspector').getByRole('alert').first().innerText();
  const t = await page.getByTestId('inspector').innerText();
  expect(/Area 24 m²/.test(t), 'area changed by invalid input');
  await w.fill('abc'); await w.press('Enter');
  expect(/Enter a number/.test(await page.getByTestId('inspector').innerText()), 'no number error');
  await w.fill('6'); await w.press('Enter');
  return `rejected with "${msg}"; area unchanged`;
});

await step('21.9/21.10 photo upload: valid JPEG accepted, unsupported and empty files rejected', async () => {
  await nav('Site Capture');
  const jpg = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d'); g.fillStyle = '#7a9'; g.fillRect(0, 0, 320, 240); g.fillStyle = '#555'; g.fillRect(0, 150, 320, 20); return c.toDataURL('image/jpeg').split(',')[1]; });
  await page.getByTestId('file-input').setInputFiles([
    { name: 'backyard.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg, 'base64') },
    { name: 'notes.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') },
    { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
    { name: 'corrupt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not really a jpeg') },
  ]);
  await page.getByText('were not added').waitFor({ timeout: 8000 });
  const t = await page.locator('main').innerText();
  expect(/3 files were not added/.test(t), 'expected 3 rejections');
  expect(/unsupported file type/.test(t) && /empty/.test(t) && /could not be read/.test(t), 'missing specific messages');
  await page.getByRole('button', { name: 'Open backyard.jpg' }).waitFor();
  await page.getByRole('button', { name: 'Open backyard.jpg' }).click();
  await page.getByRole('button', { name: /Analyse with AI/ }).click();
  await page.getByText(/not available: no API key/).waitFor();
  await page.getByRole('button', { name: /Simulated analysis/ }).click();
  await page.getByText(/SIMULATED result/).waitFor();
  await page.screenshot({ path: `${OUT}/capture.png` });
  return '1 accepted; .exe, empty and corrupt files rejected with reasons; AI: clear "not configured" message; simulated result labelled SIMULATED';
});

await step('Measurement recorded and conflict flagged without auto-correcting', async () => {
  await page.getByRole('tab', { name: /Measurements/ }).click();
  await page.getByRole('button', { name: 'Record a measurement' }).click();
  const f = page.getByTestId('measure-form');
  await f.locator('label.field', { hasText: 'What was measured' }).locator('input').fill('Paving side 1');
  await f.getByLabel('Measured value in metres').fill('6.2'); await f.getByLabel('Measured value in metres').press('Tab');
  await f.locator('label.field', { hasText: 'Linked to drawing' }).locator('select').selectOption({ label: 'Paving 1: side 1' });
  await f.getByRole('button', { name: 'Save measurement' }).click();
  await page.getByText(/verified measurement is 6.200 m but the drawing shows 6.000 m/).first().waitFor();
  await page.getByRole('button', { name: 'Apply to drawing' }).click();
  await page.waitForTimeout(300);
  expect(!(await page.getByText(/verified measurement is 6.200 m/).count()), 'conflict remains after apply');
  return 'conflict 200 mm flagged; user applied measurement to drawing explicitly';
});

await step('21.6 estimate shows markup vs margin and GST', async () => {
  await nav('Cost Estimator');
  const t = await page.locator('main').innerText();
  expect(/25% markup = 20.0% margin/.test(t), 'markup/margin wording');
  expect(/GST 10%/.test(t) && /Price inc GST/.test(t), 'GST lines');
  expect(/Estimate incomplete/.test(t), 'missing price warning');
  await page.screenshot({ path: `${OUT}/estimate.png`, fullPage: true });
  return 'markup 25% shown as 20.0% margin; incomplete-price warning present';
});

await step('Demo project: assistant change with approval, alternatives', async () => {
  await nav('Dashboard'); await page.getByRole('button', { name: 'Open demo project' }).click();
  await page.getByText('Synthetic demonstration project.').waitFor();
  await nav('Design Studio');
  await page.getByRole('button', { name: 'Make this design $2,000 cheaper' }).click();
  const r = page.getByTestId('assistant-result'); await r.waitFor();
  const t = await r.innerText();
  expect(/Proposed changes/.test(t), 'no proposed changes: ' + t.slice(0, 200));
  await r.getByRole('button', { name: /Approve and apply/ }).click();
  await page.getByText(/Change applied/).waitFor();
  expect(await page.getByTestId('alt-economy').isVisible(), 'alternatives missing');
  await page.screenshot({ path: `${OUT}/design.png`, fullPage: true });
  return t.match(/Price inc GST:[^\n]*/)?.[0] ?? '';
});

await step('Engineering approval gate blocks unauthorised approval', async () => {
  await nav('Construction Details');
  await page.getByRole('tab', { name: 'Approvals and status' }).click();
  await page.getByRole('button', { name: 'Approved by authorised reviewer' }).click();
  await page.getByText(/Only a user in the "Authorised reviewer" role/).first().waitFor();
  return 'owner role cannot mark approved';
});

await step('21.7 PDF drawing pack downloads and is a valid PDF', async () => {
  await nav('Documents');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download PDF pack/ }).click()]);
  const path = `${OUT}/${dl.suggestedFilename()}`; await dl.saveAs(path);
  const buf = readFileSync(path);
  expect(buf.subarray(0, 5).toString() === '%PDF-', 'not a PDF');
  const pages = (buf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;
  expect(pages >= 9, `only ${pages} pages`);
  const [q] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Customer estimate PDF/ }).click()]);
  await q.saveAs(`${OUT}/${q.suggestedFilename()}`);
  const [c] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /BoQ CSV/ }).click()]);
  await c.saveAs(`${OUT}/${c.suggestedFilename()}`);
  const [x] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /DXF/ }).click()]);
  await x.saveAs(`${OUT}/${x.suggestedFilename()}`);
  return `${dl.suggestedFilename()} (${pages} pages, ${buf.length} bytes) + quote PDF, BoQ CSV, DXF`;
});

await step('21.9 mobile viewport: no horizontal overflow on any page, menu works', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  mp.on('pageerror', e => errors.push(`mobile pageerror: ${e.message}`));
  await mp.goto(BASE + '/#/project/prj_demo_backyard');
  await mp.getByText('Project and customer').waitFor();
  const bad = [];
  for (const it of ['Project', 'Site Capture', 'Site Drawing', 'Design Studio', 'Construction Details', 'Cost Estimator', 'Procurement', 'Documents', 'Project Performance', 'Materials Library', 'Settings', 'Dashboard']) {
    await mp.getByRole('button', { name: 'Open menu' }).click();
    await mp.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: it, exact: true }).click();
    await mp.waitForTimeout(250);
    const o = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (o > 1) bad.push(`${it} +${o}px`);
    if (['Site Drawing', 'Cost Estimator', 'Site Capture'].includes(it)) await mp.screenshot({ path: `${OUT}/mobile-${it.replace(/ /g, '-')}.png` });
  }
  await m.close();
  expect(!bad.length, 'overflow: ' + bad.join(', '));
  return '12 pages at 390 px, no horizontal scroll';
});

await step('Missing file handled (media deleted on server)', async () => {
  const r = await page.request.get(BASE + '/api/media/prj_x/nonexistent');
  expect(r.status() === 404, 'expected 404');
  const bad = await page.request.put(BASE + '/api/projects/abc', { data: { id: 'abc', schema: 1, objects: [{ points: [{ x: 'NaN', y: 1 }] }], measurements: [] } });
  expect(bad.status() === 400, 'server accepted invalid coordinates');
  return 'server returns 404 for missing media and 400 for invalid geometry';
});

await step('21.10 empty project, interrupted upload, server unreachable during save', async () => {
  await nav('Dashboard');
  await page.getByLabel('New project name').fill('Empty Project');
  await page.getByRole('button', { name: 'New site' }).click();
  await page.getByText('Project and customer').waitFor();
  await nav('Cost Estimator'); await page.getByText('Nothing to estimate yet').waitFor();
  await nav('Documents'); await page.getByText('Nothing to document yet').waitFor();
  await nav('Design Studio'); await page.getByText('No proposed design yet').waitFor();
  await nav('Site Capture');
  await page.route('**/api/media/**', r => r.abort('connectionreset'));
  const jpg = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 50; c.height = 50; return c.toDataURL('image/jpeg').split(',')[1]; });
  await page.getByTestId('file-input').setInputFiles([{ name: 'cut-off.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg, 'base64') }]);
  await page.getByText(/upload interrupted/).waitFor();
  const listed = await page.getByRole('button', { name: 'Open cut-off.jpg' }).count();
  expect(listed === 0, 'interrupted upload was listed as if saved');
  await page.unroute('**/api/media/**');
  await page.route('**/api/projects/**', r => (r.request().method() === 'PUT' ? r.abort('connectionrefused') : r.continue()));
  await nav('Project');
  const nm = page.locator('label.field', { hasText: 'Customer name' }).locator('input'); await nm.fill('Offline edit'); await nm.blur();
  await page.locator('[data-save-state="error"]').waitFor({ timeout: 5000 });
  await page.getByText(/Not saved: Cannot reach the server/).waitFor();
  await page.unroute('**/api/projects/**');
  await page.getByRole('button', { name: 'Save project' }).click();
  await page.locator('[data-save-state="saved"]').waitFor({ timeout: 5000 });
  return 'empty states shown; interrupted upload reported and not listed; failed save shows "Retry save" and recovers';
});

await step('No uncaught browser errors', async () => { expect(!errors.length, errors.slice(0, 5).join(' | ')); return 'none'; });

await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
