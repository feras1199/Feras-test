import type * as Beta from "@anthropic-ai/sdk/resources/beta/messages/messages";

/** A file shared in Ask ATLAS, ready to hand to the AI. Voice notes arrive as their transcript. */
export type Attachment =
  | { kind: "document" | "photo"; name: string; mime: string; base64: string }
  | { kind: "voice"; name: string; transcript: string };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Turns one of the person's messages plus its files into content blocks.
 * PDFs go in as documents (Claude reads the text and the page images), photos as images,
 * and voice notes as clearly labelled transcripts. Files always come before the question.
 */
export function userContent(text: string, files: Attachment[]): Beta.BetaContentBlockParam[] {
  const blocks: Beta.BetaContentBlockParam[] = [];
  for (const f of files) {
    if (f.kind === "document") {
      blocks.push({ type: "document", title: f.name, source: { type: "base64", media_type: "application/pdf", data: f.base64 } });
    } else if (f.kind === "photo") {
      if (!IMAGE_TYPES.has(f.mime)) continue;
      blocks.push({ type: "text", text: `Photo shared: ${f.name}` });
      blocks.push({ type: "image", source: { type: "base64", media_type: f.mime as "image/jpeg", data: f.base64 } });
    } else if (f.kind === "voice") {
      blocks.push({ type: "text", text: `Voice note shared: ${f.name}\nTranscript (speech-to-text, may contain small errors):\n${f.transcript || "(no speech picked up)"}` });
    }
  }
  const ask = text.trim() || (files.length ? "I've shared the file(s) above. Tell me what's in them that matters for ATLAS and what you'd suggest filling in." : "");
  blocks.push({ type: "text", text: ask });
  return blocks;
}
