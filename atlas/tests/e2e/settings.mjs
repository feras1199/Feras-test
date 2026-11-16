// End-to-end check that the owner can edit business settings in the app.
// Needs a server with ATLAS_DATA_SOURCE=postgres and
// ATLAS_OWNER_EMAIL=owner@example.com / ATLAS_OWNER_PASSWORD=atlas-demo-2026.
// Usage: BASE_URL=http://localhost:3100 node tests/e2e/settings.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message.split("\n")[0]]); }
}
const browser = await chromium.launch();
async function login(email, password, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 10_000 });
  return { ctx, page };
}
const owner = await login("owner@example.com", "atlas-demo-2026");
const api = owner.page.request;
const json = async (r) => { const b = await r.json(); if (!r.ok()) throw new Error(`${r.status()} ${JSON.stringify(b)}`); return b; };

// A draft estimate and an approved one, both priced at the starting markup.
const stamp = Date.now().toString(36);
let draftId, lockedId, draftBefore, lockedBefore;
await step("set up a draft and an approved estimate", async () => {
  const { customer } = await json(await api.post(`${BASE}/api/customers`, { data: { name: `Settings Demo ${stamp}`, suburb: "Kellyville" } }));
  for (const which of ["draft", "locked"]) {
    const { estimate } = await json(await api.post(`${BASE}/api/estimates`, { data: { customerId: customer.id, title: `Settings test ${which} ${stamp}` } }));
    await json(await api.post(`${BASE}/api/estimates/${estimate.id}/lines`, { data: { description: "Demo pavers", costType: "Material", quantity: 10, unit: "m2", unitCostCents: 10000, quantityVerified: true } }));
    if (which === "locked") {
      await json(await api.post(`${BASE}/api/estimates/${estimate.id}/action`, { data: { action: "approve", overrideReason: "e2e test of settings" } }));
      lockedId = estimate.id;
    } else draftId = estimate.id;
  }
  draftBefore = (await json(await api.get(`${BASE}/api/estimates/${draftId}`))).summary.pricing.sellIncGst;
  lockedBefore = (await json(await api.get(`${BASE}/api/estimates/${lockedId}`))).summary.pricing.sellIncGst;
  assert.equal(draftBefore, lockedBefore);
});

await step("owner edits markup and labour rate on a phone and saves", async () => {
  const p = owner.page;
  await p.goto(`${BASE}/settings`);
  await p.getByRole("link", { name: "Edit settings" }).click();
  await p.waitForURL(/\/settings\/edit/);
  await p.getByLabel("Default markup on cost").fill("40");
  await p.getByLabel("Default labour rate").fill("52");
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390, "no sideways scroll on a phone");
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.getByText("Saved 2 changes").waitFor();
  await p.goto(`${BASE}/settings`);
  const text = await p.innerText("main");
  assert.match(text, /Default markup on cost\s+40%/);
  assert.match(text, /\$52\.00 \/ person-hour/);
  assert.match(text, /Last changed by/);
});

await step("a payment schedule that doesn't add to 100% is blocked in the form", async () => {
  const p = owner.page;
  await p.goto(`${BASE}/settings/edit`);
  await p.getByLabel("Stage percent").first().fill("15");
  await p.getByText(/must be 100%/).first().waitFor();
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.getByRole("alert").getByText(/not 100%/).waitFor();
});

await step("the server rejects bad values too", async () => {
  const cur = (await json(await api.get(`${BASE}/api/settings`))).settings;
  const body = { ...cur, business: { name: cur.business.name, abn: "", licenceNumber: "", phone: "", email: "" } };
  const bad1 = await api.put(`${BASE}/api/settings`, { data: { ...body, pricing: { ...cur.pricing, gstRate: 10 } } });
  assert.equal(bad1.status(), 400);
  const bad2 = await api.put(`${BASE}/api/settings`, { data: { ...body, pricing: { ...cur.pricing, minMargin: 0.5, maxMargin: 0.2 } } });
  assert.equal(bad2.status(), 400);
  assert.match((await bad2.json()).error, /lowest margin/);
});

await step("the draft is repriced, the approved quote is not", async () => {
  const draftAfter = (await json(await api.get(`${BASE}/api/estimates/${draftId}`))).summary.pricing.sellIncGst;
  const lockedAfter = (await json(await api.get(`${BASE}/api/estimates/${lockedId}`))).summary.pricing.sellIncGst;
  assert.ok(draftAfter > draftBefore, `draft ${draftBefore} -> ${draftAfter}`);
  assert.equal(lockedAfter, lockedBefore);
});

await step("the change is in the Audit log", async () => {
  await owner.page.goto(`${BASE}/audit`);
  await owner.page.getByText(/Changed 2 settings/).first().waitFor();
});

await step("a manager can view but not change settings", async () => {
  const pw = `mgr-pass-${stamp}-x`;
  await json(await api.post(`${BASE}/api/people`, { data: { name: "Mo Demo", email: `mo.${stamp}@example.com`, role: "manager", password: pw } }));
  const m = await login(`mo.${stamp}@example.com`, pw);
  await m.page.goto(`${BASE}/settings`);
  assert.equal(await m.page.getByRole("link", { name: "Edit settings" }).count(), 0);
  const cur = (await json(await m.page.request.get(`${BASE}/api/settings`))).settings;
  const r = await m.page.request.put(`${BASE}/api/settings`, { data: { ...cur, business: { name: "X", abn: "", licenceNumber: "", phone: "", email: "" } } });
  assert.equal(r.status(), 403);
  await m.page.goto(`${BASE}/settings/edit`);
  assert.match(m.page.url(), /forbidden/);
});

await browser.close();
for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
