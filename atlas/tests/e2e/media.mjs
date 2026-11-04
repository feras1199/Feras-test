// End-to-end check of site-visit photos and voice notes, and the Airtable price-list screen.
// Needs a server with ATLAS_DATA_SOURCE=postgres and
// ATLAS_OWNER_EMAIL=owner@example.com / ATLAS_OWNER_PASSWORD=atlas-demo-2026.
// Usage: BASE_URL=http://localhost:3100 node tests/e2e/media.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR;
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message.split("\n")[0]]); }
}
// A fake microphone that plays a tone, so recording can be tested headless.
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["microphone"] });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill("#email", "owner@example.com");
await page.fill("#password", "atlas-demo-2026");
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/login"));

const stamp = Date.now().toString(36);
const cust = await (await page.request.post(`${BASE}/api/customers`, { data: { name: `Media Demo ${stamp}`, suburb: "Kellyville", phone: `0491 57${String(Date.now()).slice(-4)}`, confirmNotDuplicate: true } })).json();
assert.ok(cust.customer?.id, JSON.stringify(cust));
const insp = (await (await page.request.post(`${BASE}/api/inspections`, { data: { customerId: cust.customer.id, inspectionDate: "2026-11-03" } })).json()).inspection;
const url = `${BASE}/inspections/${insp.id}`;

// A real PNG to stand in for a phone photo (the page turns it into a smaller JPEG).
const png = await page.screenshot({ clip: { x: 0, y: 0, width: 300, height: 200 } });

await step("photos: take two on a phone, they're shrunk to JPEG, saved and shown", async () => {
  await page.goto(url);
  await page.getByText("No photos yet.").waitFor();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles([{ name: "IMG_1.PNG", mimeType: "image/png", buffer: png }, { name: "IMG_2.PNG", mimeType: "image/png", buffer: png }]);
  await page.getByText("2 photos saved.").waitFor({ timeout: 15_000 });
  await page.getByRole("heading", { name: "Photos (2)" }).waitFor();
  const src = await page.locator('img[alt^="Photo"]').first().getAttribute("src");
  const res = await page.request.get(`${BASE}${src}`);
  assert.equal(res.status(), 200);
  assert.equal(res.headers()["content-type"], "image/jpeg");
  assert.match(res.headers()["content-security-policy"], /sandbox/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
});

await step("voice note: record, stop, save, and play back (with byte ranges for Safari)", async () => {
  await page.getByRole("button", { name: "● Record a voice note" }).click();
  await page.getByText(/Recording 0:0[1-9]/).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  if (SHOTS) await page.locator('section[aria-label="Photos and voice notes"]').screenshot({ path: `${SHOTS}/voice-recording.png` });
  await page.getByRole("button", { name: "Stop and save" }).click();
  await page.getByText("Voice note saved.").waitFor({ timeout: 15_000 });
  await page.getByRole("heading", { name: "Voice notes (1)" }).waitFor();
  const audio = page.locator("audio").first();
  const src = await audio.getAttribute("src");
  const full = await page.request.get(`${BASE}${src}`);
  assert.equal(full.status(), 200);
  assert.match(full.headers()["content-type"], /^audio\//);
  const part = await page.request.get(`${BASE}${src}`, { headers: { Range: "bytes=0-1" } });
  assert.equal(part.status(), 206);
  assert.equal((await part.body()).length, 2);
  assert.match(part.headers()["content-range"], /^bytes 0-1\/\d+$/);
  const duration = await audio.evaluate((a) => new Promise((ok) => { if (a.readyState >= 1) ok(a.duration); else a.addEventListener("loadedmetadata", () => ok(a.duration), { once: true }); }));
  assert.ok(duration > 0, `audio should load, got duration ${duration}`);
  if (SHOTS) await page.locator('section[aria-label="Photos and voice notes"]').screenshot({ path: `${SHOTS}/site-media.png` });
});

await step("only images and audio are accepted, and only staff who can see inspections can open them", async () => {
  const bad = await page.request.post(`${BASE}/api/inspections/${insp.id}/files`, { multipart: { file: { name: "x.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<html><script>alert(1)</script></html>") } } });
  assert.equal(bad.status(), 415);
  const nope = await page.request.post(`${BASE}/api/inspections/recNope0000000000/files`, { multipart: { file: { name: "x.jpg", mimeType: "image/jpeg", buffer: png } } });
  assert.equal(nope.status(), 404);
  const worker = await browser.newContext();
  const w = await worker.newPage();
  // A worker login added for this test.
  const pw = `worker-pass-${stamp}`;
  const add = await page.request.post(`${BASE}/api/people`, { data: { name: "Media Worker", email: `mw.${stamp}@example.com`, role: "worker", password: pw } });
  assert.equal(add.status(), 200);
  await w.request.post(`${BASE}/api/auth/login`, { data: { email: `mw.${stamp}@example.com`, password: pw } });
  const src = await page.locator("audio").first().getAttribute("src");
  assert.equal((await w.request.get(`${BASE}${src}`)).status(), 404);
  const anon = await browser.newContext();
  assert.equal((await anon.request.get(`${BASE}${src}`)).status(), 401);
  await worker.close(); await anon.close();
});

await step("removing a photo archives it and it leaves the page", async () => {
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /^Remove Photo/ }).first().click();
  await page.getByRole("heading", { name: "Photos (1)" }).waitFor();
  await page.goto(`${BASE}/audit`);
  const t = await page.innerText("main");
  assert.match(t, /added a voice note/);
  assert.match(t, /Removed Photo/);
});

await step("Settings shows the copy-from-Airtable steps and checks the token before using it", async () => {
  await page.goto(`${BASE}/settings/data`);
  const box = page.getByRole("region", { name: "Price lists from Airtable" });
  await box.getByText("data.records:read").waitFor();
  const btn = box.getByRole("button", { name: "Copy price lists from Airtable" });
  assert.equal(await btn.isDisabled(), true);
  await box.getByLabel("Airtable token").fill("not-a-token-at-all-12345");
  await btn.click();
  await box.getByText("doesn't look like an Airtable token").waitFor();
  if (SHOTS) await box.screenshot({ path: `${SHOTS}/airtable-pull.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
});

await browser.close();
for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
