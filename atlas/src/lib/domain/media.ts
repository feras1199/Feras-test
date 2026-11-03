import type { FileKind } from "../data/repository";

/** Photos are shrunk on the phone before upload, so 8 MB is generous. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
/** About 30 minutes of speech at the bitrate the recorder asks for. */
export const MAX_VOICE_BYTES = 12 * 1024 * 1024;
export const MAX_VOICE_SECONDS = 15 * 60;

/**
 * Works out the real type from the file's first bytes, so ATLAS only ever
 * stores and serves images and audio, whatever the upload claims to be.
 */
export function sniffMedia(b: Uint8Array): { kind: FileKind; mime: string } | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, j) => b[i + j] === x);
  const ascii = (i: number, s: string) => at(i, ...Array.from(s, (c) => c.charCodeAt(0)));
  if (b.length < 12) return null;
  if (at(0, 0xff, 0xd8, 0xff)) return { kind: "photo", mime: "image/jpeg" };
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: "photo", mime: "image/png" };
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return { kind: "photo", mime: "image/webp" };
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return { kind: "voice", mime: "audio/webm" };
  if (ascii(0, "OggS")) return { kind: "voice", mime: "audio/ogg" };
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    // iPhone voice recordings are MP4/M4A audio. HEIC/AVIF photos use the same box,
    // but the phone converts photos to JPEG before upload, so those are refused here.
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1|avif|avis)$/.test(brand)) return null;
    return { kind: "voice", mime: "audio/mp4" };
  }
  if (ascii(0, "ID3") || at(0, 0xff, 0xfb) || at(0, 0xff, 0xf3)) return { kind: "voice", mime: "audio/mpeg" };
  if (at(0, 0xff, 0xf1) || at(0, 0xff, 0xf9)) return { kind: "voice", mime: "audio/aac" };
  return null;
}

/** Parses a single "bytes=a-b" range. Safari needs these answered to play audio. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number, end: number;
  if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

/** PDFs shared in Ask ATLAS (quotes, plans, emails saved as PDF). Kept well under the AI's request limit. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** What Ask ATLAS accepts: PDFs plus the same photos and recordings as site visits. */
export function sniffAttachment(b: Uint8Array): { kind: FileKind; mime: string } | null {
  if (b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-") return { kind: "document", mime: "application/pdf" };
  return sniffMedia(b);
}

export function maxBytesFor(kind: FileKind): number {
  return kind === "photo" ? MAX_PHOTO_BYTES : kind === "voice" ? MAX_VOICE_BYTES : MAX_DOCUMENT_BYTES;
}
