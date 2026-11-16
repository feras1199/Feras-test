// Walk through the three gallery demos and capture screenshots for review.
// Usage: node e2e/demo-tour.mjs [baseUrl]   (server must be running)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.argv[2] ?? 'http://localhost:8787';
const OUT = 'test-output/demo-tour';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const nav = name => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
const summary = [];

await page.goto(BASE);
for (const id of ['prj_demo_family', 'prj_demo_entertainer', 'prj_demo_slope']) await page.request.delete(`${BASE}/api/projects/${id}`);
await page.reload();
await page.getByTestId('gallery').waitFor();
await page.waitForTimeout(800);
await page.getByTestId('gallery').screenshot({ path: `${OUT}/00-gallery.png` });

const demos = [['A', 0], ['B', 1], ['C', 2]];
for (const [tag, i] of demos) {
  await nav('Dashboard');
  await page.getByTestId('gallery').getByRole('button', { name: 'Open this demo' }).nth(i).click();
  await page.getByText('Project and customer').waitFor();
  const name = (await page.locator('header .title').innerText()).trim();
  await nav('Visual Concepts');
  await page.getByTestId('concept-economy').waitFor();
  await page.waitForTimeout(600);
  await page.locator('main').screenshot({ path: `${OUT}/${tag}-1-concepts.png` });
  await page.getByTestId('applied-panel').getByTestId('model3d').waitFor();
  await page.waitForTimeout(1500);
  await page.getByTestId('applied-panel').screenshot({ path: `${OUT}/${tag}-2-3d-model.png` });
  // rotate the model with the mouse to prove it is interactive
  const box = await page.getByTestId('applied-panel').getByTestId('model3d').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2 - 40, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(800);
  await page.getByTestId('applied-panel').getByTestId('model3d').screenshot({ path: `${OUT}/${tag}-3-3d-rotated.png` });
  await nav('Site Drawing');
  await page.waitForTimeout(500);
  await page.locator('.draw').screenshot({ path: `${OUT}/${tag}-4-plan.png` });
  await nav('Construction Details');
  await page.getByRole('tab', { name: /Build layers/ }).click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid^="layers-"]').first().screenshot({ path: `${OUT}/${tag}-5-build-layers.png` });
  await nav('Cost Estimator');
  const price = await page.getByTestId('price-inc').innerText();
  await page.locator('main').screenshot({ path: `${OUT}/${tag}-6-estimate.png` });
  await nav('Procurement');
  await page.locator('main').screenshot({ path: `${OUT}/${tag}-7-purchase-list.png` });
  summary.push({ demo: tag, name, priceIncGst: price });
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify({ summary, errors }, null, 2));
console.log(JSON.stringify({ summary, errors }, null, 2));
await browser.close();
