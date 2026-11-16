import "server-only";
import { fileStoreOf, type StoredFile } from "../data/repository";
import { maxBytesFor, sniffAttachment } from "../domain/media";
import type { Attachment } from "../ai/attachments";
import { aiDemoMode, demoCallTranscript } from "../ai/demo";
import { transcribe, transcriptionProvider, TranscriptionError } from "../ai/transcribe";
import type { SessionPayload } from "../auth/session";
import { HttpError } from "./api";
import { audit } from "./audit";
import { getRepo } from "./context";

function store() {
  const s = fileStoreOf(getRepo());
  if (!s) throw new HttpError(409, "Sharing files with ATLAS needs ATLAS's own database.");
  return s;
}

export const MAX_CHAT_FILE_BYTES = 18 * 1024 * 1024;

const LABEL = { photo: "photo", voice: "voice note", document: "PDF" } as const;

/**
 * Saves a file someone shares in Ask ATLAS. It belongs to them only. Voice notes
 * are turned into text straight away, because the AI reads text, not audio.
 */
export async function saveAttachment(session: SessionPayload, bytes: Buffer, given: string, durationS?: number) {
  const files = store();
  const type = sniffAttachment(bytes);
  if (!type) throw new HttpError(415, "ATLAS can read PDFs, photos (JPEG, PNG, WebP) and voice recordings. Save other documents as PDF first.");
  if (bytes.length > maxBytesFor(type.kind)) throw new HttpError(413, type.kind === "document" ? "That PDF is over 10 MB. Send the pages that matter, or a smaller copy." : type.kind === "photo" ? "That photo is too large" : "That recording is too long to send in one go");

  let transcript: string | undefined;
  if (type.kind === "voice") {
    if (aiDemoMode()) transcript = demoCallTranscript();
    else {
      if (!transcriptionProvider()) throw new HttpError(503, "ATLAS can't listen to voice notes yet. The owner needs to add a transcription key on the server (see Settings).");
      try {
        transcript = (await transcribe(bytes, type.mime)).text;
      } catch (e) {
        if (e instanceof TranscriptionError) throw new HttpError(e.status === 503 ? 503 : 502, e.message);
        throw new HttpError(502, "Couldn't reach the transcription service. Check the signal and try again.");
      }
    }
    if (!transcript?.trim()) throw new HttpError(422, "No speech was picked up. Try recording closer to the phone.");
  }

  const when = new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const name = given.trim().slice(0, 80) || `${type.kind === "voice" ? "Voice note" : type.kind === "photo" ? "Photo" : "Document"}, ${when}`;
  const saved = await files.addFile({ entity: "assistant", recordId: session.uid, kind: type.kind, mime: type.mime, name, size: bytes.length, durationS: type.kind === "voice" ? durationS : undefined, createdBy: session.name }, bytes);
  if (transcript !== undefined) await files.setFileTranscript(saved.id, transcript);
  audit(session, { action: `ai.${type.kind}.share`, summary: `Shared a ${LABEL[type.kind]} with Ask ATLAS: ${name} (${Math.round(bytes.length / 1024)} KB)` });
  return { id: saved.id, kind: saved.kind, name: saved.name, transcript };
}

/** Loads files for the AI. Only the person's own, not removed; anything else is refused. */
export async function loadAttachments(session: Pick<SessionPayload, "uid">, ids: string[]): Promise<Map<string, Attachment>> {
  const out = new Map<string, Attachment>();
  if (!ids.length) return out;
  const files = store();
  let bytes = 0;
  for (const id of new Set(ids)) {
    const f = await files.getFile(id);
    if (!f || f.meta.entity !== "assistant" || f.meta.recordId !== session.uid || f.meta.archived) throw new HttpError(404, "One of the shared files is no longer available. Share it again.");
    if (f.meta.kind !== "voice") bytes += f.bytes.length;
    out.set(id, toAttachment(f.meta, f.bytes));
  }
  // The AI takes about 32 MB per request and files grow by a third when sent; stay well clear.
  if (bytes > MAX_CHAT_FILE_BYTES) throw new HttpError(413, "That's a lot of large files in one chat. Start a new chat for the next document.");
  return out;
}

function toAttachment(meta: StoredFile, bytes: Buffer): Attachment {
  if (meta.kind === "voice") return { kind: "voice", name: meta.name, transcript: meta.transcript ?? "" };
  return { kind: meta.kind, name: meta.name, mime: meta.mime, base64: bytes.toString("base64") };
}
