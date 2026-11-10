// End-to-end check of the money-safety fixes, on ATLAS's own database:
// double accept, declining an accepted quote, duplicate quote numbers, sessions
// ending when a password changes, the complete backup, and the health check.
// Needs a server with ATLAS_DATA_SOURCE=postgres and
// ATLAS_OWNER_EMAIL=owner@example.com / ATLAS_OWNER_PASSWORD=atlas-demo-2026.
// Usage: BASE_URL=http://localhost:3100 node tests/e2e/safety.mjs  (or: npm run e2e:all)
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message.split("\n")[0]]); }
}
const browser = await chromium.launch();
async function login(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 10_000 });
  return { ctx, page, api: page.request };
}
const ok = async (res) => { assert.ok(res.ok(), `${res.url()} answered ${res.status()}: ${await res.text()}`); return res.json(); };

const owner = await login("owner@example.com", "atlas-demo-2026");
const api = owner.api;
const backup = async () => ok(await api.get(`${BASE}/api/admin/export`));

let estimateId = "";
await step("two estimates started at the same moment get different quote numbers", async () => {
  const { customer } = await ok(await api.post(`${BASE}/api/customers`, { data: { name: "Casey Demo", suburb: "Kellyville", confirmNotDuplicate: true } }));
  const made = await Promise.all([1, 2, 3].map((n) => api.post(`${BASE}/api/estimates`, { data: { customerId: customer.id, title: `Paving job ${n}` } }).then(ok)));
  const numbers = made.map((m) => m.estimate.quoteNumber);
  assert.equal(new Set(numbers).size, 3, `quote numbers repeated: ${numbers}`);
  estimateId = made[0].estimate.id;
});

await step("accepting a quote twice at once makes one project and one full payment schedule", async () => {
  await ok(await api.post(`${BASE}/api/estimates/${estimateId}/lines`, { data: { description: "Demo pavers", costType: "Material", quantity: 40, unit: "m2", unitCostCents: 5500, priceIncludesGst: true, quantityVerified: true } }));
  await ok(await api.patch(`${BASE}/api/estimates/${estimateId}`, { data: { customerScope: "Supply and lay 40 m2 of pavers to the rear courtyard." } }));
  await ok(await api.post(`${BASE}/api/estimates/${estimateId}/action`, { data: { action: "approve", overrideReason: "Automated safety test, checks overridden on purpose" } }));
  await ok(await api.post(`${BASE}/api/estimates/${estimateId}/action`, { data: { action: "send", confirm: true } }));
  const accept = () => api.post(`${BASE}/api/estimates/${estimateId}/action`, { data: { action: "accept", confirm: true, acceptedBy: "Casey Demo", method: "Phone" } }).then(ok);
  const [a, b] = await Promise.all([accept(), accept()]);
  assert.equal(a.projectId, b.projectId);
  assert.deepEqual([a.payments, b.payments].sort(), [0, 5]);
  const data = await backup();
  const stages = data.entities.payments.filter((p) => p.paymentKey?.startsWith(`${estimateId}:`));
  assert.equal(stages.length, 5);
  const est = data.entities.estimates.find((e) => e.id === estimateId);
  assert.equal(stages.reduce((n, p) => n + p.amount, 0), est.customerTotalIncGst);
  assert.equal(data.entities.projects.filter((p) => p.estimateIds?.includes(estimateId)).length, 1);
});

await step("an accepted quote can't be declined", async () => {
  const res = await api.post(`${BASE}/api/estimates/${estimateId}/action`, { data: { action: "decline", reason: "Changed their mind" } });
  assert.equal(res.status(), 409);
  assert.match((await res.json()).error, /accepted/i);
  const est = (await backup()).entities.estimates.find((e) => e.id === estimateId);
  assert.equal(est.status, "Accepted");
});

const email = `sam.${Date.now().toString(36)}@example.com`;
await step("changing a password signs out that login's other devices, not the one that changed it", async () => {
  await ok(await api.post(`${BASE}/api/people`, { data: { name: "Sam Demo", email, role: "sales", password: "first-password-123" } }));
  const phone = await login(email, "first-password-123");
  const laptop = await login(email, "first-password-123");
  assert.equal((await laptop.api.get(`${BASE}/api/customers`)).status(), 200);
  await ok(await phone.api.post(`${BASE}/api/account/password`, { data: { current: "first-password-123", next: "second-password-456" } }));
  assert.equal((await phone.api.get(`${BASE}/api/customers`)).status(), 200, "the device that changed the password stays signed in");
  assert.equal((await laptop.api.get(`${BASE}/api/customers`)).status(), 401, "the other device is signed out");
  await phone.ctx.close(); await laptop.ctx.close();
  const again = await login(email, "second-password-456");
  await again.ctx.close();
});

await step("the backup holds logins and the audit log, and the files download lists every stored file", async () => {
  const { customer } = await ok(await api.post(`${BASE}/api/customers`, { data: { name: "Riley Demo", confirmNotDuplicate: true } }));
  const { inspection } = await ok(await api.post(`${BASE}/api/inspections`, { data: { customerId: customer.id, inspectionDate: "2026-11-12" } }));
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 7)]);
  const up = await ok(await api.post(`${BASE}/api/inspections/${inspection.id}/files`, { multipart: { file: { name: "site.jpg", mimeType: "image/jpeg", buffer: jpeg } } }));
  const data = await backup();
  assert.equal(data.version, 2);
  assert.ok(data.logins.some((u) => u.email === email && u.passwordHash.startsWith("scrypt$")));
  assert.ok(data.audit.some((a) => a.action === "estimate.accept"));
  assert.ok(data.files.some((f) => f.id === up.file.id));
  const tar = await api.get(`${BASE}/api/admin/export-files`);
  assert.equal(tar.status(), 200);
  const buf = await tar.body();
  assert.equal(buf.length % 512, 0);
  assert.equal(buf.subarray(0, 13).toString(), "manifest.json");
  assert.ok(buf.includes(Buffer.from(`files/${up.file.id}.jpg`)));
  assert.ok(buf.includes(jpeg));
  // A slice of the photo, as a phone asks for audio and large images.
  const part = await api.get(`${BASE}/api/files/${up.file.id}`, { headers: { Range: "bytes=2-5" } });
  assert.equal(part.status(), 206);
  assert.deepEqual([...(await part.body())], [0xff, 0xe0, 7, 7]);
});

await step("the backup page shows both downloads on a phone", async () => {
  const p = owner.page;
  await p.goto(`${BASE}/settings/data`);
  await p.getByRole("link", { name: "Download records (.json)" }).waitFor();
  await p.getByRole("link", { name: "Download photos and recordings (.tar)" }).waitFor();
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390);
});

await step("the health check answers without a login and gives nothing away", async () => {
  const ctx = await browser.newContext();
  const res = await ctx.request.get(`${BASE}/api/health`);
  assert.equal(res.status(), 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal((await ctx.request.get(`${BASE}/api/admin/export`)).status(), 401);
  assert.equal((await ctx.request.get(`${BASE}/api/admin/export-files`)).status(), 401);
  await ctx.close();
});

await browser.close();
for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
