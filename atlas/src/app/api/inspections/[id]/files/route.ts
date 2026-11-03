import { HttpError, route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { fileStoreOf } from "@/lib/data/repository";
import { MAX_PHOTO_BYTES, MAX_VOICE_BYTES, MAX_VOICE_SECONDS, sniffMedia } from "@/lib/domain/media";

/** Adds one photo or voice note to a site inspection. Sent as a form upload with a "file" field. */
export const POST = route<{ id: string }>("inspections.edit", async ({ req, params, session }) => {
  const repo = getRepo();
  const files = fileStoreOf(repo);
  if (!files) throw new HttpError(409, "Photos and voice notes need ATLAS's own database.");
  const insp = await repo.get("inspections", params.id);
  if (!insp) throw new HttpError(404, "Inspection not found");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) throw new HttpError(400, "No file was sent");
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = sniffMedia(bytes);
  if (!type) throw new HttpError(415, "ATLAS takes photos (JPEG, PNG, WebP) and voice recordings only.");
  if (bytes.length > (type.kind === "photo" ? MAX_PHOTO_BYTES : MAX_VOICE_BYTES)) throw new HttpError(413, type.kind === "photo" ? "That photo is too large" : "That recording is too long to save in one go");
  const rawDuration = Number(form?.get("durationS"));
  const durationS = type.kind === "voice" && Number.isFinite(rawDuration) && rawDuration > 0 ? Math.min(rawDuration, MAX_VOICE_SECONDS) : undefined;
  const when = new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const given = String(form?.get("name") ?? "").trim().slice(0, 80);
  const name = given || `${type.kind === "photo" ? "Photo" : "Voice note"}, ${when}`;
  const saved = await files.addFile({ entity: "inspections", recordId: params.id, kind: type.kind, mime: type.mime, name, size: bytes.length, durationS, createdBy: session.name }, bytes);
  audit(session, { action: `inspection.${type.kind}.add`, entity: "inspections", recordId: params.id, summary: `${insp.title ?? "Inspection"}: added ${type.kind === "photo" ? "a photo" : "a voice note"} (${Math.round(bytes.length / 1024)} KB)` });
  return { file: saved };
}, { maxBodyBytes: MAX_VOICE_BYTES + 64 * 1024 });
