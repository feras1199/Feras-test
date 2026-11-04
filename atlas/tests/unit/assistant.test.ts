import { describe, expect, it } from "vitest";
import type * as Beta from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { MemoryRepository } from "@/lib/data/memory/repository";
import { buildFixtures } from "@/lib/data/memory/fixtures";
import { DEFAULT_SETTINGS } from "@/lib/config/settings";
import { runAssistant, ChatInput, type MessagesClient } from "@/lib/ai/assistant";
import { runTool, toolsFor, type ToolContext } from "@/lib/ai/tools";
import type { Role } from "@/lib/auth/roles";

const NOW = new Date("2026-11-02T00:00:00Z");
const ctxFor = (role: Role, name = "Owner"): ToolContext => ({ repo: new MemoryRepository(undefined, buildFixtures(NOW)), session: { uid: "u1", name, role }, settings: DEFAULT_SETTINGS, today: "2026-11-02" });

function msg(content: Beta.BetaContentBlock[], stop_reason: Beta.BetaMessage["stop_reason"]): Beta.BetaMessage {
  return { id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null, usage: {} as never } as unknown as Beta.BetaMessage;
}
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as unknown as Beta.BetaContentBlock;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Beta.BetaContentBlock;

function fakeClient(responses: Beta.BetaMessage[]) {
  const calls: Beta.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = { beta: { messages: { create: async (p) => { calls.push(structuredClone(p)); const r = responses.shift(); if (!r) throw new Error("no more responses"); return r; } } } };
  return { client, calls };
}
const ask = (q: string) => ChatInput.parse({ messages: [{ role: "user", content: q }] });

describe("assistant tools", () => {
  it("only offers tools the role allows", () => {
    const worker = toolsFor("worker").map((t) => t.name);
    expect(worker).toContain("get_project");
    expect(worker).not.toContain("list_payments");
    expect(worker).not.toContain("get_customer");
    expect(worker).not.toContain("propose_task");
    expect(toolsFor("owner").map((t) => t.name)).toContain("list_payments");
    expect(toolsFor("customer")).toHaveLength(0);
  });

  it("refuses a tool the role can't use even if the model asks for it", async () => {
    const r = await runTool("list_payments", { filter: "overdue" }, ctxFor("worker", "Worker"));
    expect(r.ok).toBe(false);
  });

  it("hides money from a worker's project lookup", async () => {
    const r = await runTool("get_project", { project_id: "recDemoProj000001" }, ctxFor("worker", "Worker"));
    expect(r.ok).toBe(true);
    const data = r.ok ? (r.outcome.data as Record<string, unknown>) : {};
    expect(data.name).toBe("Taylor Demo – Front Yard");
    expect(data.money).toBe("not permitted");
    expect(JSON.stringify(data)).not.toMatch(/\$/);
  });

  it("gives the owner contract, payments and finished-work profit", async () => {
    const r = await runTool("get_project", { project_id: "recDemoProj000001" }, ctxFor("owner"));
    const data = r.ok ? (r.outcome.data as Record<string, any>) : {};
    expect(data.contractIncGst.current).toBe("$38,500.00");
    expect(data.contractIncGst.pendingVariations).toBe("$858.00");
    expect(data.profit.finishedComponents).toBe(1);
  });

  it("lists overdue payments from records", async () => {
    const r = await runTool("list_payments", { filter: "overdue" }, ctxFor("owner"));
    const data = r.ok ? (r.outcome.data as Record<string, any>) : {};
    expect(data.count).toBe(1);
    expect(data.payments[0].title).toBe("Q-DEMO-001 Progress 1");
  });

  it("rejects made-up record ids instead of guessing", async () => {
    const r = await runTool("get_customer", { customer_id: "recDoesNotExist01" }, ctxFor("owner"));
    expect(r).toEqual({ ok: false, error: "No customers record with id recDoesNotExist01" });
  });

  it("returns a proposal for a task without creating anything", async () => {
    const ctx = ctxFor("owner");
    const before = (await ctx.repo.list("tasks")).length;
    const r = await runTool("propose_task", { title: "Call Jordan about driveway", due_date: "2026-11-03", customer_id: "recDemoCust000004" }, ctx);
    expect(r.ok && r.outcome.proposal?.endpoint).toBe("/api/tasks");
    expect((await ctx.repo.list("tasks")).length).toBe(before);
  });

  it("won't propose a follow-up in the past", async () => {
    const r = await runTool("propose_follow_up", { enquiry_id: "recDemoEnq0000002", next_follow_up: "2026-10-01", next_action: "Call" }, ctxFor("owner"));
    expect(r.ok).toBe(false);
  });
});

describe("change requests", () => {
  it("lets any staff member write up an ATLAS change, but only as a proposal", async () => {
    const ctx = ctxFor("worker", "Wes Worker");
    expect(toolsFor("worker").map((t) => t.name)).toContain("propose_change_request");
    const r = await runTool("propose_change_request", { title: "Add a time to bookings", what: "Let me pick a time when booking a site visit, e.g. 9:30 am.", size: "small" }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome.proposal).toMatchObject({ kind: "change-request", endpoint: "/api/change-requests", method: "POST" });
    expect((await ctx.repo.list("tasks")).some((t) => t.title?.includes("Add a time"))).toBe(false);
    const bad = await runTool("propose_change_request", { title: "x", what: "y", size: "huge" }, ctx);
    expect(bad.ok).toBe(false);
  });
});

describe("assistant loop", () => {
  it("runs tools, sends all results back in one message, and returns the answer", async () => {
    const { client, calls } = fakeClient([
      msg([toolUse("t1", "list_payments", { filter: "overdue" }), toolUse("t2", "list_tasks", {})], "tool_use"),
      msg([text("One payment is overdue: Q-DEMO-001 Progress 1, $11,550.00 inc GST.")], "end_turn"),
    ]);
    const reply = await runAssistant(client, ask("What's overdue?"), ctxFor("owner"));
    expect(reply.status).toBe("ok");
    expect(reply.text).toMatch(/Progress 1/);
    expect(reply.lookups).toEqual([{ tool: "list_payments", ok: true }, { tool: "list_tasks", ok: true }]);
    const second = calls[1]!;
    const last = second.messages[second.messages.length - 1]!;
    expect(last.role).toBe("user");
    expect((last.content as Beta.BetaToolResultBlockParam[]).map((b) => b.tool_use_id)).toEqual(["t1", "t2"]);
    expect(second.model).toBe("claude-opus-5-5");
    expect(second.thinking).toEqual({ type: "adaptive" });
    expect(second.fallbacks).toBe("default");
  });

  it("reports tool errors to the model with is_error", async () => {
    const { client, calls } = fakeClient([msg([toolUse("t1", "list_payments", { filter: "overdue" })], "tool_use"), msg([text("You don't have access to payments.")], "end_turn")]);
    await runAssistant(client, ask("What's overdue?"), ctxFor("worker", "Worker"));
    const result = (calls[1]!.messages.at(-1)!.content as Beta.BetaToolResultBlockParam[])[0]!;
    expect(result.is_error).toBe(true);
    expect(calls[0]!.tools!.map((t) => (t as { name: string }).name)).not.toContain("list_payments");
  });

  it("collects proposals for the person to confirm", async () => {
    const { client } = fakeClient([
      msg([toolUse("t9", "propose_follow_up", { enquiry_id: "recDemoEnq0000002", next_follow_up: "2026-11-04", next_action: "Call about proposal" })], "tool_use"),
      msg([text("I've suggested a follow-up for Wednesday. Press Confirm to save it.")], "end_turn"),
    ]);
    const reply = await runAssistant(client, ask("Remind me to chase Sam & Jo"), ctxFor("owner"));
    expect(reply.proposals).toHaveLength(1);
    expect(reply.proposals[0]).toMatchObject({ id: "t9", method: "PATCH", endpoint: "/api/enquiries/recDemoEnq0000002" });
  });

  it("handles a refusal without reading content", async () => {
    const { client } = fakeClient([msg([], "refusal")]);
    const reply = await runAssistant(client, ask("something"), ctxFor("owner"));
    expect(reply.status).toBe("refused");
  });

  it("stops after a bounded number of steps", async () => {
    const loops = Array.from({ length: 10 }, (_, i) => msg([toolUse(`t${i}`, "list_tasks", {})], "tool_use"));
    const { client, calls } = fakeClient(loops);
    const reply = await runAssistant(client, ask("loop"), ctxFor("owner"));
    expect(reply.status).toBe("incomplete");
    expect(calls.length).toBe(8);
  });

  it("rejects conversations that don't end with the person's message", () => {
    expect(ChatInput.safeParse({ messages: [{ role: "assistant", content: "hi" }] }).success).toBe(false);
  });
});
