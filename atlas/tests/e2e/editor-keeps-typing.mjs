// Regression check: the AI write-up of a voice note must never wipe what a person is typing.
// Before the fix, the site-visit editor remounted when the write-up landed, resetting every box
// to the saved values and clearing a half-typed measurement.
// Needs a fresh server in demo mode: ATLAS_AI_DEMO=1 ATLAS_ALLOW_DEMO_LOGINS=1.
// Usage: BASE_URL=http://localhost:3100 node tests/e2e/editor-keeps-typing.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message.split("\n")[0]]); }
}
const m4a = (mbytes) => {
  const b = Buffer.alloc(Math.round(mbytes * 1024 * 1024));
  b.writeUInt32BE(32, 0); b.write("ftypM4A ", 4, "latin1");
  return b;
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto(`${BASE}/login`);
await page.fill("#email", "owner@example.com");
await page.fill("#password", "atlas-demo-2026");
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/login"));

const stamp = Date.now().toString(36);
const cust = await (await page.request.post(`${BASE}/api/customers`, { data: { name: `Typing Demo ${stamp}`, suburb: "Kellyville", confirmNotDuplicate: true } })).json();
const insp = (await (await page.request.post(`${BASE}/api/inspections`, { data: { customerId: cust.customer.id, inspectionDate: "2026-11-16" } })).json()).inspection;
await page.goto(`${BASE}/inspections/${insp.id}`);

const TYPED_NOTE = "Neighbour's tree overhangs the back fence";
const TYPED_AREA = "Side path";

await step("typing during the AI write-up survives it (unsaved note and half-filled measurement)", async () => {
  // Start the write-up by uploading a recording, then type straight away.
  await page.getByLabel("Upload a recording from your phone").setInputFiles([{ name: "meeting.m4a", mimeType: "audio/x-m4a", buffer: m4a(1) }]);
  await page.locator("textarea[name=notes]").fill(TYPED_NOTE);
  const m = page.getByRole("form", { name: "Add measurement" });
  await m.getByLabel("Area *").fill(TYPED_AREA);
  await m.locator("input[name=lengthM]").fill("7.5");
  // Wait for the write-up to land.
  await page.locator("[aria-label='AI write-up'] [role=status]").filter({ hasText: "Filled in:" }).waitFor({ timeout: 60_000 });
  await page.getByText(/^Back lawn · /).waitFor({ timeout: 30_000 });
  assert.equal(await page.locator("textarea[name=notes]").inputValue(), TYPED_NOTE, "typed note was wiped");
  assert.equal(await m.getByLabel("Area *").inputValue(), TYPED_AREA, "measurement area was wiped");
  assert.equal(await m.locator("input[name=lengthM]").inputValue(), "7.5", "measurement length was wiped");
});

await step("boxes the person did not touch still show what the AI filled in", async () => {
  // The AI fills empty boxes only. The scope box was left empty, so it should now hold text.
  const scope = await page.locator("textarea[name=scope]").inputValue();
  assert.ok(scope.trim().length > 0, "the AI-filled scope never appeared");
});

await browser.close();
for (const r of results) console.log(r.join(" | "));
process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
