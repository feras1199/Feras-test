// Three fictional customers, three different jobs, run through ATLAS on a phone
// screen from first contact to payment. Checks the features feras asked for:
// time on bookings, contact links, Cost Library editing, voice notes with the AI
// write-up (demo stand-in), change requests, and the money flow.
// Server: demo data with ATLAS_ALLOW_DEMO_LOGINS=1 ATLAS_AI_DEMO=1
// Usage: BASE_URL=http://localhost:3000 SHOTS_DIR=/tmp/shots node tests/e2e/three-projects.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push(["PASS", name, `${((Date.now() - t) / 1000).toFixed(1)}s`]); }
  catch (e) { results.push(["FAIL", name, e.message.split("\n")[0]]); if (SHOTS) await p.screenshot({ path: `${SHOTS}/FAIL-${results.length}.png` }).catch(() => {}); }
}
const shot = async (name, loc) => { if (SHOTS) await (loc ?? p).screenshot({ path: `${SHOTS}/${name}.png` }); };

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["microphone"] });
const p = await ctx.newPage();
await p.goto(`${BASE}/login`);
await p.fill("#email", "owner@example.com");
await p.fill("#password", "atlas-demo-2026");
await p.click("button[type=submit]");
await p.waitForURL((u) => !u.pathname.startsWith("/login"));
const run = Date.now().toString().slice(-4);

async function newCustomer(c) {
  await p.goto(`${BASE}/customers/new`);
  await p.fill("#name", c.name);
  await p.fill("#phone", c.phone);
  if (c.email) await p.fill("#email", c.email);
  await p.fill("#address", c.address);
  await p.fill("#suburb", c.suburb);
  await p.getByRole("button", { name: "Create customer" }).click();
  const dup = p.getByRole("button", { name: "It's a different person, save anyway" });
  await Promise.race([p.waitForURL(/\/customers\/rec/), dup.waitFor()]);
  if (!/\/customers\/rec/.test(p.url())) { await dup.click(); await p.waitForURL(/\/customers\/rec/); }
  return p.url().split("/").pop();
}
async function newEnquiry(custId, want, budget) {
  await p.goto(`${BASE}/pipeline/new`);
  await p.selectOption("#customerId", custId);
  await p.fill("#serviceRequested", want);
  if (budget) await p.fill("#budget", budget);
  await p.getByRole("button", { name: "Create enquiry" }).click();
  await p.waitForURL((u) => !u.pathname.endsWith("/new"));
}
async function bookInspection(custId, time) {
  await p.goto(`${BASE}/inspections/new?customer=${custId}`);
  await p.locator("input[name=time]").fill(time);
  await p.getByRole("button", { name: "Book inspection" }).click();
  await p.waitForURL(/\/inspections\/rec/);
  return p.url();
}
async function addMeasurement(area, work, unit, l, w) {
  const m = p.getByRole("form", { name: "Add measurement" });
  await m.getByLabel("Area *").fill(area);
  await m.locator("select[name=workType]").selectOption(work);
  await m.locator("select").nth(1).selectOption(unit);
  await m.locator("input[name=lengthM]").fill(String(l));
  if (w) await m.locator("input[name=widthM]").fill(String(w));
  await m.getByRole("button", { name: "Add measurement" }).click();
  await p.getByText(`${area} · ${work}`).waitFor();
}
async function completeInspection() {
  await p.locator("input[name=complete]").check();
  await p.getByRole("button", { name: "Save notes" }).click();
  await p.getByRole("status").filter({ hasText: /^Saved/ }).waitFor();
}
async function estimateFrom(inspUrl) {
  await p.goto(inspUrl);
  await p.getByRole("link", { name: "Start estimate" }).click();
  await p.waitForURL(/\/estimates\/new/);
  await p.getByRole("button", { name: /Create draft/ }).click();
  await p.waitForURL(/\/estimates\/rec/);
  return p.url();
}
/** Picks the option whose text matches, for selects whose labels include extra detail. */
async function selectByText(sel, re) {
  const opts = await sel.locator("option").evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent ?? "" })));
  const hit = opts.find((o) => re.test(o.t));
  if (!hit) throw new Error(`no option matching ${re} in ${opts.map((o) => o.t).join(" | ")}`);
  await sel.selectOption(hit.v);
}
const desc = () => p.getByRole("combobox", { name: "Description *" });
async function addLine(search, pick, qty, { measured } = {}) {
  await desc().fill(search);
  const lb = p.getByRole("listbox", { name: "Cost Library matches" });
  await lb.waitFor();
  await lb.getByRole("option").filter({ hasText: pick }).first().click();
  if (measured) await selectByText(p.getByLabel("Quantity from a site measurement"), new RegExp(measured));
  else await p.locator("input[name=quantity]").fill(String(qty));
  await p.locator("input[name=quantityVerified]").check();
  await p.getByRole("button", { name: "Add line" }).click();
  await desc().and(p.locator('[value=""]')).waitFor();
}
async function scopeAndApprove(scope, exclusions) {
  await p.locator("textarea[name=customerScope]").fill(scope);
  await p.locator("textarea[name=assumptions]").fill(exclusions);
  await p.locator("input[name=assumptionsResolved]").check();
  await p.getByRole("button", { name: "Save scope" }).click();
  await p.waitForTimeout(800);
  await p.reload();
  await p.getByRole("button", { name: "Approve price" }).click();
  const dlg = p.getByRole("dialog");
  const failing = await dlg.getByText("check(s) are failing").count();
  if (failing) throw new Error(`approval checks failing: ${(await dlg.innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
  const total = (await dlg.locator("strong").first().innerText()).trim();
  await dlg.getByRole("button", { name: "Approve and lock" }).click();
  await p.getByRole("button", { name: "Mark as sent" }).waitFor();
  return total;
}
async function sendAndAccept(name) {
  await p.getByRole("button", { name: "Mark as sent" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Yes, it's been sent" }).click();
  await p.getByRole("button", { name: "Record acceptance" }).click();
  const acc = p.getByRole("dialog");
  await acc.getByLabel("Accepted by *").fill(name);
  await acc.getByRole("button", { name: "Record acceptance" }).click();
  await acc.waitFor({ state: "detached" });
}

const summary = {};

// ───────────── Job 1: retaining wall and drainage, written up from voice notes ─────────────
const J1 = { name: `Mia Chen ${run}`, phone: `0412 ${run} 101`, email: "mia.chen@example.com", address: "4 Fictional Way", suburb: "Castle Hill" };
let c1, insp1, est1;
await step("Job 1 · new customer, enquiry and a 9:30 am site visit", async () => {
  c1 = await newCustomer(J1);
  await newEnquiry(c1, "Sandstone retaining wall along the back fence and fix the drainage", "18000");
  insp1 = await bookInspection(c1, "09:30");
  assert.match(await p.locator("h1").locator("..").innerText(), /9:30 am/);
  await p.goto(`${BASE}/inspections`);
  assert.match(await p.innerText("main"), /9:30 am/);
});
await step("Job 1 · contact buttons: WhatsApp, call, email and map", async () => {
  await p.goto(insp1);
  const c = p.getByLabel("Contact");
  assert.equal(await c.getByRole("link", { name: "WhatsApp" }).getAttribute("href"), `https://wa.me/61412${run}101`);
  assert.equal(await c.getByRole("link", { name: "Call" }).getAttribute("href"), `tel:+61412${run}101`);
  assert.equal(await c.getByRole("link", { name: "Email" }).getAttribute("href"), "mailto:mia.chen@example.com");
  assert.match(await c.getByRole("link", { name: "Map" }).getAttribute("href"), /google\.com\/maps\/search\/\?api=1&query=4%20Fictional%20Way%2C%20Castle%20Hill/);
  await shot("job1-contact", p.locator("main"));
});
await step("Job 1 · three voice notes, then the AI fills the site notes and writes a summary", async () => {
  await p.goto(insp1);
  // Something typed by hand first: the AI must leave it alone.
  await p.locator("textarea[name=risks]").fill("Owner's note: neighbours are sensitive about noise before 8 am");
  await p.getByRole("button", { name: "Save notes" }).click();
  await p.getByRole("status").filter({ hasText: /^Saved/ }).waitFor();
  for (let i = 0; i < 3; i++) {
    await p.getByRole("button", { name: "● Record a voice note" }).click();
    await p.waitForTimeout(1600);
    const filled = p.waitForResponse((r) => r.url().includes("/ai-fill"), { timeout: 30_000 });
    await p.getByRole("button", { name: "Stop and save" }).click();
    assert.equal((await filled).status(), 200);
    await p.getByRole("heading", { name: `Voice notes (${i + 1})` }).waitFor();
  }
  const box = p.getByLabel("AI write-up");
  await box.getByText("Meeting summary").waitFor();
  await box.getByText(/Filled in:|No empty boxes needed filling/).waitFor();
  const done = await box.getByRole("status").innerText();
  await shot("job1-ai-writeup", p.locator('section[aria-label="Photos and voice notes"]'));
  const val = (n) => p.locator(`textarea[name=${n}]`).inputValue();
  assert.match(await val("scope"), /retaining wall/i, "What the customer wants");
  assert.match(await val("drainage"), /ag pipe/i, "Drainage");
  assert.match(await val("services"), /sewer/i, "Services");
  assert.match(await val("slopeLevels"), /300 mm/, "Slope and levels");
  assert.match(await val("priorities"), /natural|sandstone/i, "Priorities");
  assert.equal(await val("risks"), "Owner's note: neighbours are sensitive about noise before 8 am", "hand-written risks must be kept");
  assert.match(done, /Left your own writing in: Risks and hazards/);
  assert.equal(await p.locator("input[name=accessWidthM]").inputValue(), "1.1");
  assert.equal(await p.locator("details").filter({ hasText: "What was said" }).count(), 3);
  summary.job1Filled = done;
  await p.locator("textarea[name=scope]").scrollIntoViewIfNeeded();
  await shot("job1-filled-notes");
});
await step("Job 1 · measure, estimate from the Cost Library, approve, send, accept", async () => {
  await p.goto(insp1);
  await addMeasurement("Back fence wall", "Retaining Wall", "lm", 12);
  await completeInspection();
  est1 = await estimateFrom(insp1);
  await addLine("wall block", /Sandstone wall block/, 48);
  await addLine("ag pipe", /Ag pipe/, 12);
  await addLine("blue metal", /Blue metal/, 2);
  await addLine("skip", /Skip bin/, 1);
  await addLine("labourer", /Labourer/, 32);
  summary.job1Total = await scopeAndApprove("Build a 12 m sandstone block retaining wall along the back fence with ag pipe drainage behind it, connected to the existing stormwater pit.", "No rock excavation. Council approval not needed under 600 mm; owner to confirm.");
  await sendAndAccept("Mia Chen");
});

// ───────────── Job 2: front garden and turf, with Cost Library changes ─────────────
const J2 = { name: `Luca Romano ${run}`, phone: `0423 ${run} 202`, address: "9 Sample Avenue", suburb: "Kellyville" };
let c2, insp2;
const NEW_ITEM = `Kikuyu turf roll (test ${run})`;
await step("Job 2 · Cost Library: add a new item and change a price", async () => {
  await p.goto(`${BASE}/cost-library`);
  await p.getByRole("button", { name: "Add an item" }).click();
  const add = p.getByRole("form", { name: "Add an item" });
  await add.getByLabel("Name *").fill(NEW_ITEM);
  await add.getByLabel(/Price inc GST/).fill("9.80");
  await add.getByLabel("Unit").fill("m2");
  await add.getByLabel("Category").fill("Turf");
  await add.getByLabel("Supplier").fill("Demo Turf Farm");
  await add.getByRole("button", { name: "Add to Cost Library" }).click();
  await p.getByRole("status").filter({ hasText: `Added ${NEW_ITEM}` }).waitFor();
  await p.fill("#cl-search", "garden mix");
  await p.getByRole("button", { name: /Edit Garden mix soil/ }).click();
  const ed = p.getByRole("form", { name: /Edit Garden mix soil/ });
  await ed.getByLabel(/Price inc GST/).fill("95.00");
  await shot("job2-cost-library-edit");
  await ed.getByRole("button", { name: "Save" }).click();
  await p.getByRole("status").filter({ hasText: "Saved Garden mix soil" }).waitFor();
  // The list redraws after saving, so wait for the new price rather than reading it straight away.
  await p.getByRole("list", { name: "Cost Library items" }).getByText(/\$95\.00/).first().waitFor();
  await p.fill("#cl-search", "kikuyu");
  await p.getByRole("list", { name: "Cost Library items" }).getByText(/\$9\.80/).first().waitFor();
});
await step("Job 2 · customer, enquiry, 2:00 pm visit with photos, measurements", async () => {
  c2 = await newCustomer(J2);
  await newEnquiry(c2, "New front garden beds with natives and fresh turf", "9000");
  insp2 = await bookInspection(c2, "14:00");
  assert.match(await p.locator("main").innerText(), /2:00 pm/);
  const png = await p.screenshot({ clip: { x: 0, y: 0, width: 200, height: 150 } });
  await p.locator('input[type=file][accept="image/*"]').setInputFiles([{ name: "a.png", mimeType: "image/png", buffer: png }, { name: "b.png", mimeType: "image/png", buffer: png }]);
  await p.getByText("2 photos saved.").waitFor({ timeout: 15_000 });
  await addMeasurement("Front lawn", "Turfing", "m²", 10, 6);
  await addMeasurement("Garden beds", "Planting", "m²", 8, 1.5);
  await p.locator("textarea[name=scope]").fill("Front garden: two native beds and new turf.");
  await completeInspection();
});
await step("Job 2 · estimate uses the new item and the new price, approve, accept", async () => {
  const est = await estimateFrom(insp2);
  await desc().fill("kikuyu");
  const lb = p.getByRole("listbox", { name: "Cost Library matches" });
  await lb.waitFor();
  assert.match(await lb.innerText(), /\$9\.80 \/ m2/);
  await lb.getByRole("option").first().click();
  await selectByText(p.getByLabel("Quantity from a site measurement"), /Front lawn/);
  await p.locator("input[name=quantityVerified]").check();
  await p.getByRole("button", { name: "Add line" }).click();
  await desc().and(p.locator('[value=""]')).waitFor();
  await desc().fill("garden mix");
  await lb.waitFor();
  assert.match(await lb.innerText(), /\$95\.00/);
  await lb.getByRole("option").first().click();
  await p.locator("input[name=quantity]").fill("3");
  await p.locator("input[name=quantityVerified]").check();
  await p.getByRole("button", { name: "Add line" }).click();
  await desc().and(p.locator('[value=""]')).waitFor();
  await addLine("lomandra", /Lomandra/, 24);
  await addLine("mulch", /Hardwood mulch/, 2);
  await addLine("labourer", /Labourer/, 20);
  summary.job2Total = await scopeAndApprove("Prepare and turf 60 m² of front lawn with kikuyu. Build two native garden beds with garden mix, Lomandra and hardwood mulch.", "Irrigation not included. Existing lawn removed to green waste.");
  await sendAndAccept("Luca Romano");
  summary.job2Estimate = est;
});

// ───────────── Job 3: concrete driveway, change request and getting paid ─────────────
const J3 = { name: `Priya Nair ${run}`, phone: `+61 434 ${run} 33`, email: "priya.nair@example.com", address: "21 Placeholder Road", suburb: "Baulkham Hills" };
let c3, insp3, deposit;
await step("Job 3 · customer with an international-format number, 7:45 am visit", async () => {
  c3 = await newCustomer(J3);
  await p.goto(`${BASE}/customers/${c3}`);
  assert.equal(await p.getByLabel("Contact").getByRole("link", { name: "WhatsApp" }).getAttribute("href"), `https://wa.me/61434${run}33`);
  await newEnquiry(c3, "Replace cracked front driveway with exposed aggregate", "25000");
  insp3 = await bookInspection(c3, "07:45");
  assert.match(await p.locator("main").innerText(), /7:45 am/);
  await addMeasurement("Driveway", "Concrete Driveway", "m²", 12, 4);
  await p.locator("textarea[name=scope]").fill("Remove the old driveway and pour a new exposed aggregate one.");
  await completeInspection();
});
await step("Job 3 · estimate, approve, send, accept", async () => {
  await estimateFrom(insp3);
  await addLine("road base", /Road base/, 10);
  await addLine("cement", /Cement GP/, 40);
  await addLine("skip", /Skip bin/, 2);
  await addLine("labourer", /Labourer/, 40);
  summary.job3Total = await scopeAndApprove("Break out and remove the existing 48 m² driveway, prepare road base and pour a new exposed aggregate driveway.", "Council crossover permit by owner. Sealer not included.");
  await sendAndAccept("Priya Nair");
});
await step("Job 3 · Finance: deposit is due, mark it received", async () => {
  await p.goto(`${BASE}/finance`);
  const row = p.locator("li").filter({ hasText: "Priya Nair" }).filter({ hasText: /Deposit/ }).first();
  await row.waitFor();
  deposit = (await row.innerText()).replace(/\s+/g, " ");
  await row.locator("summary", { hasText: "Mark received" }).click();
  await row.getByRole("button", { name: /Confirm .* received/ }).click();
  await p.waitForTimeout(1000);
  await p.goto(`${BASE}/finance`);
  assert.doesNotMatch(await p.locator("main").innerText(), new RegExp(`Priya Nair ${run}[^\\n]*Deposit[^\\n]*Mark received`));
  summary.job3Deposit = deposit;
});
await step("Job 3 · a change request goes to the owner, not into the app", async () => {
  const r = await p.request.post(`${BASE}/api/change-requests`, { data: { title: `Show the deposit on the quote (${run})`, what: "Put the deposit amount in bold at the top of the quote PDF.", why: "Customers ask how much to pay first.", where: "Quote document", size: "small" } });
  assert.equal(r.status(), 200);
  await p.goto(`${BASE}/settings`);
  const cr = p.getByRole("region", { name: "Change requests" });
  await cr.getByText(`Show the deposit on the quote (${run})`).waitFor();
});

// ───────────── All three ─────────────
await step("All three jobs show as projects, enquiries are Won, nothing leaked between them", async () => {
  await p.goto(`${BASE}/projects`);
  const t = await p.locator("main").innerText();
  for (const n of [J1.name, J2.name, J3.name]) assert.match(t, new RegExp(n));
  for (const c of [c1, c2, c3]) {
    await p.goto(`${BASE}/customers/${c}`);
    assert.match(await p.locator("main").innerText(), /Won/);
  }
  await p.goto(`${BASE}/audit`);
  const a = await p.locator("main").innerText();
  assert.match(a, /AI wrote up 3 voice note\(s\) \(demo stand-in\)/);
  assert.match(a, /Cost Library: Garden mix soil: price/);
  await shot("projects");
});

await browser.close();
for (const r of results) console.log(r.join("  "));
console.log(JSON.stringify(summary, null, 2));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
