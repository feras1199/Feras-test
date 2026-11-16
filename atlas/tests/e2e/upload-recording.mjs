// End-to-end check of uploading a recording made outside ATLAS (Voice Memos, WhatsApp) and the auto-fill.
// Needs a fresh server in demo mode: ATLAS_AI_DEMO=1 ATLAS_ALLOW_DEMO_LOGINS=1 (memory data, made-up transcripts).
// Usage: BASE_URL=http://localhost:3100 node tests/e2e/upload-recording.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR;
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message.split("\n")[0]]); }
}
/** Bytes that look like an iPhone Voice Memos file (.m4a) of the given size. The demo transcriber ignores the sound. */
const m4a = (mbytes) => {
  const b = Buffer.alloc(Math.round(mbytes * 1024 * 1024));
  b.writeUInt32BE(32, 0); b.write("ftypM4A ", 4, "latin1");
  return b;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill("#email", "owner@example.com");
await page.fill("#password", "atlas-demo-2026");
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/login"));

const stamp = Date.now().toString(36);
const cust = await (await page.request.post(`${BASE}/api/customers`, { data: { name: `Upload Demo ${stamp}`, suburb: "Kellyville", confirmNotDuplicate: true } })).json();
assert.ok(cust.customer?.id, JSON.stringify(cust));
const insp = (await (await page.request.post(`${BASE}/api/inspections`, { data: { customerId: cust.customer.id, inspectionDate: "2026-11-16" } })).json()).inspection;
const url = `${BASE}/inspections/${insp.id}`;

await step("site visit: an Upload a recording button sits next to Record, and takes .m4a files", async () => {
  await page.goto(url);
  await page.getByText("⬆ Upload a recording").waitFor();
  const accept = await page.getByLabel("Upload a recording from your phone").getAttribute("accept");
  assert.match(accept, /audio\/\*/);
  assert.match(accept, /\.m4a/);
});

await step("site visit: a 20 MB Voice Memos file uploads, then ATLAS writes it up and fills empty boxes", async () => {
  await page.getByLabel("Upload a recording from your phone").setInputFiles([{ name: "Kellyville meeting.m4a", mimeType: "audio/x-m4a", buffer: m4a(20) }]);
  const result = page.locator("[aria-label='AI write-up'] [role=status]").filter({ hasText: "Filled in:" });
  await result.waitFor({ timeout: 60_000 });
  const text = await result.innerText();
  assert.match(text, /What the customer wants/);
  assert.match(text, /Budget/);
  assert.match(text, /Customer phone/);
  assert.match(text, /1 measurement \(marked Low \/ Verify\)/);
  assert.match(text, /Not in the recording, fill in by hand:.*Customer email/);
  await page.getByText("Kellyville meeting", { exact: false }).first().waitFor();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/upload-recording-filled.png`, fullPage: true });
});

await step("site visit: the measurement and the customer phone were really saved, unverified", async () => {
  await page.reload();
  await page.getByText("Back lawn · Turfing").waitFor();
  await page.getByText("AI-assisted · Low / Verify", { exact: false }).first().waitFor();
  const src = await page.locator("audio").first().getAttribute("src");
  const audio = await page.request.get(`${BASE}${src}`);
  assert.equal((await audio.body()).length, 20 * 1024 * 1024, "the whole 20 MB file was stored, not cut short");
  const c = await (await page.request.get(`${BASE}/api/customers/${cust.customer.id}`)).json();
  assert.equal((c.customer ?? c).phone, "0491 570 159");
});

await step("site visit: writing up again doesn't add the same measurement twice", async () => {
  const r = await (await page.request.post(`${BASE}/api/inspections/${insp.id}/ai-fill`)).json();
  assert.equal(r.measurementsAdded, 0, JSON.stringify(r));
});

await step("site visit: a file over 50 MB is refused on the phone before it uploads", async () => {
  const big = join(mkdtempSync(join(tmpdir(), "atlas-")), "huge.m4a");
  writeFileSync(big, m4a(51));
  await page.getByLabel("Upload a recording from your phone").setInputFiles(big);
  await page.getByRole("alert").filter({ hasText: "up to 50 MB" }).waitFor();
});

await step("Ask ATLAS: the 📎 File button says it takes recordings, and a 15 MB recording is heard", async () => {
  await page.goto(`${BASE}/assistant`);
  await page.getByRole("button", { name: "Add a PDF, photo or recording" }).waitFor();
  assert.match(await page.locator("#assistant-file").getAttribute("accept"), /\.m4a/);
  await page.locator("#assistant-file").setInputFiles([{ name: "Call with new customer.m4a", mimeType: "audio/x-m4a", buffer: m4a(15) }]);
  await page.getByText("Call with new customer.m4a").waitFor({ timeout: 60_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/upload-recording-ask.png`, fullPage: true });
});

await browser.close();
for (const r of results) console.log(r.join(" | "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
