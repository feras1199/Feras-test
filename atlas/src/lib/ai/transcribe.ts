/**
 * Speech-to-text for site visit voice notes. Claude doesn't take audio, so this
 * uses a transcription service: Deepgram (labels who is speaking) or OpenAI.
 * Whichever key the server has is used; the key never reaches the browser.
 */

export type TranscriptionProvider = "deepgram" | "openai";

export function transcriptionProvider(env: NodeJS.ProcessEnv = process.env): TranscriptionProvider | null {
  if (env.DEEPGRAM_API_KEY) return "deepgram";
  if (env.OPENAI_API_KEY) return "openai";
  return null;
}

export class TranscriptionError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Words the transcriber should expect, so trade terms come out right. */
const VOCAB = ["pavers", "sandstone", "bluestone", "retaining wall", "sleepers", "turf", "Sir Walter", "drainage", "ag pipe", "stormwater", "pergola", "decking", "excavation", "road base", "crusher dust", "bedding sand", "mulch", "garden bed", "council", "DA"];

const EXT: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/aac": "aac" };

type DeepgramResponse = {
  results?: { channels?: { alternatives?: { transcript?: string; paragraphs?: { transcript?: string } }[] }[] };
};

export async function transcribe(bytes: Buffer, mime: string, opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}): Promise<{ text: string; provider: TranscriptionProvider }> {
  const env = opts.env ?? process.env;
  const f = opts.fetchImpl ?? fetch;
  const provider = transcriptionProvider(env);
  if (!provider) throw new TranscriptionError(503, "Turning voice notes into text isn't set up yet. The owner needs to add a transcription key (DEEPGRAM_API_KEY or OPENAI_API_KEY) on the server.");

  if (provider === "deepgram") {
    const qs = new URLSearchParams({ model: env.ATLAS_DEEPGRAM_MODEL || "nova-3", language: "en", smart_format: "true", diarize: "true", paragraphs: "true" });
    for (const k of VOCAB) qs.append("keyterm", k);
    const res = await f(`https://api.deepgram.com/v1/listen?${qs}`, { method: "POST", headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, "Content-Type": mime }, body: new Uint8Array(bytes) });
    if (!res.ok) throw new TranscriptionError(res.status, res.status === 401 || res.status === 403 ? "The transcription key was rejected. Check DEEPGRAM_API_KEY." : `The transcription service answered ${res.status}. Try again in a minute.`);
    const json = (await res.json()) as DeepgramResponse;
    const alt = json.results?.channels?.[0]?.alternatives?.[0];
    const text = (alt?.paragraphs?.transcript || alt?.transcript || "").trim();
    return { text, provider };
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `voice-note.${EXT[mime] ?? "webm"}`);
  form.append("model", env.ATLAS_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  form.append("language", "en");
  form.append("prompt", `A landscaping site visit in Sydney, Australia, between the builder and the customer. Terms: ${VOCAB.join(", ")}.`);
  const res = await f("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form });
  if (!res.ok) throw new TranscriptionError(res.status, res.status === 401 || res.status === 403 ? "The transcription key was rejected. Check OPENAI_API_KEY." : `The transcription service answered ${res.status}. Try again in a minute.`);
  const json = (await res.json()) as { text?: string };
  return { text: (json.text ?? "").trim(), provider };
}
