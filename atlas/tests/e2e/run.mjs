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

const worker = await login("worker@example.com");
await step("worker cannot see customers, money or settings", async () => {
  const nav = await worker.page.innerText("nav");
  assert.doesNotMatch(nav, /Customers|Pipeline|Settings|Audit/);
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
