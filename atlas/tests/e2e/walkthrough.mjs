// Walks one fictional job from first call to final payment on a phone-sized
// screen, using the real buttons, and saves a screenshot of each step.
// Doubles as an end-to-end check of the whole flow.
// Usage: BASE_URL=http://localhost:3000 SHOTS_DIR=/tmp/shots node tests/e2e/walkthrough.mjs
// (demo data: run the server with ATLAS_ALLOW_DEMO_LOGINS=1)
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ["microphone"] });
const p = await ctx.newPage();
let n = 0;
async function shot(name, locator) {
  n++;
  if (!SHOTS) return;
  const path = `${SHOTS}/${String(n).padStart(2, "0")}-${name}.png`;
  if (locator) await locator.screenshot({ path });
  else await p.screenshot({ path });
}
const stamp = Date.now().toString().slice(-4);
const NAME = `Sam Rivers ${stamp}`;

await p.goto(`${BASE}/login`);
await p.fill("#email", "owner@example.com");
await p.fill("#password", "atlas-demo-2026");
await p.click("button[type=submit]");
await p.waitForURL((u) => !u.pathname.startsWith("/login"));
await shot("today");

// 1. New customer
await p.goto(`${BASE}/customers/new`);
await p.fill("#name", NAME);
await p.fill("#phone", `0491 570 ${stamp.slice(0, 3)}`);
await p.fill("#suburb", "Glenwood");
await p.fill("#address", "12 Example Street");
await shot("new-customer");
await p.getByRole("button", { name: "Create customer" }).click();
// Re-running against the same demo data finds the earlier Sam Rivers; say it's someone else.
const dup = p.getByRole("button", { name: "It's a different person, save anyway" });
await Promise.race([p.waitForURL(/\/customers\/rec/), dup.waitFor()]);
if (!/\/customers\/rec/.test(p.url())) { await dup.click(); await p.waitForURL(/\/customers\/rec/); }
const customerUrl = p.url();

// 2. New enquiry
await p.goto(`${BASE}/pipeline/new`);
const custId = customerUrl.split("/").pop();
await p.selectOption("#customerId", custId);
await p.fill("#serviceRequested", "Rear yard: 40 m² paving and new turf");
await p.fill("#budget", "15000");
await shot("new-enquiry");
await p.getByRole("button", { name: "Create enquiry" }).click();
await p.waitForURL((u) => !u.pathname.endsWith("/new"));
await p.waitForTimeout(500);
await shot("pipeline");

// 3. Book inspection: the enquiry is picked automatically
await p.goto(`${BASE}/inspections/new?customer=${custId}`);
const enq = p.getByLabel("Which enquiry is this visit for?");
assert.match(await enq.locator("option:checked").innerText(), /paving/i, "the only open enquiry should be pre-selected");
await shot("book-inspection");
await p.getByRole("button", { name: "Book inspection" }).click();
await p.waitForURL(/\/inspections\/rec/);
const inspUrl = p.url();

// 4. On site: photo, voice note, notes, measurement
// A stand-in "garden" photo drawn in the browser.
const png = Buffer.from((await p.evaluate(() => {
  const c = document.createElement("canvas"); c.width = 800; c.height = 600;
  const g = c.getContext("2d"); const grd = g.createLinearGradient(0, 0, 0, 600);
  grd.addColorStop(0, "#9cc3e6"); grd.addColorStop(0.45, "#cfe3f2"); grd.addColorStop(0.46, "#6f9a4a"); grd.addColorStop(1, "#3f6b2a");
  g.fillStyle = grd; g.fillRect(0, 0, 800, 600); g.fillStyle = "#b9a58a"; g.fillRect(80, 360, 640, 200);
  return c.toDataURL("image/png");
})).split(",")[1], "base64");
await p.locator('input[type=file][accept="image/*"]').setInputFiles([{ name: "IMG_1.PNG", mimeType: "image/png", buffer: png }]);
await p.getByText("1 photo saved.").waitFor({ timeout: 15_000 });
await p.getByRole("button", { name: "● Record a voice note" }).click();
await p.waitForTimeout(2500);
await shot("recording", p.locator('section[aria-label="Photos and voice notes"]'));
await p.getByRole("button", { name: "Stop and save" }).click();
await p.getByText("Voice note saved.").waitFor({ timeout: 15_000 });
await shot("photos-voice", p.locator('section[aria-label="Photos and voice notes"]'));
const m = p.getByRole("form", { name: "Add measurement" });
await m.getByLabel("Area *").fill("Rear patio");
await m.locator('select[name=workType]').selectOption("Paving");
await m.locator('input[name=lengthM]').fill("8");
await m.locator('input[name=widthM]').fill("5");
await shot("measurement", m);
await m.getByRole("button", { name: "Add measurement" }).click();
await p.getByText("Rear patio · Paving").waitFor();
await p.locator('textarea[name=scope]').fill("Paving to rear patio, new turf to the rest of the yard");
await p.locator('input[name=complete]').check();
await p.getByRole("button", { name: "Save notes" }).click();
await p.getByRole("status").filter({ hasText: "Saved" }).waitFor();

// 5. Estimate from the inspection
await p.goto(inspUrl);
await p.getByRole("link", { name: "Start estimate" }).click();
await p.waitForURL(/\/estimates\/new/);
await shot("new-estimate");
await p.getByRole("button", { name: /Create draft/ }).click();
await p.waitForURL(/\/estimates\/rec/);
const estUrl = p.url();

// 6. Cost lines from the Cost Library
const desc = p.getByRole("combobox", { name: "Description *" });
const lb = p.getByRole("listbox", { name: "Cost Library matches" });
async function addLine(search, pick, { measured, qty, shotName } = {}) {
  await desc.fill(search);
  await lb.waitFor();
  if (shotName) await shot(shotName);
  await lb.getByRole("option").filter({ hasText: pick }).first().click();
  if (measured) await p.getByLabel("Quantity from a site measurement").selectOption({ index: 1 });
  else await p.locator("input[name=quantity]").fill(String(qty));
  await p.locator("input[name=quantityVerified]").check();
  if (shotName) await shot("line-picked");
  await p.getByRole("button", { name: "Add line" }).click();
  await desc.and(p.locator('[value=""]')).waitFor();
}
await addLine("sand", /Sandstone paver 400/, { measured: true, shotName: "typeahead" });
await addLine("bed", /Bedding sand/, { qty: 3 });
await addLine("pav", /Paver layer/, { qty: 24 });
await p.locator("textarea[name=customerScope]").fill("Supply and lay 40 m² of pavers to the rear patio on a compacted sand bed. Clean up and remove waste.");
await p.locator("textarea[name=assumptions]").fill("Normal soil, no rock. Clear access down the side of the house.");
await p.locator("input[name=assumptionsResolved]").check();
await p.getByRole("button", { name: "Save scope" }).click();
await p.waitForTimeout(1000);
await p.goto(estUrl);
await p.getByRole("heading", { name: "Cost lines" }).scrollIntoViewIfNeeded();
await shot("estimate-lines");

// 7. Approve, send, accept
await p.getByRole("button", { name: "Approve price" }).click();
const dlg = p.getByRole("dialog");
await shot("approve", dlg);
assert.equal(await dlg.getByText("check(s) are failing").count(), 0, "a properly filled estimate should pass every check");
await dlg.getByRole("button", { name: "Approve and lock" }).click();
await p.getByRole("button", { name: "Mark as sent" }).waitFor();
await p.getByRole("link", { name: /Quote document|Preview quote/ }).click();
await p.waitForURL(/\/quote/);
await p.waitForTimeout(500);
await shot("quote");
await p.goto(estUrl);
await p.getByRole("button", { name: "Mark as sent" }).click();
await p.getByRole("dialog").getByRole("button", { name: "Yes, it's been sent" }).click();
await p.getByRole("button", { name: "Record acceptance" }).waitFor();
await p.getByRole("button", { name: "Record acceptance" }).click();
const acc = p.getByRole("dialog");
await acc.getByLabel("Accepted by *").fill("Sam Rivers");
await acc.getByLabel("How *").selectOption("Signed quote");
await shot("accept", acc);
await acc.getByRole("button", { name: "Record acceptance" }).click();
await p.getByRole("dialog").waitFor({ state: "detached" });
await p.waitForTimeout(800);

// 8. Project and payments
await p.goto(`${BASE}/projects`);
await p.getByRole("link", { name: new RegExp(NAME) }).first().click();
await p.waitForURL(/\/projects\/rec/);
await shot("project");
await p.goto(`${BASE}/finance`);
await p.waitForTimeout(500);
await shot("finance");

// Enquiry ended up Won
await p.goto(customerUrl);
assert.match(await p.innerText("main"), /Won/);

await browser.close();
console.log(`walkthrough passed, ${n} steps`);
