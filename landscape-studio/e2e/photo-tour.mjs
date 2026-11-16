// Photo-first workflow tour: for each before photo, create a project, upload the photo,
// enter the yard size and checklist, review ideas, pick one, pick a tier, apply, and capture results.
// Usage: node e2e/photo-tour.mjs <photoDir> [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const DIR = process.argv[2];
const BASE = process.argv[3] ?? 'http://localhost:8787';
const OUT = 'test-output/photo-tour';
mkdirSync(OUT, { recursive: true });
const JOBS = [
  { photo: '1-big-lawn.jpg', name: 'Photo 1: big lawn, entertainer', w: 14, d: 11, house: 11, cond: ['Customer entertains often', 'Existing patio to replace'], idea: 'entertainer', tier: 'premium' },
  { photo: '2-overgrown.jpg', name: 'Photo 2: overgrown garden', w: 6, d: 12, house: 0, cond: ['Overgrown / neglected', 'Wants low maintenance', 'Trees to keep'], idea: 'zen-path', tier: 'balanced' },
  { photo: '3-neglected.jpg', name: 'Photo 3: neglected cottage yard', w: 12, d: 10, house: 8, cond: ['Overgrown / neglected', 'Kids or pets use the yard', 'Customer entertains often'], idea: 'firepit-lawn', tier: 'balanced' },
  { photo: '4-side-yard.jpg', name: 'Photo 4: narrow side yard', w: 3.4, d: 15, house: 0, cond: ['Wants low maintenance'], idea: 'side-path', tier: 'economy' },
];

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const nav = name => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
const results = [];
await page.goto(BASE);
for (const [n, j] of JOBS.entries()) {
  const tag = String(n + 1);
  await nav('Dashboard');
  await page.getByLabel('New project name').fill(j.name);
  await page.getByRole('button', { name: 'New site' }).click();
  await page.getByText('Project and customer').waitFor();
  await nav('Visual Concepts');
  const panel = page.getByTestId('ideas-panel');
  await panel.getByTestId('before-photo-input').setInputFiles({ name: j.photo, mimeType: 'image/jpeg', buffer: readFileSync(`${DIR}/${j.photo}`) });
  await panel.locator('img').first().waitFor();
  for (const c of j.cond) await panel.getByLabel(c).check();
  await panel.getByLabel('Yard width').fill(String(j.w)); await panel.getByLabel('Yard width').press('Tab');
  await panel.getByLabel('Yard depth').fill(String(j.d)); await panel.getByLabel('Yard depth').press('Tab');
  await panel.getByLabel('House width').fill(String(j.house)); await panel.getByLabel('House width').press('Tab');
  await panel.getByRole('button', { name: 'Use this size' }).click();
  await panel.getByTestId(`idea-${j.idea}`).waitFor();
  await panel.getByLabel('Use example allowances').check();
  await page.waitForTimeout(300);
  const ranking = await panel.locator('[data-testid^="idea-"]').evaluateAll(els => els.map(e => `${e.querySelector('b')?.textContent} [${e.querySelector('.badge')?.textContent}]`));
  await panel.screenshot({ path: `${OUT}/${tag}-a-photo-and-ideas.png` });
  await panel.getByTestId(`idea-${j.idea}`).getByRole('button', { name: /Use this idea/ }).click();
  await page.getByTestId('concept-economy').waitFor();
  const prices = {};
  for (const t of ['economy', 'balanced', 'premium']) prices[t] = (await page.getByTestId(`concept-${t}`).locator('.stat').innerText()).trim();
  await page.locator('.cards').filter({ has: page.getByTestId('concept-economy') }).screenshot({ path: `${OUT}/${tag}-b-three-tiers.png` });
  const card = page.getByTestId(`concept-${j.tier}`);
  await card.getByRole('button', { name: 'Copy prompt for ChatGPT' }).click();
  const prompt = await card.getByTestId('prompt-box').locator('textarea').inputValue();
  await card.getByRole('button', { name: 'Customer selects this' }).click();
  await card.getByLabel('Customer name for selection').fill('Demo customer');
  await card.getByRole('button', { name: 'Record customer selection' }).click();
  await page.getByTestId('apply-panel').getByRole('button', { name: /Approve and apply/ }).click();
  await page.getByTestId('applied-panel').getByTestId('model3d').waitFor();
  await page.waitForTimeout(1500);
  await page.getByTestId('applied-panel').getByTestId('model3d').screenshot({ path: `${OUT}/${tag}-c-3d.png` });
  await nav('Site Drawing'); await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Dimensions' }).click(); await page.waitForTimeout(200);
  await page.locator('.canvas-wrap').screenshot({ path: `${OUT}/${tag}-d-plan.png` });
  await nav('Construction Details'); await page.getByRole('tab', { name: /Build layers/ }).click(); await page.waitForTimeout(300);
  await page.locator('[data-testid^="layers-"]').first().screenshot({ path: `${OUT}/${tag}-e-build-layers.png` });
  await nav('Cost Estimator');
  const price = await page.getByTestId('price-inc').innerText();
  await nav('Procurement'); await page.waitForTimeout(200);
  await page.locator('main').screenshot({ path: `${OUT}/${tag}-f-purchase-list.png` });
  results.push({ photo: j.photo, ideasRanked: ranking, tiers: prices, chosen: `${j.idea} / ${j.tier}`, finalPriceIncGst: price, promptStart: prompt.slice(0, 160) });
}
writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2));
console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
