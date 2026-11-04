// Suggestions while typing, on a phone screen: the Street address box (demo
// addresses in demo mode), and the boxes that suggest what's been typed before.
// Server: demo data with ATLAS_ALLOW_DEMO_LOGINS=1
// Usage: BASE_URL=http://localhost:3000 SHOTS_DIR=/tmp/shots node tests/e2e/suggestions.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message.split("\n")[0]]); if (SHOTS) await p.screenshot({ path: `${SHOTS}/FAIL-${results.length}.png`, fullPage: true }).catch(() => {}); }
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", "atlas-demo-2026");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
await login(p, "owner@example.com");
const noSideScroll = async () => assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390, "no sideways scrolling");
const option = (name) => p.getByRole("listbox", { name: "Suggestions" }).getByRole("option", { name });
let custId;

await step("street address: type the start, pick it, and the suburb fills in", async () => {
  await p.goto(`${BASE}/customers/new`);
  await p.fill("#name", "Riley Sample");
  await p.locator("#address").pressSequentially("135 exa", { delay: 40 });
  await option("135 Example Street, Waterloo NSW 2017").waitFor({ timeout: 10_000 });
  await p.getByText("Demo addresses (made up for testing)").waitFor();
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/address-suggest.png` });
  await option("135 Example Street, Waterloo NSW 2017").click();
  assert.equal(await p.inputValue("#address"), "135 Example Street");
  assert.equal(await p.inputValue("#suburb"), "Waterloo");
  await noSideScroll();
});

await step("tap common jobs to fill 'What do they want done?'", async () => {
  await p.getByRole("group", { name: "Common jobs" }).getByRole("button", { name: "+ Paving", exact: true }).click();
  await p.getByRole("group", { name: "Common jobs" }).getByRole("button", { name: "+ Retaining wall", exact: true }).click();
  assert.equal(await p.inputValue("#serviceRequested"), "Paving, retaining wall");
  await p.getByRole("button", { name: "Create customer" }).click();
  await p.waitForURL(/\/customers\/rec/);
  custId = p.url().split("/customers/")[1].split(/[?#]/)[0];
  const c = (await (await p.request.get(`${BASE}/api/customers/${custId}`)).json()).customer;
  assert.equal(c.address, "135 Example Street");
  assert.equal(c.suburb, "Waterloo");
  assert.equal(c.serviceRequested, "Paving, retaining wall");
});

await step("suburb suggests suburbs already in ATLAS; anything else can still be typed", async () => {
  await p.goto(`${BASE}/customers/new`);
  await p.locator("#suburb").pressSequentially("cas", { delay: 30 });
  await option("Castle Hill").click();
  assert.equal(await p.inputValue("#suburb"), "Castle Hill");
  await p.fill("#suburb", "Brand New Suburb");
  assert.equal(await p.inputValue("#suburb"), "Brand New Suburb");
});

await step("enquiry: job chips and next-action suggestions", async () => {
  await p.goto(`${BASE}/pipeline/new?customer=${custId}`);
  await p.getByRole("group", { name: "Common jobs" }).getByRole("button", { name: "+ New turf", exact: true }).click();
  assert.equal(await p.inputValue("#serviceRequested"), "New turf");
  await p.locator("#nextAction").click();
  await option("Call to book site visit").click();
  assert.equal(await p.inputValue("#nextAction"), "Call to book site visit");
  await noSideScroll();
});

await step("task: title and 'assigned to' suggest common entries and staff", async () => {
  await p.goto(`${BASE}/tasks/new`);
  await p.locator("#title").pressSequentially("send", { delay: 30 });
  await option("Send quote").click();
  await p.locator("#assignedTo").click();
  await option("Demo Worker").waitFor();
  await p.keyboard.press("Escape");
});

await step("Cost Library: unit, category and supplier suggest what's already there", async () => {
  await p.goto(`${BASE}/cost-library`);
  await p.getByRole("button", { name: "Add an item" }).click();
  const add = p.getByRole("form", { name: "Add an item" });
  await add.getByLabel("Supplier").pressSequentially("demo t", { delay: 30 });
  await option("Demo Turf Farm").waitFor();
  await option("Demo Tile Co").waitFor();
  await option("Demo Turf Farm").click();
  assert.equal(await add.getByLabel("Supplier").inputValue(), "Demo Turf Farm");
  await add.getByLabel("Unit").fill("bu");
  await option("Bulka Bag").click();
  if (SHOTS) await add.screenshot({ path: `${SHOTS}/cost-library-suggest.png` });
});

await step("measurement area suggests common areas, and the box clears after adding", async () => {
  const insp = (await (await p.request.post(`${BASE}/api/inspections`, { data: { customerId: custId, inspectionDate: "2026-11-05" } })).json()).inspection;
  await p.goto(`${BASE}/inspections/${insp.id}`);
  const m = p.getByRole("form", { name: "Add measurement" });
  await m.getByLabel("Area *").pressSequentially("back", { delay: 30 });
  await option("Back lawn").click();
  await m.locator("input[name=lengthM]").fill("10");
  await m.locator("input[name=widthM]").fill("4");
  await m.getByRole("button", { name: "Add measurement" }).click();
  await p.getByText(/Back lawn · /).waitFor();
  assert.equal(await m.getByLabel("Area *").inputValue(), "");
});

await step("the address lookup needs a few letters and is staff-only", async () => {
  const short = await (await p.request.get(`${BASE}/api/address/suggest?q=135`)).json();
  assert.deepEqual(short.suggestions, []);
  const other = await browser.newContext();
  const w = await other.newPage();
  await login(w, "worker@example.com");
  assert.equal((await w.request.get(`${BASE}/api/address/suggest?q=135+example`)).status(), 403);
  await other.close();
});

await browser.close();
for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
