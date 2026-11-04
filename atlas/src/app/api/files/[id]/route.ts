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

/** Streams a photo or voice note to someone allowed to see the record it belongs to. */
export const GET = route<{ id: string }>("signed-in", async ({ req, params, session }) => {
  const f = await store().getFile(params.id);
  if (!f || !mayView(f.meta, session)) throw new HttpError(404, "File not found");
  const size = f.bytes.length;
  const headers: Record<string, string> = {
    "Content-Type": f.meta.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    // PDFs download to the phone's own viewer; photos and audio play in the page.
    "Content-Disposition": f.meta.kind === "document" ? `attachment; filename="${f.meta.id}.pdf"` : `inline; filename="${f.meta.id}"`,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
  };
  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  if (range) {
    const part = f.bytes.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(part), { status: 206, headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(part.length) } });
  }
  return new Response(new Uint8Array(f.bytes), { status: 200, headers: { ...headers, "Content-Length": String(size) } });
});

const Patch = z.object({ archived: z.boolean() });

/** Removing a photo or voice note archives it; nothing is hard-deleted. */
export const PATCH = route<{ id: string }>("signed-in", async ({ req, params, session }) => {
  const { archived } = Patch.parse(await req.json());
  const s = store();
  const f = await s.getFile(params.id);
  if (!f || !mayView(f.meta, session)) throw new HttpError(404, "File not found");
  if (!mayEdit(f.meta, session)) throw new HttpError(403, "You don't have permission to do that");
  const after = await s.setFileArchived(params.id, archived);
  audit(session, { action: `${f.meta.entity.replace(/s$/, "")}.${f.meta.kind}.${archived ? "remove" : "restore"}`, entity: f.meta.entity, recordId: f.meta.recordId, summary: `${archived ? "Removed" : "Restored"} ${f.meta.name}` });
  return { file: after };
});
