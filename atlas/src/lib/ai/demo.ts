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
            id: "msg_demo", type: "message", role: "assistant", model: "demo", stop_reason: "tool_use", stop_sequence: null,
            content: [{ type: "tool_use", id: "toolu_demo", name: "save_site_notes", input }],
            usage: { input_tokens: 0, output_tokens: 0 },
          } as unknown as Beta.BetaMessage;
        },
      },
    },
  };
}
