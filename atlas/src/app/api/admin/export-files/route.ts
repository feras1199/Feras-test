import { HttpError, route } from "@/lib/server/api";
import { getRepo } from "@/lib/server/context";
import { audit } from "@/lib/server/audit";
import { fileStoreOf } from "@/lib/data/repository";
import { archiveName, TAR_END, tarHeader, tarPadding } from "@/lib/domain/tar";
import { todayIn } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * Owner-only download of every photo, recording and PDF ATLAS holds, as one .tar
 * file with a list (manifest.json) saying which record each belongs to. Files are
 * read from the database and sent one at a time, so memory use stays small.
 */
export const GET = route("settings.edit", async ({ session }) => {
  const store = fileStoreOf(getRepo());
  if (!store) throw new HttpError(409, "There are no stored files in this mode.");
  const files = await store.listAllFiles();
  const manifest = new TextEncoder().encode(JSON.stringify({ format: "atlas-files", version: 1, exportedAt: new Date().toISOString(), files: files.map((f) => ({ ...f, path: archiveName(f) })) }, null, 1));
  audit(session, { action: "data.export.files", summary: `Downloaded all photos and recordings (${files.length} files, ${Math.round(files.reduce((n, f) => n + f.size, 0) / 1024 / 1024)} MB)` });
  let i = -1;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i === -1) {
        controller.enqueue(tarHeader("manifest.json", manifest.length, new Date()));
        controller.enqueue(manifest);
        controller.enqueue(tarPadding(manifest.length));
        i = 0;
        return;
      }
      const meta = files[i++];
      if (!meta) {
        controller.enqueue(TAR_END);
        controller.close();
        return;
      }
      const f = await store.getFile(meta.id);
      if (!f) return; // archived rows are kept, so this only happens if a row vanished mid-download
      controller.enqueue(tarHeader(archiveName(meta), f.bytes.length, new Date(meta.createdTime)));
      controller.enqueue(new Uint8Array(f.bytes));
      controller.enqueue(tarPadding(f.bytes.length));
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-tar",
      "Content-Disposition": `attachment; filename="atlas-files-${todayIn()}.tar"`,
      "Cache-Control": "no-store",
    },
  });
});
