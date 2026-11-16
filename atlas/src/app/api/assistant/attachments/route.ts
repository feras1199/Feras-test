import { HttpError, route } from "@/lib/server/api";
import { saveAttachment } from "@/lib/server/assistantFiles";
import { MAX_DOCUMENT_BYTES, MAX_VOICE_BYTES, MAX_VOICE_SECONDS } from "@/lib/domain/media";

export const maxDuration = 120;

/** Share a PDF, photo or voice note with Ask ATLAS. Sent as a form upload with a "file" field. */
export const POST = route("ai.use", async ({ req, session }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) throw new HttpError(400, "No file was sent");
  const bytes = Buffer.from(await file.arrayBuffer());
  const raw = Number(form?.get("durationS"));
  const durationS = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_VOICE_SECONDS) : undefined;
  const given = String(form?.get("name") ?? (file instanceof File ? file.name : ""));
  return { file: await saveAttachment(session, bytes, given, durationS) };
}, { maxBodyBytes: Math.max(MAX_VOICE_BYTES, MAX_DOCUMENT_BYTES) + 64 * 1024 });
