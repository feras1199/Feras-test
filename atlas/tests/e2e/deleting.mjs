// Deleting, restoring, and the everyday fixes found in the 16 Nov 2026 QA pass:
// moving a site visit, editing a task, a cancelled job leaving Finance, and undoing
// a payment marked received by mistake. Fictional data only.
// Needs a server with ATLAS_DATA_SOURCE=postgres and
// ATLAS_OWNER_EMAIL=owner@example.com / ATLAS_OWNER_PASSWORD=atlas-demo-2026.
// Usage: BASE_URL=http://localhost:3100 node tests/e2e/deleting.mjs
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
await p.goto(`${BASE}/login`);
await p.fill("#email", "owner@example.com");
await p.fill("#password", "atlas-demo-2026");
await p.click("button[type=submit]");
await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 10_000 });
const api = p.request;
const json = async (r) => { const b = await r.json(); if (!r.ok()) throw new Error(`${r.status()} ${JSON.stringify(b)}`); return b; };
const main = () => p.locator("main").innerText();
/** The page without the "Deleted: ..." note, which names what was deleted. */
const listed = async () => (await main()).replace(/^Deleted: .*\n/, "");
const stamp = Date.now().toString(36);

// One customer taken all the way to an accepted quote with a paid deposit, and one with just a visit booked.
let jobCust, jobEst, jobProject, deposit, visitCust, visitInsp;
await step("set up two fictional customers", async () => {
  ({ customer: jobCust } = await json(await api.post(`${BASE}/api/customers`, { data: { name: `Delete Demo Job ${stamp}`, suburb: "Kellyville", phone: "0491 570 156" } })));
  ({ estimate: jobEst } = await json(await api.post(`${BASE}/api/estimates`, { data: { customerId: jobCust.id, title: "Demo paving" } })));
  await json(await api.post(`${BASE}/api/estimates/${jobEst.id}/lines`, { data: { description: "Demo pavers", costType: "Material", quantity: 10, unit: "m2", unitCostCents: 10000, quantityVerified: true } }));
  await json(await api.post(`${BASE}/api/estimates/${jobEst.id}/lines`, { data: { description: "Demo labour", costType: "Labour", quantity: 8, unit: "hour", unitCostCents: 6000, quantityVerified: true } }));
  await json(await api.patch(`${BASE}/api/estimates/${jobEst.id}`, { data: { customerScope: "Demo paving job", assumptions: "None", assumptionsResolved: true } }));
  await json(await api.post(`${BASE}/api/estimates/${jobEst.id}/action`, { data: { action: "approve" } }));
  await json(await api.post(`${BASE}/api/estimates/${jobEst.id}/action`, { data: { action: "send", confirm: true } }));
  ({ projectId: jobProject } = await json(await api.post(`${BASE}/api/estimates/${jobEst.id}/action`, { data: { action: "accept", confirm: true, acceptedBy: "Demo", method: "Email" } })).then((r) => ({ projectId: r.estimate.projectIds[0] })));
  ({ customer: visitCust } = await json(await api.post(`${BASE}/api/customers`, { data: { name: `Delete Demo Visit ${stamp}`, suburb: "Castle Hill" } })));
  ({ inspection: visitInsp } = await json(await api.post(`${BASE}/api/inspections`, { data: { customerId: visitCust.id, inspectionDate: "2026-11-20", inspectionTime: "09:00" } })));
});

await step("payment stages are listed in order, and a deposit marked received by mistake can be undone", async () => {
  await p.goto(`${BASE}/projects/${jobProject}`);
  const pay = await p.locator("section").filter({ has: p.getByRole("heading", { name: "Payments" }) }).innerText();
  const order = ["Deposit", "Progress 1", "Progress 2", "Progress 3", "Final"].map((s) => pay.indexOf(s));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), `stages out of order: ${pay.replace(/\s+/g, " ")}`);
  await p.goto(`${BASE}/finance`);
  const row = p.locator("li").filter({ hasText: `Delete Demo Job ${stamp}` }).filter({ hasText: /Deposit/ }).first();
  await row.locator("summary", { hasText: "Mark received" }).click();
  await row.getByRole("button", { name: /Confirm .* received/ }).click();
  await p.waitForTimeout(800);
  await p.goto(`${BASE}/projects/${jobProject}`);
  p.once("dialog", (d) => d.accept());
  await p.getByRole("button", { name: "Undo received for Deposit" }).click();
  await p.waitForTimeout(800);
  await p.reload();
  assert.equal(await p.getByRole("button", { name: "Undo received for Deposit" }).count(), 0);
  // Received again, so the delete below involves money.
  await p.goto(`${BASE}/finance`);
  await row.locator("summary", { hasText: "Mark received" }).click();
  await row.getByRole("button", { name: /Confirm .* received/ }).click();
  await p.waitForTimeout(800);
  deposit = true;
});

await step("a cancelled job takes its unpaid stages off Finance, and they come back if it's reopened", async () => {
  const name = `Delete Demo Job ${stamp}`;
  await json(await api.patch(`${BASE}/api/projects/${jobProject}`, { data: { status: "Cancelled" } }));
  await p.goto(`${BASE}/finance`);
  assert.doesNotMatch(await main(), new RegExp(`${name}[\\s\\S]{0,40}Progress 1`));
  await p.goto(`${BASE}/projects/${jobProject}`);
  assert.match(await main(), /This job is cancelled/);
  assert.match(await main(), /Deposit/, "the received deposit stays on the project");
  await json(await api.patch(`${BASE}/api/projects/${jobProject}`, { data: { status: "In Progress" } }));
  await p.goto(`${BASE}/finance`);
  assert.match(await main(), new RegExp(`${name}`));
});

await step("a site visit can be moved to another day and time", async () => {
  await p.goto(`${BASE}/inspections/${visitInsp.id}`);
  await p.fill("input[name=inspectionDate]", "2026-11-27");
  await p.fill("input[name=inspectionTime]", "14:30");
  await p.getByRole("button", { name: "Save notes" }).click();
  await p.getByRole("status").filter({ hasText: /^Saved/ }).waitFor();
  await p.reload();
  assert.match(await p.locator("h1").locator("..").innerText(), /27 Nov 2026, 2:30 pm/);
  await p.goto(`${BASE}/customers/${visitCust.id}`);
  assert.match(await main(), /Site inspections[\s\S]*27 Nov 2026, 2:30 pm/);
});

await step("a task can be opened, edited and deleted", async () => {
  await p.goto(`${BASE}/tasks/new?customer=${visitCust.id}`);
  await p.fill("#title", `Ring about the visit ${stamp}`);
  await p.getByRole("button", { name: "Create task" }).click();
  await p.waitForURL(/\/tasks$/);
  await p.getByRole("link", { name: `Ring about the visit ${stamp}` }).click();
  await p.waitForURL(/\/tasks\/rec/);
  await p.fill("#title", `Ring to confirm the new time ${stamp}`);
  await p.fill("#dueDate", "2026-11-26");
  await p.getByRole("button", { name: "Save task" }).click();
  await p.waitForURL(/\/tasks$/);
  assert.match(await main(), new RegExp(`Ring to confirm the new time ${stamp}[\\s\\S]*Delete Demo Visit ${stamp}[\\s\\S]*26 Nov`));
  await p.getByRole("link", { name: `Ring to confirm the new time ${stamp}` }).click();
  await p.getByRole("button", { name: "Delete task" }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await p.waitForURL(/\/tasks\?deleted=/);
  assert.doesNotMatch(await listed(), /Ring to confirm the new time/);
});

await step("deleting a site inspection asks first, then removes it from the customer", async () => {
  await p.goto(`${BASE}/inspections/${visitInsp.id}`);
  await p.getByRole("button", { name: "Delete inspection" }).click();
  const dlg = p.getByRole("dialog");
  await dlg.getByText("will be deleted").waitFor();
  await dlg.getByRole("button", { name: "Delete", exact: true }).click();
  await p.waitForURL(new RegExp(`/customers/${visitCust.id}\\?deleted=`));
  assert.match(await main(), /Deleted: /);
  assert.match(await main(), /No site inspections yet/);
});

await step("deleting a customer with an accepted quote and a payment needs DELETE typed", async () => {
  assert.ok(deposit, "needs the received deposit from the earlier step");
  await p.goto(`${BASE}/customers/${jobCust.id}`);
  await p.getByRole("button", { name: "Delete customer" }).click();
  const dlg = p.getByRole("dialog");
  await dlg.getByText("will be deleted").waitFor();
  const t = await dlg.innerText();
  assert.match(t, /1 project/);
  assert.match(t, /5 payment stages/);
  assert.match(t, /1 accepted quote, 1 payment already received/);
  const del = dlg.getByRole("button", { name: "Delete", exact: true });
  assert.ok(await del.isDisabled());
  await dlg.getByLabel("Type DELETE to confirm").fill("DELETE");
  await del.click();
  await p.waitForURL(/\/customers\?deleted=/);
  assert.doesNotMatch(await listed(), new RegExp(`Delete Demo Job ${stamp}`));
  assert.equal((await api.get(`${BASE}/api/customers/${jobCust.id}`)).status(), 404);
  await p.goto(`${BASE}/finance`);
  assert.doesNotMatch(await main(), new RegExp(`Delete Demo Job ${stamp}`));
});

await step("restore puts the customer back with their project and payments, and it's in the audit log", async () => {
  await p.goto(`${BASE}/settings/deleted`);
  const item = p.locator("li").filter({ hasText: `Customer Delete Demo Job ${stamp}` });
  await item.getByRole("button", { name: "Restore" }).click();
  await item.getByRole("status").filter({ hasText: /Restored \d+ records/ }).waitFor();
  await p.goto(`${BASE}/projects/${jobProject}`);
  assert.match(await main(), /Deposit[\s\S]*Paid/);
  await p.goto(`${BASE}/audit`);
  const a = await main();
  assert.match(a, new RegExp(`Deleted customer Delete Demo Job ${stamp}`));
  assert.match(a, new RegExp(`Restored Customer Delete Demo Job ${stamp}`));
});

await browser.close();
for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
