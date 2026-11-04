import type * as Beta from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { MessagesClient } from "./assistant";
import { NOTE_KEYS, type NoteField } from "./siteNotes";

/**
 * Stand-ins for the transcription and AI services, so the whole voice-note flow
 * can be tested without keys. Only ever used in the fictional demo data mode
 * with ATLAS_AI_DEMO=1; everything they produce is labelled as a demo.
 */
export function aiDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const memory = !env.ATLAS_DATA_SOURCE || (env.ATLAS_DATA_SOURCE !== "postgres" && env.ATLAS_DATA_SOURCE !== "airtable");
  return memory && env.ATLAS_AI_DEMO === "1";
}

export const DEMO_LABEL = "[Demo transcript made up for testing, not from the recording]";

/** A made-up site conversation built around what the customer asked for. */
export function demoTranscript(request: string, n: number): string {
  const ask = request.trim() || "a backyard makeover";
  const lines = [
    [
      `Builder: So tell me what you're after.`,
      `Customer: We'd like ${ask}. We want it done before Christmas if possible.`,
      `Builder: The ground falls about 300 mm from the house to the back fence, so we'll need to level it out.`,
      `Customer: Our budget is around fifteen thousand.`,
    ],
    [
      `Builder: Side access is about 1.1 metres wide, so a small excavator will fit but no truck.`,
      `Builder: Water pools near the back door after rain, we'll need ag pipe and a pit tied into the stormwater.`,
      `Builder: There's a sewer inspection point near the clothesline and the power runs along the left fence.`,
    ],
    [
      `Customer: We like a natural look, sandstone colours, nothing too modern.`,
      `Builder: Existing lawn is patchy and there's an old concrete path we'd remove.`,
      `Builder: Watch the dog, and the neighbour's tree overhangs the back corner.`,
      `Builder: Next step, I'll send a quote by Friday.`,
    ],
  ];
  return `${DEMO_LABEL}\n${(lines[n % lines.length] ?? lines[0]!).join("\n")}`;
}

/** A made-up phone call about a new job, for testing "share a voice note with Ask ATLAS". */
export function demoCallTranscript(): string {
  return [
    DEMO_LABEL,
    "Builder: This is about the Jordan Sample job.",
    "Customer: Hi, it's Jordan Sample. My email is jordan.sample@example.com and my mobile is 0491 570 159.",
    "Customer: The address is 12 Example Street, Penrith.",
    "Customer: We'd like new turf, about 40 square metres, and a sandstone retaining wall about 6 metres long.",
  ].join("\n");
}

const KEYWORDS: Record<NoteField, RegExp> = {
  scope: /we'd like|after|want it/i,
  existingConditions: /existing|old |patchy/i,
  slopeLevels: /falls|level|slope/i,
  drainage: /water|drain|ag pipe|stormwater|pools/i,
  services: /sewer|power|gas|water main/i,
  risks: /watch|tree|hazard|dog/i,
  priorities: /natural|look|colour|style|before christmas/i,
  notes: /next step|quote by/i,
};

/** Picks sentences by keyword, so the demo fill-in is driven by the transcript text itself. */
export function demoClient(): MessagesClient {
  return {
    beta: {
      messages: {
        async create(params: Beta.MessageCreateParamsNonStreaming): Promise<Beta.BetaMessage> {
          const msg = params.messages[0];
          const text = typeof msg?.content === "string" ? msg.content : "";
          const sentences = text.split("\n").filter((l) => /^(Builder|Customer):/.test(l)).map((l) => l.replace(/^(Builder|Customer):\s*/, ""));
          const input: Record<string, unknown> = {};
          for (const k of NOTE_KEYS) input[k] = sentences.filter((s) => KEYWORDS[k].test(s)).join(" ");
          const width = /(\d+(?:\.\d+)?) metres wide/.exec(text);
          input.accessWidthM = width ? Number(width[1]) : null;
          input.accessDifficulty = width && Number(width[1]) < 1.5 ? "Difficult" : "";
          input.summary = `Demo summary (made up for testing).\n${sentences.slice(0, 6).map((s) => `- ${s}`).join("\n")}`;
          return {
            id: "msg_demo", type: "message", role: "assistant", model: "demo", stop_reason: "end_turn", stop_sequence: null,
            content: [{ type: "text", text: JSON.stringify(input), citations: null }],
            usage: { input_tokens: 0, output_tokens: 0 },
          } as unknown as Beta.BetaMessage;
        },
      },
    },
  };
}

type Block = Beta.BetaContentBlockParam | Beta.BetaContentBlock;
const blocksOf = (m: Beta.BetaMessageParam): Block[] => (typeof m.content === "string" ? [{ type: "text", text: m.content } as Block] : (m.content as Block[]));

function reply(content: Beta.BetaContentBlock[], stop: "tool_use" | "end_turn"): Beta.BetaMessage {
  return { id: "msg_demo", type: "message", role: "assistant", model: "demo", stop_reason: stop, stop_sequence: null, content, usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Beta.BetaMessage;
}

/**
 * A scripted stand-in for Ask ATLAS, so "share a file and let ATLAS fill things in" can be
 * tested end to end without a key. It reads only voice-note transcripts (it can't read PDFs
 * or photos), runs the real tools, and labels everything it says as a demo.
 */
export function demoAssistantClient(): MessagesClient {
  return {
    beta: {
      messages: {
        async create(params: Beta.MessageCreateParamsNonStreaming): Promise<Beta.BetaMessage> {
          const msgs = params.messages;
          // The person's latest real message: the last user message that isn't only tool results.
          let start = msgs.length - 1;
          while (start > 0 && (msgs[start]!.role !== "user" || blocksOf(msgs[start]!).every((b) => b.type === "tool_result"))) start--;
          const asked = blocksOf(msgs[start]!);
          const text = asked.filter((b): b is Beta.BetaTextBlockParam => b.type === "text").map((b) => b.text).join("\n");
          const unread = asked.filter((b) => b.type === "document" || b.type === "image").length;
          const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
          const results = new Map<string, string>();
          for (const m of msgs.slice(start + 1)) {
            for (const b of blocksOf(m)) {
              if (b.type === "tool_use") calls.set(b.id, { name: b.name, input: b.input as Record<string, unknown> });
              if (b.type === "tool_result") results.set(b.tool_use_id, typeof b.content === "string" ? b.content : "");
            }
          }
          const done = (name: string) => [...calls.entries()].filter(([, c]) => c.name === name).map(([id, c]) => ({ input: c.input, out: (() => { try { return JSON.parse(results.get(id) ?? "null"); } catch { return null; } })() }));
          let n = 0;
          const use = (name: string, input: Record<string, unknown>) => ({ type: "tool_use", id: `toolu_demo_${calls.size}_${n++}`, name, input }) as Beta.BetaContentBlock;
          const say = (t: string) => ({ type: "text", text: t, citations: null }) as Beta.BetaContentBlock;

          const name = /(?:it's|this is|about the|for) ([A-Z][a-z]+ [A-Z][a-z]+)/.exec(text)?.[1];
          if (!/Transcript/.test(text) || !name) {
            return reply([say(`Demo reply (made up for testing, no AI connected). ${unread ? "Demo mode can't read PDFs or photos; with an Anthropic key ATLAS reads them. " : ""}Share a voice note that names the customer to try filling ATLAS in.`)], "end_turn");
          }
          const field = (re: RegExp) => re.exec(text)?.[1]?.trim();
          const details = { phone: field(/mobile is ([\d ]{8,})/), email: field(/email is (\S+@\S+?)\.?(?:\s|$)/), address: field(/address is ([^,]+),/), suburb: field(/address is [^,]+, ([A-Za-z ]+)\./), service_requested: field(/We'd like (.+?)\.(?:\n|$)/) };
          const lib = ["turf", "sandstone"].filter((w) => text.toLowerCase().includes(w));

          if (!done("search_records").length) return reply([use("search_records", { query: name }), ...lib.map((q) => use("search_cost_library", { query: q }))], "tool_use");
          const customer = done("search_records")[0]?.out?.hits?.find((h: { type: string }) => h.type === "Customer");
          if (customer && !done("get_customer").length) return reply([use("get_customer", { customer_id: customer.id })], "tool_use");
          if (![...calls.values()].some((c) => c.name.startsWith("propose_"))) {
            const source = "voice note";
            if (!customer) return reply([use("propose_customer_details", { name, ...details, source })], "tool_use");
            const out = [use("propose_customer_details", { customer_id: customer.id, ...details, source })];
            const draft = done("get_customer")[0]?.out?.quotes;
            const quote = Array.isArray(draft) ? draft.find((q: { status: string }) => q.status === "Draft") : null;
            type Hit = { id: string; unit: string | null; category: string | null };
            // Only use a library item sold in the same unit (turf by the m², walls by the metre); otherwise leave the line unpriced.
            const item = (q: string, fits: (h: Hit) => boolean) => { const hits: Hit[] = done("search_cost_library").find((r) => r.input.query === q)?.out?.items ?? []; return hits.find(fits)?.id; };
            const area = Number(field(/about (\d+) square metres/));
            const wall = Number(field(/about (\d+) metres long/));
            const lines = [
              area ? { cost_item_id: item("turf", (h) => /^m(2|²)$/i.test(h.unit ?? "")), description: "Turf", quantity: area, unit: "m2", source } : null,
              wall ? { cost_item_id: item("sandstone", (h) => /wall/i.test(h.category ?? "") && /^(m|lm)$/i.test(h.unit ?? "")), description: "Sandstone retaining wall", quantity: wall, unit: "m", source } : null,
            ].filter(Boolean).map((l) => Object.fromEntries(Object.entries(l!).filter(([, v]) => v !== undefined)));
            if (quote && lines.length) out.push(use("propose_estimate_lines", { estimate_id: quote.id, lines: lines.map((l) => (l.cost_item_id ? { ...l, unit: undefined } : l)).map((l) => JSON.parse(JSON.stringify(l))) }));
            return reply(out, "tool_use");
          }
          return reply([say(`Demo reply (made up for testing, no AI connected). I read the voice note about ${name} and suggested what to fill in below. Nothing is saved until you press Confirm. Quantities I suggest are marked "AI suggested" and need checking before the estimate can be approved.`)], "end_turn");
        },
      },
    },
  };
}
