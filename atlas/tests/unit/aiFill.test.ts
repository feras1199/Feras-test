import { describe, expect, it } from "vitest";
import type * as Beta from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { MemoryRepository } from "@/lib/data/memory/repository";
import { buildFixtures } from "@/lib/data/memory/fixtures";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { ChatInput, runAssistant, toApiMessages, type MessagesClient } from "@/lib/ai/assistant";
import { runTool, toolsFor, type ToolContext } from "@/lib/ai/tools";
import { userContent, type Attachment } from "@/lib/ai/attachments";
import { AiLine, type AiLinesInput, aiLineToInput, planCustomerFill } from "@/lib/domain/aiFill";
import { maxBytesFor, sniffAttachment } from "@/lib/domain/media";
import { toCostOption } from "@/lib/domain/costLibrary";
import { demoAssistantClient, demoCallTranscript } from "@/lib/ai/demo";
import type { Role } from "@/lib/auth/roles";

const NOW = new Date("2026-11-02T00:00:00Z");
const TURF = "recDemoCost000014";
const LABOURER = "recDemoCost000025";
const repoWithDraft = async () => {
  const repo = new MemoryRepository(undefined, buildFixtures(NOW));
  const est = await repo.create("estimates", { title: "Q-2026-900 Alex Demo – backyard", customerIds: ["recDemoCust000001"], status: "Draft", quoteLocked: false, customerScope: "" });
  return { repo, est };
};
const ctxFor = (repo: MemoryRepository, role: Role = "owner"): ToolContext => ({ repo, session: { uid: "u1", name: "Owner", role }, settings: DEFAULT_SETTINGS, today: "2026-11-02" });
const pdf = (): Attachment => ({ kind: "document", name: "Supplier quote.pdf", mime: "application/pdf", base64: Buffer.from("%PDF-1.7 fake").toString("base64") });

describe("what can be shared with Ask ATLAS", () => {
  it("recognises PDFs by their first bytes, and still takes photos and recordings", () => {
    expect(sniffAttachment(Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj"))).toEqual({ kind: "document", mime: "application/pdf" });
    expect(sniffAttachment(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))?.kind).toBe("photo");
    expect(sniffAttachment(Buffer.from("<html><body>%PDF-</body></html>"))).toBeNull();
    expect(maxBytesFor("document")).toBe(10 * 1024 * 1024);
  });
});

describe("filling customer details", () => {
  it("fills empty boxes only and reports anything that differs", () => {
    const plan = planCustomerFill({ phone: "0491 570 001", email: "", address: null as never, suburb: "Castle Hill" }, { phone: "0491 570 159", email: "new@example.com", address: "12 Example Street", suburb: "castle hill" });
    expect(plan.updates).toEqual({ email: "new@example.com", address: "12 Example Street" });
    expect(plan.differs).toEqual([{ field: "phone", saved: "0491 570 001", inFile: "0491 570 159" }]);
  });

  it("proposes gap-filling on an existing customer without touching saved details", async () => {
    const { repo } = await repoWithDraft();
    await repo.update("customers", "recDemoCust000001", { address: "" });
    const r = await runTool("propose_customer_details", { customer_id: "recDemoCust000001", phone: "0491 570 159", address: "9 New Road", source: "voice note" }, ctxFor(repo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome.proposal?.endpoint).toBe("/api/customers/recDemoCust000001/fill");
    expect(r.outcome.proposal?.body).toEqual({ address: "9 New Road" });
    expect(r.outcome.proposal?.details?.join("\n")).toMatch(/Phone: saved "0491 570 001", file says "0491 570 159" \(left as saved\)/);
  });

  it("returns possible matches instead of proposing a duplicate customer", async () => {
    const { repo } = await repoWithDraft();
    const r = await runTool("propose_customer_details", { name: "Someone Else", email: "alex.demo@example.com", source: "email.pdf" }, ctxFor(repo));
    expect(r.ok && r.outcome.proposal).toBeFalsy();
    expect(JSON.stringify(r.ok && r.outcome.data)).toMatch(/recDemoCust000001/);
  });

  it("is not offered to roles that can't edit customers", () => {
    expect(toolsFor("worker").map((t) => t.name)).not.toContain("propose_customer_details");
    expect(toolsFor("supervisor").map((t) => t.name)).not.toContain("propose_estimate_lines");
    expect(toolsFor("sales").map((t) => t.name)).toEqual(expect.arrayContaining(["propose_customer_details", "propose_estimate_lines", "search_cost_library"]));
  });
});

describe("estimate lines from a file", () => {
  it("uses the Cost Library price, never the AI's, and marks the line for checking", async () => {
    const { repo } = await repoWithDraft();
    const item = toCostOption((await repo.get("costItems", TURF))!)!;
    const li = aiLineToInput(AiLine.parse({ costItemId: TURF, description: "Buffalo turf", quantity: 40, source: "voice note" }), item);
    expect(li).toMatchObject({ description: "Sir Walter buffalo turf", unit: "m2", unitCostCents: 1450, priceIncludesGst: true, quantityVerified: false, costItemId: TURF, costType: "Material" });
    expect(li.notes).toMatch(/AI suggested from voice note\. In the file: "Buffalo turf"\. Check the quantity\./);
    expect(() => AiLine.parse({ costItemId: TURF, description: "Turf", quantity: 1, unitPriceCents: 1, source: "x" })).toThrow();
  });

  it("only uses a price for a non-library line when it came from the file, otherwise leaves it at $0", () => {
    const fromFile = aiLineToInput(AiLine.parse({ description: "Crane hire", quantity: 1, unit: "day", costType: "Equipment", unitPriceCents: 120000, priceIncludesGst: false, source: "Crane quote.pdf" }), null);
    expect(fromFile).toMatchObject({ unitCostCents: 120000, priceIncludesGst: false });
    expect(fromFile.notes).toMatch(/Price taken from the shared file/);
    const none = aiLineToInput(AiLine.parse({ description: "Council permit", quantity: 1, source: "plan.pdf" }), null);
    expect(none.unitCostCents).toBe(0);
    expect(none.notes).toMatch(/No price yet/);
  });

  it("prices labour per person-hour without GST", async () => {
    const { repo } = await repoWithDraft();
    const li = aiLineToInput(AiLine.parse({ costItemId: LABOURER, description: "Labour", quantity: 16, source: "plan" }), toCostOption((await repo.get("costItems", LABOURER))!));
    expect(li).toMatchObject({ costType: "Labour", priceIncludesGst: false, unitCostCents: 5500 });
  });

  it("proposes lines with library prices shown, and only writes the scope if it's empty", async () => {
    const { repo, est } = await repoWithDraft();
    const ctx = ctxFor(repo);
    const r = await runTool("propose_estimate_lines", { estimate_id: est.id, lines: [{ cost_item_id: TURF, description: "turf", quantity: 40, unit_price_dollars: 1, source: "voice note" }, { description: "Council permit", quantity: 1, source: "voice note" }], customer_scope: "Lay new buffalo turf to the back lawn." }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.outcome.proposal!;
    expect(p.endpoint).toBe(`/api/estimates/${est.id}/lines/ai`);
    expect(p.details).toEqual(["40 m2 Sir Walter buffalo turf: $14.50 inc GST (Cost Library)", "1 × Council permit: no price yet", "Customer scope: will be written (box is empty)"]);
    // The AI's own price on a library line is dropped before the request body is built.
    expect((p.body as AiLinesInput).lines[0]).not.toHaveProperty("unitPriceCents");

    await repo.update("estimates", est.id, { customerScope: "Typed by a person" });
    const again = await runTool("propose_estimate_lines", { estimate_id: est.id, lines: [{ description: "Permit", quantity: 1, source: "voice note" }], customer_scope: "Something the AI wrote here" }, ctx);
    expect(again.ok).toBe(true);
    expect(again.ok && again.outcome.proposal?.details).toContain("Customer scope: already written, will be left as it is");
  });

  it("won't add lines to a locked estimate", async () => {
    const { repo, est } = await repoWithDraft();
    await repo.update("estimates", est.id, { quoteLocked: true });
    const r = await runTool("propose_estimate_lines", { estimate_id: est.id, lines: [{ description: "Turf", quantity: 4, source: "x" }] }, ctxFor(repo));
    expect(r.ok).toBe(false);
  });

  it("searches the Cost Library", async () => {
    const { repo } = await repoWithDraft();
    const r = await runTool("search_cost_library", { query: "turf" }, ctxFor(repo, "sales"));
    expect(r.ok && JSON.stringify(r.outcome.data)).toMatch(/Sir Walter buffalo turf.*\$14\.50/);
  });
});

describe("sending files to the AI", () => {
  it("puts files before the question: PDFs as documents, photos as images, voice as labelled transcripts", () => {
    const blocks = userContent("Fill the estimate", [pdf(), { kind: "photo", name: "Yard.jpg", mime: "image/jpeg", base64: "AAAA" }, { kind: "voice", name: "Call", transcript: "We want turf." }]);
    expect(blocks.map((b) => b.type)).toEqual(["document", "text", "image", "text", "text"]);
    expect(blocks[0]).toMatchObject({ type: "document", title: "Supplier quote.pdf", source: { type: "base64", media_type: "application/pdf" } });
    expect((blocks[3] as Beta.BetaTextBlockParam).text).toMatch(/Voice note shared: Call\nTranscript.*\nWe want turf\./s);
    expect((blocks[4] as Beta.BetaTextBlockParam).text).toBe("Fill the estimate");
  });

  it("allows a file with no words, but not files on ATLAS's own messages or too many files", () => {
    const id = "filAbcdefghijklmn";
    expect(ChatInput.safeParse({ messages: [{ role: "user", content: "", attachmentIds: [id] }] }).success).toBe(true);
    expect(ChatInput.safeParse({ messages: [{ role: "user", content: "" }] }).success).toBe(false);
    expect(ChatInput.safeParse({ messages: [{ role: "user", content: "a", attachmentIds: [id] }, { role: "assistant", content: "b", attachmentIds: [id] }, { role: "user", content: "c" }] }).success).toBe(false);
    const many = (n: number) => Array.from({ length: n }, (_, i) => `filAbcdefghijkl${String(i).padStart(2, "0")}`);
    expect(ChatInput.safeParse({ messages: [{ role: "user", content: "a", attachmentIds: many(4) }, { role: "assistant", content: "b" }, { role: "user", content: "c", attachmentIds: many(3) }] }).success).toBe(false);
  });

  it("re-sends files with their message and marks the last one for caching", () => {
    const input = ChatInput.parse({ messages: [{ role: "user", content: "Read this", attachmentIds: ["filAbcdefghijklmn"] }, { role: "assistant", content: "Done" }, { role: "user", content: "Now fill it" }] });
    const msgs = toApiMessages(input, new Map([["filAbcdefghijklmn", pdf()]]));
    const first = msgs[0]!.content as Beta.BetaContentBlockParam[];
    expect(first[0]).toMatchObject({ type: "document", cache_control: { type: "ephemeral" } });
    expect(msgs[2]!.content).toBe("Now fill it");
    expect(() => toApiMessages(input, new Map())).toThrow();
  });

  it("passes the files through to the model in a real assistant turn", async () => {
    const { repo } = await repoWithDraft();
    const calls: Beta.MessageCreateParamsNonStreaming[] = [];
    const client: MessagesClient = { beta: { messages: { create: async (p) => { calls.push(structuredClone(p)); return { id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: "It's a supplier quote.", citations: null }], stop_reason: "end_turn", stop_sequence: null, usage: {} } as unknown as Beta.BetaMessage; } } } };
    const input = ChatInput.parse({ messages: [{ role: "user", content: "", attachmentIds: ["filAbcdefghijklmn"] }] });
    const r = await runAssistant(client, input, ctxFor(repo), { attachments: new Map([["filAbcdefghijklmn", pdf()]]) });
    expect(r.text).toBe("It's a supplier quote.");
    const sent = calls[0]!.messages[0]!.content as Beta.BetaContentBlockParam[];
    expect(sent[0]!.type).toBe("document");
    expect((sent[1] as Beta.BetaTextBlockParam).text).toMatch(/shared the file/);
    expect(JSON.stringify(calls[0]!.system)).toMatch(/never overwrites what a person typed/);
  });
});

describe("demo stand-in for Ask ATLAS", () => {
  it("reads a demo call, looks things up with the real tools and proposes, all labelled as a demo", async () => {
    const { repo } = await repoWithDraft();
    await repo.update("customers", "recDemoCust000001", { name: "Jordan Sample", email: "" });
    const voice: Attachment = { kind: "voice", name: "Call", transcript: demoCallTranscript() };
    const input = ChatInput.parse({ messages: [{ role: "user", content: "This is for Jordan Sample, fill it in", attachmentIds: ["filAbcdefghijklmn"] }] });
    const r = await runAssistant(demoAssistantClient(), input, ctxFor(repo), { attachments: new Map([["filAbcdefghijklmn", voice]]) });
    expect(r.text).toMatch(/^Demo reply/);
    expect(r.proposals.map((p) => p.kind)).toEqual(["customer-fill", "estimate-lines"]);
    expect(r.proposals[0]!.body).toMatchObject({ email: "jordan.sample@example.com" });
    expect(r.proposals[0]!.body).not.toHaveProperty("phone");
    expect(r.proposals[1]!.details?.[0]).toMatch(/^40 m2 Sir Walter buffalo turf: \$14\.50/);
  });
});
