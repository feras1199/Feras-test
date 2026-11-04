import { describe, expect, it, vi } from "vitest";
import { draftSiteNotes, parseDraft, planFill } from "@/lib/ai/siteNotes";
import { transcribe, transcriptionProvider } from "@/lib/ai/transcribe";
import { aiDemoMode, demoClient, demoTranscript, DEMO_LABEL } from "@/lib/ai/demo";

describe("planFill", () => {
  const draft = { summary: "s", fields: { scope: "Paving 40 m²", drainage: "Ag pipe to pit", risks: "Dog on site" } };
  it("fills empty boxes and never overwrites what a person typed", () => {
    const r = planFill({ scope: "", drainage: "Customer says it floods", risks: null }, {}, draft);
    expect(r.updates).toEqual({ scope: "Paving 40 m²", risks: "Dog on site" });
    expect(r.kept).toEqual(["drainage"]);
  });
  it("updates its own earlier text when nobody has edited it", () => {
    const r = planFill({ scope: "Paving", drainage: "edited by me" }, { scope: "Paving", drainage: "Old AI text" }, draft);
    expect(r.updates.scope).toBe("Paving 40 m²");
    expect(r.kept).toEqual(["drainage"]);
  });
});

describe("parseDraft", () => {
  it("keeps only well-formed values", () => {
    const d = parseDraft({ summary: " Met Sam ", scope: "Turf", drainage: 42, accessDifficulty: "Impossible", accessWidthM: 1.1, extra: "x" });
    expect(d).toEqual({ summary: "Met Sam", fields: { scope: "Turf" }, accessDifficulty: undefined, accessWidthM: 1.1 });
    expect(parseDraft(null).fields).toEqual({});
  });
});

describe("draftSiteNotes", () => {
  it("asks for JSON matching the notes schema (no forced tool) and reads it", async () => {
    const create = vi.fn(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ summary: "ok", scope: "Paving", drainage: "", accessDifficulty: "", accessWidthM: null }) }] }));
    const d = await draftSiteNotes({ beta: { messages: { create } } } as never, { transcripts: [{ name: "Voice note 1", text: "We'd like paving" }] });
    expect(d.fields).toEqual({ scope: "Paving" });
    expect(d.accessWidthM).toBeUndefined();
    const params = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(params.tool_choice).toBeUndefined();
    expect(params.tools).toBeUndefined();
    const format = (params.output_config as { format: { type: string; schema: { required: string[]; additionalProperties: boolean } } }).format;
    expect(format.type).toBe("json_schema");
    expect(format.schema.additionalProperties).toBe(false);
    expect(format.schema.required).toEqual(expect.arrayContaining(["summary", "scope", "accessWidthM"]));
    expect(JSON.stringify(params.messages)).toContain("We'd like paving");
  });

  it("fails safely when the reply isn't readable or is cut short", async () => {
    const bad = vi.fn(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Sure! Here are the notes" }] }));
    await expect(draftSiteNotes({ beta: { messages: { create: bad } } } as never, { transcripts: [{ name: "n", text: "t" }] })).rejects.toThrow(/couldn't read/);
    const cut = vi.fn(async () => ({ stop_reason: "max_tokens", content: [] }));
    await expect(draftSiteNotes({ beta: { messages: { create: cut } } } as never, { transcripts: [{ name: "n", text: "t" }] })).rejects.toThrow(/cut short/);
  });
});

describe("transcribe", () => {
  it("uses Deepgram when its key is set, with speaker labels", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "flat", paragraphs: { transcript: "Speaker 0: hello\nSpeaker 1: hi" } }] }] } })));
    const r = await transcribe(Buffer.from("x"), "audio/mp4", { env: { DEEPGRAM_API_KEY: "dg" } as never, fetchImpl: f as never });
    expect(r).toEqual({ text: "Speaker 0: hello\nSpeaker 1: hi", provider: "deepgram" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("diarize=true");
    expect((init.headers as Record<string, string>).Authorization).toBe("Token dg");
  });
  it("falls back to OpenAI, and says plainly when nothing is set up", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ text: " hello " })));
    expect(await transcribe(Buffer.from("x"), "audio/webm", { env: { OPENAI_API_KEY: "sk" } as never, fetchImpl: f as never })).toEqual({ text: "hello", provider: "openai" });
    expect(transcriptionProvider({} as never)).toBeNull();
    await expect(transcribe(Buffer.from("x"), "audio/webm", { env: {} as never })).rejects.toThrow(/isn't set up/);
    const bad = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(transcribe(Buffer.from("x"), "audio/webm", { env: { OPENAI_API_KEY: "sk" } as never, fetchImpl: bad as never })).rejects.toThrow(/rejected/);
  });
});

describe("demo stand-ins", () => {
  it("only switch on for the fictional demo data, and label what they make", async () => {
    expect(aiDemoMode({ ATLAS_AI_DEMO: "1" } as never)).toBe(true);
    expect(aiDemoMode({ ATLAS_AI_DEMO: "1", ATLAS_DATA_SOURCE: "postgres" } as never)).toBe(false);
    expect(aiDemoMode({} as never)).toBe(false);
    const t = demoTranscript("a new deck", 0);
    expect(t.startsWith(DEMO_LABEL)).toBe(true);
    const d = await draftSiteNotes(demoClient(), { transcripts: [{ name: "1", text: t }, { name: "2", text: demoTranscript("", 1) }] });
    expect(d.fields.scope).toContain("a new deck");
    expect(d.fields.drainage).toMatch(/ag pipe/);
    expect(d.accessWidthM).toBe(1.1);
    expect(d.summary).toMatch(/^Demo summary/);
  });
});
