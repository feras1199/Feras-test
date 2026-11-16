// End-to-end check of logins managed in ATLAS's own database.
// Needs a server with ATLAS_DATA_SOURCE=postgres, an empty-ish database, and
// ATLAS_OWNER_EMAIL=owner@example.com / ATLAS_OWNER_PASSWORD=atlas-demo-2026.
// Usage: BASE_URL=http://localhost:3100 node tests/e2e/people.mjs
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

const stamp = Date.now().toString(36);
const workerEmail = `jo.${stamp}@example.com`;
let workerPw = "";
const owner = await login("owner@example.com", "atlas-demo-2026");

await step("owner (from host variables) adds a worker login on a phone", async () => {
  const p = owner.page;
  await p.goto(`${BASE}/settings`);
  await p.getByRole("link", { name: "People and logins" }).click();
  await p.getByText("Set on the server").first().waitFor();
  const form = p.getByRole("form", { name: "Add someone" });
  await form.getByLabel("Name *").fill("Jo Demo");
  await form.getByLabel("Email *").fill(workerEmail);
  await form.getByLabel("Role *").selectOption("worker");
  workerPw = await form.getByLabel("Starting password").inputValue();
  assert.ok(workerPw.length >= 14);
  await form.getByRole("button", { name: "Add login" }).click();
  await p.getByText("The password is shown only now").waitFor();
  assert.match(await p.getByRole("status").innerText(), new RegExp(workerPw));
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390);
  const dup = await p.request.post(`${BASE}/api/people`, { data: { name: "Dup", email: workerEmail.toUpperCase(), role: "worker", password: "another-pass-123" } });
  assert.equal(dup.status(), 409);
  const hostDup = await p.request.post(`${BASE}/api/people`, { data: { name: "Dup", email: "owner@example.com", role: "owner", password: "another-pass-123" } });
  assert.equal(hostDup.status(), 409);
  const list = await (await p.request.get(`${BASE}/api/people`)).json();
  assert.ok(!JSON.stringify(list).includes("scrypt"), "password hashes must never be sent");
});

let worker;
await step("the worker signs in, sees worker pages only, and changes their password", async () => {
  worker = await login(workerEmail, workerPw);
  const nav = await worker.page.innerText("nav");
  assert.doesNotMatch(nav, /Customers|Settings|Finance|Estimates/);
  assert.equal((await worker.page.request.get(`${BASE}/api/people`)).status(), 403);
  assert.equal((await worker.page.request.post(`${BASE}/api/people`, { data: { name: "Sneaky", email: "s@example.com", role: "owner", password: "sneaky-pass-123" } })).status(), 403);
  await worker.page.goto(`${BASE}/account`);
  const f = worker.page.getByRole("form", { name: "Change password" });
  await f.getByLabel("Current password").fill("wrong-password");
  await f.getByLabel("New password (10+ characters)").fill("jo-new-password-1");
  await f.getByLabel("New password again").fill("jo-new-password-1");
  await f.getByRole("button", { name: "Change password" }).click();
  await worker.page.getByText("Your current password isn't right").waitFor();
  await f.getByLabel("Current password").fill(workerPw);
  await f.getByRole("button", { name: "Change password" }).click();
  await worker.page.getByText("Password changed.").waitFor();
  const old = await worker.page.request.post(`${BASE}/api/auth/login`, { data: { email: workerEmail, password: workerPw } });
  assert.equal(old.status(), 401);
  workerPw = "jo-new-password-1";
});

await step("owner's own host login can't be changed in the app", async () => {
  const p = owner.page;
  await p.goto(`${BASE}/account`);
  await p.getByText("ATLAS_OWNER_PASSWORD").waitFor();
  const people = (await (await p.request.get(`${BASE}/api/people`)).json()).people;
  const me = people.find((x) => x.email === "owner@example.com");
  assert.equal((await p.request.patch(`${BASE}/api/people/${me.id}`, { data: { active: false } })).status(), 409);
});

await step("promoting the worker signs them out; switching them off blocks them", async () => {
  const p = owner.page;
  await p.goto(`${BASE}/settings/people`);
  p.once("dialog", (d) => d.accept());
  await p.getByLabel("Role for Jo Demo").selectOption("supervisor");
  await p.waitForTimeout(800);
  await worker.page.goto(`${BASE}/`);
  assert.match(worker.page.url(), /\/login/);
  worker = await login(workerEmail, workerPw);
  assert.match(await worker.page.innerText("nav"), /Schedule|Customers|Inspections/);
  await p.reload();
  p.once("dialog", (d) => d.accept());
  await p.locator("li").filter({ hasText: workerEmail }).getByRole("button", { name: "Switch off" }).click();
  await p.getByText("Switched off").waitFor();
  await worker.page.goto(`${BASE}/`);
  assert.match(worker.page.url(), /\/login/);
  const again = await worker.page.request.post(`${BASE}/api/auth/login`, { data: { email: workerEmail, password: workerPw } });
  assert.equal(again.status(), 401);
});

await step("customer logins must be linked to a real customer record", async () => {
  const p = owner.page;
  const bad = await p.request.post(`${BASE}/api/people`, { data: { name: "Cust", email: `c.${stamp}@example.com`, role: "customer", password: "customer-pass-1" } });
  assert.equal(bad.status(), 400);
  const missing = await p.request.post(`${BASE}/api/people`, { data: { name: "Cust", email: `c.${stamp}@example.com`, role: "customer", customerId: "recNope0000000000", password: "customer-pass-1" } });
  assert.equal(missing.status(), 400);
});

await step("the people change history is in the permanent audit log", async () => {
  await owner.page.goto(`${BASE}/audit`);
  const t = await owner.page.innerText("main");
  assert.match(t, /Kept permanently in the ATLAS database/);
  assert.match(t, /Added login for Jo Demo \(worker\)/);
  assert.match(t, /Jo Demo changed their password/);
  assert.match(t, /Updated login for Jo Demo \(switched off\)/);
});

await browser.close();
for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
