// End-to-end smoke test against a running ATLAS server in memory (demo) mode.
// Usage: BASE_URL=http://localhost:3000 node tests/e2e/run.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PW = "atlas-demo-2026";
const shots = "test-results";
fs.mkdirSync(shots, { recursive: true });
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message.split("\n")[0]]); }
}

const browser = await chromium.launch();
async function login(email, viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
  return { ctx, page };
}

await step("unauthenticated users are sent to login", async () => {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(`${BASE}/customers`);
  assert.match(page.url(), /\/login\?next=%2Fcustomers/);
  const res = await page.request.get(`${BASE}/api/customers`);
  assert.equal(res.status(), 401);
  await ctx.close();
});

await step("wrong password is rejected", async () => {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", "owner@example.com"); await page.fill("#password", "wrong-password");
  await page.click("button[type=submit]");
  await page.locator("p[role=alert]").waitFor();
  assert.match(await page.locator("p[role=alert]").innerText(), /incorrect/);
  await ctx.close();
});

const owner = await login("owner@example.com");
await step("owner sees Today with real action items", async () => {
  await owner.page.getByRole("heading", { name: /Good (morning|afternoon|evening), Demo/ }).waitFor();
  const text = await owner.page.innerText("main");
  assert.match(text, /Action list/);
  assert.match(text, /Overdue payments/i);
  assert.match(text, /Sam & Jo Demo/);
  await owner.page.screenshot({ path: `${shots}/today-owner.png`, fullPage: true });
});
await step("global search finds a customer by phone", async () => {
  await owner.page.fill("#global-search", "570 003");
  await owner.page.getByRole("link", { name: /Taylor Demo/ }).first().waitFor();
});
await step("create customer, duplicate warning, then save", async () => {
  await owner.page.goto(`${BASE}/customers/new`);
  await owner.page.fill("#name", "Casey Demo");
  await owner.page.fill("#phone", "+61 491 570 001");
  await owner.page.click("button[type=submit]");
  await owner.page.getByText("This may already be a customer").waitFor();
  assert.match(await owner.page.locator("form [role=alert]").innerText(), /Alex Demo.*same phone/);
  await owner.page.fill("#phone", "0491 570 099");
  await owner.page.fill("#email", "casey.demo@example.com");
  await owner.page.click("button[type=submit]");
  await owner.page.waitForURL(/\/customers\/rec/);
  await owner.page.getByRole("heading", { name: "Casey Demo" }).waitFor();
});
await step("edit customer and see it in the audit log", async () => {
  await owner.page.getByRole("link", { name: "Edit details" }).click();
  await owner.page.fill("#suburb", "Kellyville");
  await owner.page.click("button[type=submit]");
  await owner.page.waitForURL((u) => !u.search.includes("edit"));
  await owner.page.getByText("Casey Demo").first().waitFor();
  await owner.page.goto(`${BASE}/audit`);
  const t = await owner.page.innerText("main");
  assert.match(t, /Created customer Casey Demo/);
  assert.match(t, /Updated Casey Demo: suburb/);
});
await step("settings show the configured business rules", async () => {
  await owner.page.goto(`${BASE}/settings`);
  const t = await owner.page.innerText("main");
  assert.match(t, /30%/); assert.match(t, /23\.1% gross margin/); assert.match(t, /QuickBooks\s*Not connected/);
});

await step("pipeline: new enquiry, log contact, move, lose with reason", async () => {
  const p = owner.page;
  await p.goto(`${BASE}/pipeline/new`);
  await p.selectOption("#customerId", { label: "Casey Demo · Kellyville · 0491 570 099" });
  await p.fill("#serviceRequested", "Timber deck, about 20 m2");
  await p.fill("#budget", "15000");
  await p.click("button[type=submit]");
  await p.waitForURL(/\/pipeline$/);
  const col = p.getByRole("region", { name: "New" });
  await col.getByRole("button", { name: /Casey Demo/ }).click();
  await p.getByRole("dialog").locator("input[name=summary]").fill("Called, booked a site visit");
  await p.getByRole("dialog").locator("#status").selectOption("Site Visit Booked");
  await p.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await p.getByRole("region", { name: "Visit booked" }).getByRole("button", { name: /Casey Demo/ }).waitFor();
  await p.getByRole("region", { name: "Visit booked" }).getByRole("button", { name: /Casey Demo/ }).click();
  await p.getByRole("dialog").locator("#status").selectOption("Lost");
  await p.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  assert.ok(await p.getByRole("dialog").locator("#reason:invalid").count(), "lost reason should be required");
  await p.getByRole("dialog").locator("#reason").selectOption("Timing");
  await p.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await p.getByRole("dialog").waitFor({ state: "detached" });
  await p.goto(`${BASE}/pipeline?show=closed`);
  await p.getByRole("region", { name: "Lost" }).getByText("Timing").waitFor();
  await p.goto(`${BASE}/customers`);
  await p.getByRole("link", { name: "Casey Demo" }).click();
  await p.getByRole("heading", { name: "Contact history" }).waitFor();
  const t = await p.innerText("main");
  assert.match(t, /Called, booked a site visit/);
  assert.match(t, /Lost/);
  await p.screenshot({ path: `${shots}/customer-detail.png`, fullPage: true });
});
await step("tasks: create and complete", async () => {
  const p = owner.page;
  await p.goto(`${BASE}/tasks/new`);
  await p.fill("#title", "Order deck timber sample");
  await p.click("button[type=submit]");
  await p.waitForURL(/\/tasks$/);
  await p.getByRole("button", { name: 'Mark "Order deck timber sample" done' }).click();
  await p.goto(`${BASE}/tasks?view=done`);
  await p.getByText("Order deck timber sample").waitFor();
});

let acceptedEstimateUrl = "";
await step("inspection: book, measure, complete", async () => {
  const p = owner.page;
  await p.goto(`${BASE}/inspections/new?enquiry=recDemoEnq0000001`);
  await p.getByRole("button", { name: "Book inspection" }).click();
  await p.waitForURL(/\/inspections\/rec/);
  const f = p.getByRole("form", { name: "Add measurement" });
  await f.getByLabel("Area *").fill("Rear patio");
  await f.getByLabel("Length (m)").fill("10");
  await f.getByLabel("Width (m)").fill("5");
  await f.getByRole("button", { name: "Add measurement" }).click();
  await p.getByText("50 m²").waitFor();
  await p.getByLabel("Existing conditions").fill("Old concrete slab to break out");
  await p.getByLabel("Inspection complete").check();
  await p.getByRole("button", { name: "Save notes" }).click();
  await p.getByRole("status").waitFor();
});
await step("estimate: build, check, approve, quote, send, accept", async () => {
  const p = owner.page;
  await p.goto(`${BASE}/estimates/new?customer=recDemoCust000001`);
  await p.selectOption("#enquiry", { index: 1 });
  await p.fill("#title", "Rear yard paving and turf");
  await p.click("button[type=submit]");
  await p.waitForURL(/\/estimates\/rec/);
  acceptedEstimateUrl = p.url();
  const form = p.getByRole("form", { name: "Add line" });
  async function addLine(type, desc, qty, price, opts = {}) {
    await form.getByLabel("Type").selectOption(type);
    await form.getByLabel("Description *").fill(desc);
    if (opts.measurement) await form.getByLabel("Quantity from a site measurement").selectOption({ label: opts.measurement });
    else await form.locator("input[name=quantity]").fill(String(qty));
    await form.getByLabel(/Unit price|Rate per person-hour/).fill(String(price));
    if (opts.exGst) await form.getByLabel("Price includes GST").uncheck();
    if (opts.waste) await form.getByLabel("Waste %").fill(String(opts.waste));
    await form.getByLabel("Quantity checked against measurements").check();
    await form.getByRole("button", { name: "Add line" }).click();
    await p.getByRole("cell", { name: desc }).first().waitFor();
    await p.waitForTimeout(300);
  }
  // 50 m2 @ $44 inc GST + 8% waste = $2,160 ex GST
  await addLine("Material", "Sandstone pavers", 50, 44, { waste: 8, measurement: "Rear patio · Paving: 50 m²" });
  await addLine("Labour", "Lay pavers, 2 people x 4 days", 64, 45);
  await addLine("Disposal", "Skip bin", 1, 495);
  await addLine("Material", "Road base and sand", 1, 1452, { exGst: true });
  await p.screenshot({ path: `${shots}/estimate.png`, fullPage: true });
  let t = await p.innerText("main");
  // cost 2160 + 2880 + 450 + 1452 = 6942 -> x1.3 = 9024.60 -> +GST 902.46 = 9927.06
  assert.match(t, /\$6,942\.00/);
  assert.match(t, /\$9,927\.06/);
  assert.match(t, /Customer scope written/);
  assert.match(t, /\+8% waste/);
  await p.getByLabel("What's included").fill("Supply and lay 50 m² of sandstone pavers on a compacted road base.");
  await p.getByLabel("Exclusions and assumptions have been reviewed").check();
  await p.getByRole("button", { name: "Save scope" }).click();
  await p.waitForTimeout(800);
  await p.getByRole("button", { name: "Approve price" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Approve and lock" }).click();
  await p.getByText("Locked").waitFor();
  await p.getByRole("link", { name: "Quote document" }).click();
  const q = await p.innerText("article");
  assert.match(q, /Total including GST\s*\$9,927\.06/);
  assert.doesNotMatch(q, /markup|margin|Skip bin|Lay pavers|6,942/i);
  await p.screenshot({ path: `${shots}/quote.png`, fullPage: true });
  await p.getByRole("link", { name: "Back to estimate" }).click();
  await p.getByRole("button", { name: "Mark as sent" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Yes, it's been sent" }).click();
  await p.getByRole("button", { name: "Record acceptance" }).click();
  await p.getByRole("dialog").getByLabel("Accepted by *").fill("Alex Demo");
  await p.getByRole("dialog").getByRole("button", { name: "Record acceptance" }).click();
  await p.getByText("The project and payment schedule have been created").waitFor();
  await p.goto(`${BASE}/audit`);
  t = await p.innerText("main");
  assert.match(t, /accepted by Alex Demo \(Signed quote\)\. 5 payment stages created totalling \$9,927\.06/);
});
await step("sales can build but not approve; locked estimate rejects edits", async () => {
  const sales = await login("sales@example.com");
  await sales.page.goto(acceptedEstimateUrl);
  assert.equal(await sales.page.getByRole("button", { name: /Approve price|Record acceptance/ }).count(), 0);
  const id = acceptedEstimateUrl.split("/").pop();
  const r = await sales.page.request.post(`${BASE}/api/estimates/${id}/lines`, { data: { description: "Sneaky", costType: "Material", quantity: 1, unitCostCents: 100 } });
  assert.equal(r.status(), 409);
  const a = await sales.page.request.post(`${BASE}/api/estimates/${id}/action`, { data: { action: "approve" } });
  assert.equal(a.status(), 403);
  await sales.ctx.close();
});

await step("project: checklist, schedule, cost, variation approval", async () => {
  const p = owner.page;
  await p.goto(`${BASE}/projects`);
  await p.getByRole("link", { name: /Taylor Demo – Front Yard/ }).click();
  await p.getByRole("heading", { name: "Checklists" }).waitFor();
  let t = await p.innerText("main");
  assert.match(t, /\$38,500/); // contract
  assert.match(t, /\$495\.00 of costs not allocated|\$450\.00 of costs not allocated/);
  await p.getByRole("button", { name: "Add the standard job checklist" }).click();
  await p.getByRole("button", { name: "Tick Materials ordered" }).click();
  await p.getByRole("button", { name: "Untick Materials ordered" }).waitFor();
  await p.getByText("Record a cost").click();
  const cf = p.getByRole("form", { name: "Save cost" });
  await cf.getByLabel("What *").fill("LED path lights");
  await cf.getByLabel("Supplier *").fill("Demo Lighting Co");
  await cf.getByLabel("Amount inc GST ($) *").fill("1100");
  await cf.getByLabel("Part of the job").selectOption({ label: "Lighting" });
  await cf.getByRole("button", { name: "Save cost" }).click();
  await p.getByText("LED path lights – Demo Lighting Co").waitFor();
  p.once("dialog", (d) => d.accept("Taylor Demo"));
  await p.getByRole("button", { name: "Record approval" }).click();
  await p.getByText("incl. $858 variations").waitFor();
});
await step("finance: raise a stage and mark a payment received", async () => {
  const p = owner.page;
  await p.goto(`${BASE}/finance`);
  await p.getByRole("heading", { name: "Overdue and due soon" }).waitFor();
  const row = p.locator("li", { hasText: "Q-DEMO-001 Progress 1" });
  await row.getByText("Mark received").click();
  await row.getByRole("button", { name: /Confirm \$11,550\.00 received/ }).click();
  await p.getByText("Q-DEMO-001 Progress 1").waitFor({ state: "detached" });
  p.once("dialog", (d) => d.accept());
  await p.locator("li", { hasText: "Q-2026-001 Progress 1" }).getByRole("button", { name: "Raise now" }).click();
  await p.locator("section", { hasText: "Overdue and due soon" }).getByText("Q-2026-001 Progress 1").waitFor();
  assert.match(await p.innerText("main"), /QuickBooks\s*Not connected/);
});

const worker = await login("worker@example.com");
await step("worker cannot see customers, money or settings", async () => {
  const nav = await worker.page.innerText("nav");
  assert.doesNotMatch(nav, /Customers|Pipeline|Settings|Audit|Finance|Estimates/);
  await worker.page.goto(`${BASE}/projects`);
  await worker.page.getByRole("link", { name: /Taylor Demo – Front Yard/ }).click();
  await worker.page.getByRole("heading", { name: "Time on this job" }).waitFor();
  const wt = await worker.page.innerText("main");
  assert.doesNotMatch(wt, /\$|Contract|Profit|Payments|Demo Supplies/);
  const tf = worker.page.getByRole("form", { name: "Submit time" });
  await tf.getByLabel("People in crew").fill("2");
  await tf.getByRole("button", { name: "Submit time" }).click();
  await worker.page.getByText("Demo Worker ·").first().waitFor();
  assert.equal((await worker.page.request.get(`${BASE}/finance`)).url().includes("forbidden"), true);
  const pay = await worker.page.request.patch(`${BASE}/api/payments/recDemoPay0000002`, { data: { action: "received", confirm: true, receivedDate: "2026-11-01", method: "Cash" } });
  assert.equal(pay.status(), 403);
  assert.equal((await worker.page.request.patch(`${BASE}/api/enquiries/recDemoEnq0000001`, { data: { status: "Won" } })).status(), 403);
  assert.doesNotMatch(await worker.page.innerText("main"), /Overdue payments|\$/i);
  await worker.page.goto(`${BASE}/customers`);
  assert.match(worker.page.url(), /forbidden/);
  const api = await worker.page.request.get(`${BASE}/api/customers`);
  assert.equal(api.status(), 403);
  const post = await worker.page.request.post(`${BASE}/api/customers`, { data: { name: "Hacker Demo" } });
  assert.equal(post.status(), 403);
});

const customer = await login("taylor.demo@example.com", { width: 390, height: 844 });
await step("customer only reaches their own portal", async () => {
  assert.match(customer.page.url(), /\/portal$/);
  const t = await customer.page.innerText("main");
  assert.match(t, /Taylor Demo – Front Yard/);
  assert.doesNotMatch(t, /Sam & Jo/);
  await customer.page.goto(`${BASE}/customers`);
  assert.match(customer.page.url(), /\/portal$/);
  assert.equal((await customer.page.request.get(`${BASE}/api/customers`)).status(), 403);
  assert.equal((await customer.page.request.get(`${BASE}/api/search?q=demo`)).status(), 403);
});

const mobile = await login("sales@example.com", { width: 390, height: 844 });
await step("mobile navigation works and has no horizontal scroll", async () => {
  await mobile.page.getByRole("button", { name: "Open menu" }).click();
  await mobile.page.getByRole("dialog").getByRole("link", { name: "Customers" }).click();
  await mobile.page.waitForURL(/\/customers$/);
  const overflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `page overflows by ${overflow}px`);
  await mobile.page.screenshot({ path: `${shots}/customers-mobile.png`, fullPage: true });
});

await step("cross-site writes are blocked", async () => {
  const res = await owner.page.request.post(`${BASE}/api/customers`, { data: { name: "Evil Demo" }, headers: { origin: "https://evil.example.com" } });
  assert.equal(res.status(), 403);
});

await browser.close();
for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
