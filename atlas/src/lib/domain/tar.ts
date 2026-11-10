/**
 * The smallest useful writer for .tar archives (ustar), so the owner can download
 * every photo and recording as one file that any computer can open. No compression:
 * photos and audio are already compressed.
 */
const BLOCK = 512;

function field(buf: Uint8Array, offset: number, length: number, text: string) {
  const bytes = new TextEncoder().encode(text);
  buf.set(bytes.subarray(0, length), offset);
}

/** The 512-byte header that goes in front of each file. Names are kept to 100 plain characters. */
export function tarHeader(name: string, size: number, modified: Date): Uint8Array {
  const h = new Uint8Array(BLOCK);
  const safe = name.replace(/[^\x20-\x7e]/g, "_").slice(0, 100);
  const octal = (n: number, len: number) => n.toString(8).padStart(len - 1, "0") + "\0";
  field(h, 0, 100, safe);
  field(h, 100, 8, octal(0o644, 8));
  field(h, 108, 8, octal(0, 8));
  field(h, 116, 8, octal(0, 8));
  field(h, 124, 12, octal(size, 12));
  field(h, 136, 12, octal(Math.floor(modified.getTime() / 1000), 12));
  field(h, 148, 8, "        "); // checksum is worked out with this field as spaces
  field(h, 156, 1, "0");
  field(h, 257, 6, "ustar\0");
  field(h, 263, 2, "00");
  let sum = 0;
  for (const b of h) sum += b;
  field(h, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  return h;
}

/** Zero bytes that round a file up to the next 512-byte block. */
export function tarPadding(size: number): Uint8Array {
  return new Uint8Array((BLOCK - (size % BLOCK)) % BLOCK);
}

/** Two empty blocks mark the end of the archive. */
export const TAR_END = new Uint8Array(BLOCK * 2);

/** Reads an archive made by the functions above back into its files. */
export function readTar(buf: Uint8Array): { name: string; bytes: Uint8Array }[] {
  const out: { name: string; bytes: Uint8Array }[] = [];
  const text = (o: number, len: number) => new TextDecoder().decode(buf.subarray(o, o + len)).replace(/\0.*$/, "");
  for (let o = 0; o + BLOCK <= buf.length; ) {
    const name = text(o, 100);
    if (!name) break;
    const size = parseInt(text(o + 124, 12).trim(), 8) || 0;
    out.push({ name, bytes: buf.subarray(o + BLOCK, o + BLOCK + size) });
    o += BLOCK + size + ((BLOCK - (size % BLOCK)) % BLOCK);
  }
  return out;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/aac": "aac", "application/pdf": "pdf" };
/** The name a stored file gets inside the archive: its id plus the right ending. */
export function archiveName(f: { id: string; mime: string }): string {
  return `files/${f.id}.${EXT[f.mime] ?? "bin"}`;
}
