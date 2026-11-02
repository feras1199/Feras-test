import type * as Beta from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { ROLE_LABELS } from "../auth/roles";
import { runTool, toolsFor, type Proposal, type ToolContext } from "./tools";

/** The slice of the SDK client the assistant uses, so tests can pass a fake. */
export interface MessagesClient {
  beta: { messages: { create(params: Beta.MessageCreateParamsNonStreaming): Promise<Beta.BetaMessage> } };
}

export const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_STEPS = 8;

export const ChatInput = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(30)
    .refine((m) => m[0]?.role === "user" && m[m.length - 1]?.role === "user", "Conversation must start and end with the person's message"),
});
export type ChatInput = z.infer<typeof ChatInput>;

export interface AssistantReply {
  text: string;
  /** Tools the answer was built from, so the person can see where it came from. */
  lookups: { tool: string; ok: boolean }[];
  proposals: Proposal[];
  status: "ok" | "refused" | "incomplete";
}

const SYSTEM = `You are ATLAS, the operations assistant inside Whispering Leaf Landscaping & Construction's business system (Sydney, Australia). You help staff with customers, enquiries, quotes, projects, schedules, tasks and payments.

How you work:
- Answer only from what the tools return. Look things up before answering any question about customers, jobs, money, dates or status. If a tool returns nothing, or says something is not permitted, say that plainly. Never fill gaps with plausible-sounding names, amounts, dates or statuses.
- The tools only return what the signed-in person's role may see. If something is "not permitted", tell them it is outside their access; don't speculate about it.
- Money is in Australian dollars. Say whether a figure is inc GST or ex GST, as labelled in the tool output. Use the figures as given; don't recalculate totals the tools already provide.
- You cannot send emails or messages, raise invoices, take payments, approve quotes or change records. To suggest a task or a follow-up date, use propose_task or propose_follow_up; the person must press Confirm before anything is saved. Say it is waiting for their confirmation, never that it is done.
- If asked to draft a message to a customer, write the draft in your reply and say it has not been sent. Keep internal costs, pay rates, margins and private notes out of anything addressed to a customer.
- Be brief and practical. Lead with the answer. Use short lists for several items. Refer to records by name, not by id.`;

function contextBlock(ctx: ToolContext) {
  return `Today is ${ctx.today} (Sydney). Signed in: ${ctx.session.name}, role ${ROLE_LABELS[ctx.session.role]}.`;
}

/**
 * Runs one assistant turn: sends the conversation, executes requested tools
 * (permission-checked) and loops until the model answers. Thinking blocks
 * are passed back unchanged within the turn.
 */
export async function runAssistant(client: MessagesClient, input: ChatInput, ctx: ToolContext, opts: { model?: string } = {}): Promise<AssistantReply> {
  const tools = toolsFor(ctx.session.role);
  const apiTools: Beta.BetaTool[] = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  const messages: Beta.BetaMessageParam[] = input.messages.map((m) => ({ role: m.role, content: m.content }));
  const lookups: AssistantReply["lookups"] = [];
  const proposals: Proposal[] = [];
  let text = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.beta.messages.create({
      model: opts.model || DEFAULT_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: [
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: contextBlock(ctx) },
      ],
      tools: apiTools,
      messages,
    });

    if (res.stop_reason === "refusal") {
      return { text: "I can't help with that request.", lookups, proposals, status: "refused" };
    }

    const said = res.content.filter((b): b is Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    if (said) text = said; // keep the latest answer, not interim narration

    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    if (res.stop_reason !== "tool_use") {
      const incomplete = res.stop_reason === "max_tokens";
      return { text: text || "I don't have an answer for that.", lookups, proposals, status: incomplete ? "incomplete" : "ok" };
    }

    messages.push({ role: "assistant", content: res.content });
    const results: Beta.BetaToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const r = await runTool(block.name, block.input, ctx);
      lookups.push({ tool: block.name, ok: r.ok });
      if (!r.ok) {
        results.push({ type: "tool_result", tool_use_id: block.id, content: r.error, is_error: true });
        continue;
      }
      if (r.outcome.proposal) proposals.push({ ...r.outcome.proposal, id: block.id });
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(r.outcome.data) });
    }
    // All results for this step go back in one user message.
    messages.push({ role: "user", content: results });
  }
  return { text: text || "That needed more lookups than I'm allowed in one go. Try a narrower question.", lookups, proposals, status: "incomplete" };
}
