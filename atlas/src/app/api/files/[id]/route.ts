import { z } from "zod";
import { HttpError, route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { can, type Permission, type Role } from "@/lib/auth/roles";
import { fileStoreOf, type StoredFile } from "@/lib/data/repository";
import { parseRange } from "@/lib/domain/media";

/** Inspection files follow the inspection's permissions; files shared in Ask ATLAS are only for the person who shared them. */
function mayView(meta: StoredFile, session: { uid: string; role: Role }) {
  return meta.entity === "assistant" ? meta.recordId === session.uid : can(session.role, `${meta.entity}.view` as Permission);
}
function mayEdit(meta: StoredFile, session: { uid: string; role: Role }) {
  return meta.entity === "assistant" ? meta.recordId === session.uid : can(session.role, `${meta.entity}.edit` as Permission);
}

function store() {
  const s = fileStoreOf(getRepo());
  if (!s) throw new HttpError(404, "File not found");
  return s;
}

/**
 * Streams a photo or voice note to someone allowed to see the record it belongs to.
 * Phones ask for audio in slices; only the slice asked for is read from the database.
 */
export const GET = route<{ id: string }>("signed-in", async ({ req, params, session }) => {
  const s = store();
  const meta = await s.getFileMeta(params.id);
  if (!meta || !mayView(meta, session)) throw new HttpError(404, "File not found");
  const size = meta.size;
  const headers: Record<string, string> = {
    "Content-Type": meta.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    // PDFs download to the phone's own viewer; photos and audio play in the page.
    "Content-Disposition": meta.kind === "document" ? `attachment; filename="${meta.id}.pdf"` : `inline; filename="${meta.id}"`,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
  };
  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  const f = await s.getFile(params.id, range ?? undefined);
  if (!f) throw new HttpError(404, "File not found");
  if (range) return new Response(new Uint8Array(f.bytes), { status: 206, headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(f.bytes.length) } });
  return new Response(new Uint8Array(f.bytes), { status: 200, headers: { ...headers, "Content-Length": String(f.bytes.length) } });
});

const Patch = z.object({ archived: z.boolean() });

/** Removing a photo or voice note archives it; nothing is hard-deleted. */
export const PATCH = route<{ id: string }>("signed-in", async ({ req, params, session }) => {
  const { archived } = Patch.parse(await req.json());
  const s = store();
  const meta = await s.getFileMeta(params.id);
  if (!meta || !mayView(meta, session)) throw new HttpError(404, "File not found");
  const f = { meta };
  if (!mayEdit(f.meta, session)) throw new HttpError(403, "You don't have permission to do that");
  const after = await s.setFileArchived(params.id, archived);
  audit(session, { action: `${f.meta.entity.replace(/s$/, "")}.${f.meta.kind}.${archived ? "remove" : "restore"}`, entity: f.meta.entity, recordId: f.meta.recordId, summary: `${archived ? "Removed" : "Restored"} ${f.meta.name}` });
  return { file: after };
});
