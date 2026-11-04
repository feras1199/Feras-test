import { describe, expect, it } from "vitest";
import { parseRange, sniffMedia } from "@/lib/domain/media";

const bytes = (...parts: (number[] | string)[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === "string" ? Array.from(p, (c) => c.charCodeAt(0)) : p));
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
};

describe("sniffMedia", () => {
  it("recognises photos and voice recordings by their first bytes", () => {
    expect(sniffMedia(bytes([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ kind: "photo", mime: "image/jpeg" });
    expect(sniffMedia(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ kind: "photo", mime: "image/png" });
    expect(sniffMedia(bytes("RIFF", [1, 2, 3, 4], "WEBP"))).toEqual({ kind: "photo", mime: "image/webp" });
    expect(sniffMedia(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toEqual({ kind: "voice", mime: "audio/webm" });
    expect(sniffMedia(bytes([0, 0, 0, 0x1c], "ftypiso5"))).toEqual({ kind: "voice", mime: "audio/mp4" });
    expect(sniffMedia(bytes([0, 0, 0, 0x1c], "ftypM4A "))).toEqual({ kind: "voice", mime: "audio/mp4" });
    expect(sniffMedia(bytes("OggS"))).toEqual({ kind: "voice", mime: "audio/ogg" });
  });
  it("refuses anything else, whatever it claims to be", () => {
    expect(sniffMedia(bytes("<html><script>"))).toBeNull();
    expect(sniffMedia(bytes("<svg xmlns="))).toBeNull();
    expect(sniffMedia(bytes("%PDF-1.7"))).toBeNull();
    expect(sniffMedia(bytes([0, 0, 0, 0x18], "ftypheic"))).toBeNull();
    expect(sniffMedia(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("parseRange", () => {
  it("answers the ranges Safari asks for when playing audio", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-1", 100)).toEqual({ start: 0, end: 1 });
    expect(parseRange("bytes=10-", 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange("bytes=-20", 100)).toEqual({ start: 80, end: 99 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=5-2", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBe("invalid");
  });
});
