// Ask ATLAS with files: record a voice note in the chat, say which job it's for,
// and check ATLAS suggests customer details and estimate lines that only save on
// Confirm, use Cost Library prices, and never overwrite what a person typed.
// Also checks PDFs and photos can be shared and stay private to the person who shared them.
// Server: demo data with ATLAS_ALLOW_DEMO_LOGINS=1 ATLAS_AI_DEMO=1 (scripted, clearly labelled AI stand-in)
// Usage: BASE_URL=http://localhost:3000 SHOTS_DIR=/tmp/shots node tests/e2e/assistant-files.mjs
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

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["microphone"] });
const p = await ctx.newPage();
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", "atlas-demo-2026");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
await login(p, "owner@example.com");
const api = async (method, path, data) => { const r = await p.request.fetch(`${BASE}${path}`, { method, data }); const j = await r.json().catch(() => ({})); assert.ok(r.ok(), `${method} ${path}: ${r.status()} ${JSON.stringify(j)}`); return j; };

// The person already typed the customer's phone number. The voice note gives a different one.
const cust = (await api("POST", "/api/customers", { name: "Jordan Sample", phone: "0491 570 150", confirmNotDuplicate: true })).customer;
const est = (await api("POST", "/api/estimates", { customerId: cust.id, title: "Backyard turf and wall" })).estimate;
let pdfId;

await step("record a voice note in the chat and say which job it's for", async () => {
  await p.goto(`${BASE}/assistant`);
  await p.getByText("You can also share a PDF, photo or voice note").waitFor();
  await p.getByRole("button", { name: "Record a voice note" }).click();
  await p.getByText(/Recording 0:0[1-9]/).waitFor({ timeout: 10_000 });
  await p.waitForTimeout(1200);
  await p.getByRole("button", { name: "Stop and add" }).click();
  await p.getByRole("button", { name: /^Remove Voice note/ }).waitFor({ timeout: 15_000 });
  await p.fill("#assistant-q", "This is for Jordan Sample, please fill the estimate");
  await p.getByRole("button", { name: "Ask", exact: true }).click();
  await p.locator("[data-proposal=estimate-lines]").waitFor({ timeout: 20_000 });
  await p.getByText("What was said").first().click();
  await p.getByText("jordan.sample@example.com and my mobile").waitFor();
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390, "no sideways scrolling on a phone");
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/chat-proposals.png`, fullPage: true });
});

await step("nothing is saved before Confirm", async () => {
  const c = (await api("GET", `/api/customers/${cust.id}`)).customer;
  assert.equal(c.email ?? null, null);
  const lines = (await api("GET", `/api/estimates/${est.id}`)).lines ?? [];
  assert.equal(lines.length, 0);
});

await step("customer card fills empty boxes only and says the phone differs", async () => {
  const card = p.locator("[data-proposal=customer-fill]");
  await card.getByText("Email: jordan.sample@example.com").waitFor();
  await card.getByText(/Phone: saved "0491 570 150", file says "0491 570 159" \(left as saved\)/).waitFor();
  await card.getByRole("button", { name: "Confirm" }).click();
  await card.getByText(/Filled in: .*Email/).waitFor();
  const c = (await api("GET", `/api/customers/${cust.id}`)).customer;
  assert.equal(c.email, "jordan.sample@example.com");
  assert.equal(c.address, "12 Example Street");
  assert.equal(c.phone, "0491 570 150", "the phone the person typed is kept");
});

await step("estimate lines use Cost Library prices and are flagged for checking", async () => {
  const card = p.locator("[data-proposal=estimate-lines]");
  await card.getByText(/40 m2 Sir Walter buffalo turf: \$14\.50 inc GST \(Cost Library\)/).waitFor();
  await card.getByRole("button", { name: "Confirm" }).click();
  await card.getByText(/Added 2 line\(s\)/).waitFor();
  if (SHOTS) await card.screenshot({ path: `${SHOTS}/chat-confirmed.png` });
  await card.getByRole("link", { name: "Open" }).click();
  await p.waitForURL(`**/estimates/${est.id}`);
  await p.getByText("Sir Walter buffalo turf").first().waitFor();
  await p.getByText("AI-suggested quantities reviewed").first().waitFor();
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/estimate-after.png`, fullPage: true });
});

await step("confirming the same suggestion again doesn't overwrite anything typed since", async () => {
  await api("PATCH", `/api/customers/${cust.id}`, { email: "typed.later@example.com" });
  const r = await api("POST", `/api/customers/${cust.id}/fill`, { email: "jordan.sample@example.com", phone: "0491 570 159" });
  assert.deepEqual(r.filled, []);
  assert.equal(r.customer.email, "typed.later@example.com");
});

await step("share a PDF: it's accepted, private to the sharer, and the demo says it can't read it", async () => {
  await p.goto(`${BASE}/assistant`);
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
  const wait = p.waitForResponse((r) => r.url().endsWith("/api/assistant/attachments"));
  await p.locator("#assistant-file").setInputFiles({ name: "Supplier quote.pdf", mimeType: "application/pdf", buffer: pdf });
  pdfId = (await (await wait).json()).file.id;
  await p.getByRole("button", { name: "Remove Supplier quote.pdf" }).waitFor();
  await p.getByRole("button", { name: "Ask", exact: true }).click();
  await p.getByText(/Demo mode can't read PDFs or photos/).waitFor({ timeout: 20_000 });
  const own = await p.request.get(`${BASE}/api/files/${pdfId}`);
  assert.equal(own.status(), 200);
  assert.equal(own.headers()["content-type"], "application/pdf");
  const other = await browser.newContext();
  const w = await other.newPage();
  await login(w, "worker@example.com");
  assert.equal((await w.request.get(`${BASE}/api/files/${pdfId}`)).status(), 404, "another person can't open it");
  const chat = await w.request.post(`${BASE}/api/assistant`, { data: { messages: [{ role: "user", content: "what's this", attachmentIds: [pdfId] }] } });
  assert.equal(chat.status(), 404, "or send it to the AI");
  await other.close();
});

await step("only PDFs, photos and recordings are accepted", async () => {
  const bad = await p.request.post(`${BASE}/api/assistant/attachments`, { multipart: { file: { name: "quote.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script></html>") } } });
  assert.equal(bad.status(), 415);
  assert.match((await bad.json()).error, /PDFs, photos/);
});

await step("a worker sees the chat but gets no fill-in tools", async () => {
  const other = await browser.newContext();
  const w = await other.newPage();
  await login(w, "worker@example.com");
  const voice = await w.request.post(`${BASE}/api/assistant/attachments`, { multipart: { file: { name: "a.webm", mimeType: "audio/webm", buffer: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]) } } });
  assert.equal(voice.status(), 200);
  const id = (await voice.json()).file.id;
  const r = await w.request.post(`${BASE}/api/assistant`, { data: { messages: [{ role: "user", content: "This is for Jordan Sample", attachmentIds: [id] }] } });
  const j = await r.json();
  assert.equal(r.status(), 200, JSON.stringify(j));
  assert.equal(j.proposals.length, 0);
  assert.ok(j.lookups.every((l) => !l.tool.startsWith("propose_") || !l.ok), JSON.stringify(j.lookups));
  await other.close();
});

await browser.close();
for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
