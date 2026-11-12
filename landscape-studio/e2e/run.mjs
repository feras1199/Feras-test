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
for (const id of ['prj_demo_backyard', 'prj_demo_site']) await page.request.delete(`${BASE}/api/projects/${id}`);
await page.reload();

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
  const items = ['Dashboard', 'Customers', 'Project', 'Site Capture', 'Site Drawing', 'Visual Concepts', 'Design Studio', 'Construction Details', 'Cost Estimator', 'Procurement', 'Documents', 'Project Performance', 'Materials Library', 'Settings'];
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

// ---------------- Photo → concepts → customer choice → buildable project ----------------
const SHOTS = 'test-output/screenshots'; mkdirSync(SHOTS, { recursive: true });
const photoJpeg = async (w, h, paint) => Buffer.from((await page.evaluate(([w, h, paint]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); new Function('g', 'w', 'h', paint)(g, w, h); return c.toDataURL('image/jpeg', 0.9); }, [w, h, paint])).split(',')[1], 'base64');
const SITE_PHOTO = "g.fillStyle='#9fb7c9';g.fillRect(0,0,w,h*0.45);g.fillStyle='#7f9a62';g.fillRect(0,h*0.45,w,h);g.fillStyle='#c9c2b5';g.fillRect(w*0.1,h*0.15,w*0.8,h*0.3);g.fillStyle='#bdb7a8';g.fillRect(w*0.25,h*0.45,w*0.5,h*0.12);g.fillStyle='#5a4a3a';g.fillRect(0,h*0.7,w,h*0.03);g.fillStyle='#3e6b35';g.beginPath();g.arc(w*0.82,h*0.4,h*0.12,0,7);g.fill();";
const RENDER = "g.fillStyle='#a9c4d8';g.fillRect(0,0,w,h*0.45);g.fillStyle='#98c27a';g.fillRect(0,h*0.45,w,h);g.fillStyle='#c9c2b5';g.fillRect(w*0.1,h*0.15,w*0.8,h*0.3);g.fillStyle='#e6d5b8';g.fillRect(w*0.12,h*0.45,w*0.76,h*0.18);g.fillStyle='#5b6168';g.fillRect(w*0.05,h*0.72,w*0.9,h*0.05);g.fillStyle='#4f8a46';for(let i=0;i<14;i++){g.beginPath();g.arc(w*(0.08+i*0.065),h*0.85,h*0.04,0,7);g.fill();}g.fillStyle='#fde68a';for(let i=0;i<6;i++){g.beginPath();g.arc(w*(0.12+i*0.15),h*0.7,5,0,7);g.fill();}";

await step('Part 1/8.1 site photos: upload, size limit, missing AI image config', async () => {
  await nav('Dashboard');
  await page.getByRole('button', { name: 'Open demo site (no design yet)' }).click();
  await page.getByText('Synthetic demonstration project.').waitFor();
  await nav('Site Capture');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'rear-yard-from-house.jpg', mimeType: 'image/jpeg', buffer: await photoJpeg(1200, 900, SITE_PHOTO) },
    { name: 'too-big.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(41 * 1024 * 1024, 1) },
    { name: 'plan.dwg', mimeType: 'application/acad', buffer: Buffer.from('AC1018') },
  ]);
  await page.getByText(/were not added/).waitFor();
  const t = await page.locator('main').innerText();
  expect(/larger than 40 MB/.test(t), 'size limit message missing');
  expect(/unsupported file type/.test(t), 'unsupported message missing');
  await page.getByRole('button', { name: 'Open rear-yard-from-house.jpg' }).waitFor();
  await page.locator('main').screenshot({ path: `${SHOTS}/01-photo-upload.png` });
  return 'photo accepted; 41 MB file and .dwg rejected with reasons';
});

let pricesBefore;
await step('Part 1-2 three structured concepts generated; no-key AI render says not configured; imported render labelled', async () => {
  await nav('Visual Concepts');
  await page.getByText('AI image generation is not configured.').first().waitFor();
  await page.getByRole('button', { name: 'Generate three concepts' }).click();
  for (const t of ['economy', 'balanced', 'premium']) await page.getByTestId(`concept-${t}`).waitFor();
  const price = async t => Number((await page.getByTestId(`concept-${t}`).locator('.stat').innerText()).split(' to ')[0].replace(/[^0-9.]/g, ''));
  pricesBefore = { e: await price('economy'), b: await price('balanced'), p: await price('premium') };
  expect(pricesBefore.e < pricesBefore.b && pricesBefore.b < pricesBefore.p, `prices not ordered ${JSON.stringify(pricesBefore)}`);
  const bal = page.getByTestId('concept-balanced');
  await bal.getByRole('button', { name: 'Generate AI render' }).click();
  await bal.getByText(/AI image generation is not configured\. No image was generated/).waitFor();
  await page.getByTestId('import-balanced').setInputFiles({ name: 'balanced-render.jpg', mimeType: 'image/jpeg', buffer: await photoJpeg(1200, 800, RENDER) });
  await bal.getByText(/^Imported illustrative render/).waitFor();
  await bal.locator('img').waitFor();
  expect(/not surveyed, not to scale, not for construction/.test(await bal.innerText()), 'illustrative label missing');
  for (const t of ['economy', 'premium']) await page.getByTestId(`import-${t}`).setInputFiles({ name: `${t}.jpg`, mimeType: 'image/jpeg', buffer: await photoJpeg(1200, 800, RENDER.replace("'#e6d5b8'", t === 'economy' ? "'#b9b5ad'" : "'#d9b77a'")) });
  await page.getByTestId('concept-premium').locator('img').waitFor();
  await page.locator('main').screenshot({ path: `${SHOTS}/02-three-concepts.png` });
  const log = await page.request.get(BASE + '/api/renders/prj_demo_site');
  const rows = await log.json();
  expect(rows.some(r => r.status === 'not-configured') && rows.filter(r => r.origin === 'imported').length >= 3, 'render provenance not logged');
  return `economy $${pricesBefore.e} < balanced $${pricesBefore.b} < premium $${pricesBefore.p}; AI call refused as not configured and logged; 3 imported renders logged`;
});

await step('Part 2 customer selects Balanced; contractor approves changes; versions saved', async () => {
  const bal = page.getByTestId('concept-balanced');
  await bal.getByRole('button', { name: 'Customer selects this' }).click();
  await bal.getByLabel('Customer name for selection').fill('Jane Example (synthetic)');
  await bal.getByRole('button', { name: 'Record customer selection' }).click();
  await bal.getByText('Customer selected').waitFor();
  await page.getByTestId('apply-panel').waitFor();
  await page.locator('main').screenshot({ path: `${SHOTS}/03-customer-selection.png` });
  await page.getByTestId('apply-panel').getByLabel(/Add garden light 6/).uncheck();
  const n = await page.getByTestId('apply-panel').getByRole('button', { name: /Approve and apply/ }).innerText();
  await page.getByTestId('apply-panel').getByRole('button', { name: /Approve and apply/ }).click();
  await page.getByTestId('applied-panel').waitFor();
  await page.getByTestId('applied-panel').getByTestId('massing').waitFor();
  return `${n.trim()}; light 6 left out`;
});

await step('Part 3 linked 2D plan: applied geometry present; editing paving updates estimate and 3D', async () => {
  await nav('Site Drawing');
  await page.getByText(/Linked to the customer's chosen concept/).waitFor();
  const objs = await page.locator('.inspector').innerText();
  expect(/New paving/.test(objs) && /Retaining wall/.test(objs) && /Garden light 5/.test(objs) && !/Garden light 6/.test(objs), 'applied objects missing or rejected change applied');
  await page.locator('.draw').screenshot({ path: `${SHOTS}/04-linked-2d-plan.png` });
  await nav('Cost Estimator'); const before = await priceInc();
  await nav('Site Drawing'); await selectObj('New paving');
  const w = page.getByTestId('inspector').getByLabel('Width in metres'); await w.fill('6'); await w.press('Enter');
  const h = page.getByTestId('inspector').getByLabel('Depth in metres'); await h.fill('4'); await h.press('Enter');
  await page.waitForTimeout(200);
  expect(/Area 24 m²/.test(await page.getByTestId('inspector').innerText()), 'paving not 24 m2');
  await page.getByRole('button', { name: '3D' }).click();
  await page.getByTestId('massing').waitFor();
  await page.locator('.draw').screenshot({ path: `${SHOTS}/05-3d-massing.png` });
  await page.getByRole('button', { name: '3D' }).click();
  await nav('Cost Estimator'); const after = await priceInc();
  expect(after !== before, 'estimate did not change');
  return `paving resized to 6 x 4 = 24 m²; price inc GST $${before} → $${after}`;
});

await step('Part 5 build layers with engineer banner and hold points', async () => {
  await nav('Construction Details');
  await page.getByRole('tab', { name: /Build layers/ }).click();
  const t = await page.locator('main').innerText();
  expect(/Concept detail - engineer\/manufacturer design required before construction\./.test(t), 'engineer banner missing');
  expect(/SIZE BY ENGINEER \/ MANUFACTURER/.test(t) && /Confirm drainage outlet before backfill/.test(t), 'footing / hold text missing');
  expect(/Conceptual 3D massing - not structural design/.test(t), 'massing label missing');
  await page.locator('[data-testid^="layers-"]').nth(0).screenshot({ path: `${SHOTS}/06-build-layers-paving.png` });
  const wall = page.locator('[data-testid^="layers-"]', { hasText: 'Retaining wall' }).first();
  await wall.screenshot({ path: `${SHOTS}/07-build-layers-wall.png` });
  return 'paving, turf, garden and wall build-ups shown with sources, status and HOLD points';
});

await step('Part 6 estimate and procurement from the chosen design', async () => {
  await nav('Cost Estimator');
  const t = await page.locator('main').innerText();
  expect(/Estimate incomplete/.test(t), 'missing-price warning not shown');
  await page.locator('main').screenshot({ path: `${SHOTS}/08-estimate.png` });
  await nav('Procurement');
  await page.getByRole('button', { name: 'Purchase order draft' }).first().click();
  await page.getByTestId('po-draft').waitFor();
  const pt = await page.locator('main').innerText();
  expect(/Needed for/i.test(pt) && /Retaining wall/.test(pt) && /price required|stock not confirmed/.test(pt), 'stage / missing info columns missing');
  await page.locator('main').screenshot({ path: `${SHOTS}/09-procurement.png` });
  return 'estimate marked incomplete; procurement shows stage, missing info and PO draft';
});

await step('Part 7/8.7 drawing pack includes concept, render, massing and build layers', async () => {
  await nav('Documents');
  const opts = await page.getByLabel('Sheet', { exact: true }).locator('option').allInnerTexts();
  expect(opts.some(o => /Selected design concept: Balanced/.test(o)) && opts.some(o => /Conceptual 3D massing/.test(o)) && opts.filter(o => /build layers/.test(o)).length >= 4, 'missing sheets: ' + opts.join(' | '));
  const conceptIdx = opts.findIndex(o => /Selected design concept/.test(o));
  await page.getByLabel('Sheet', { exact: true }).selectOption(String(conceptIdx));
  await page.waitForTimeout(500);
  const html = await page.getByTestId('sheet-preview').innerHTML();
  expect(/<image /.test(html), 'render not embedded in concept sheet');
  await page.locator('main').screenshot({ path: `${SHOTS}/10-concept-sheet.png` });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download PDF pack/ }).click()]);
  const path = `${OUT}/concept-${dl.suggestedFilename()}`; await dl.saveAs(path);
  const buf = readFileSync(path);
  const pages = (buf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;
  expect(buf.subarray(0, 5).toString() === '%PDF-' && pages === opts.length, `pdf pages ${pages} vs sheets ${opts.length}`);
  return `${opts.length} sheets incl. concept with embedded render, massing, ${opts.filter(o => /build layers/.test(o)).length} build-layer sheets; PDF ${pages} pages`;
});

await step('Part 7/8.8 approval gate: crew cannot change status; reviewer blocked by open technical items; action recorded', async () => {
  const setRole = async label => { await nav('Settings'); await page.locator('label.field', { hasText: 'Role' }).locator('select').selectOption({ label }); await page.waitForTimeout(150); };
  await setRole('Crew (view, notes, progress)');
  await nav('Construction Details'); await page.getByRole('tab', { name: 'Approvals and status' }).click();
  expect(await page.getByRole('button', { name: 'Issued for construction' }).isDisabled(), 'crew can press issue');
  await setRole('Authorised reviewer (engineer / certifier)');
  await nav('Construction Details'); await page.getByRole('tab', { name: 'Approvals and status' }).click();
  await page.getByRole('button', { name: 'Approved by authorised reviewer' }).click();
  await page.getByText(/Resolve \d+ open technical item/).first().waitFor();
  const status = await page.locator('header .badge').first().innerText();
  expect(/Customer selected/.test(status), 'status changed despite blockers: ' + status);
  await page.locator('main').screenshot({ path: `${SHOTS}/11-approval-gate.png` });
  await setRole('Owner');
  return 'crew buttons disabled; reviewer blocked by open technical items; status stays "Customer selected concept"';
});

await step('Part 2/8.3 previous version can be restored', async () => {
  await nav('Design Studio');
  await page.locator('tr', { hasText: 'Before "Balanced' }).getByRole('button', { name: 'Restore' }).click();
  await nav('Cost Estimator');
  await page.getByText('Nothing to estimate yet').waitFor();
  await nav('Design Studio');
  await page.locator('tr', { hasText: 'Customer choice: Balanced' }).getByRole('button', { name: 'Restore' }).click();
  await nav('Cost Estimator');
  const p = await priceInc();
  expect(p > 0, 'restore of chosen version failed');
  return `restored pre-concept site (nothing to estimate), then the customer-choice version again ($${p})`;
});

await step('No uncaught browser errors', async () => { expect(!errors.length, errors.slice(0, 5).join(' | ')); return 'none'; });

await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
