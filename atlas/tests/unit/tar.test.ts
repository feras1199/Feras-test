import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archiveName, readTar, TAR_END, tarHeader, tarPadding } from "@/lib/domain/tar";

function build(files: { name: string; bytes: Uint8Array }[]) {
  const parts: Uint8Array[] = [];
  for (const f of files) parts.push(tarHeader(f.name, f.bytes.length, new Date("2026-11-10T00:00:00Z")), f.bytes, tarPadding(f.bytes.length));
  parts.push(TAR_END);
  return Buffer.concat(parts);
}

describe("files archive", () => {
  const files = [
    { name: "manifest.json", bytes: new TextEncoder().encode('{"format":"atlas-files"}') },
    { name: archiveName({ id: "filDemo0000000001", mime: "image/jpeg" }), bytes: Uint8Array.from({ length: 1300 }, (_, i) => i % 256) },
    { name: archiveName({ id: "filDemo0000000002", mime: "audio/mp4" }), bytes: new Uint8Array(512) },
  ];

  it("reads back exactly what was written", () => {
    const back = readTar(build(files));
    expect(back.map((f) => f.name)).toEqual(["manifest.json", "files/filDemo0000000001.jpg", "files/filDemo0000000002.m4a"]);
    expect(Buffer.compare(Buffer.from(back[1]!.bytes), Buffer.from(files[1]!.bytes))).toBe(0);
  });

  it("opens with the standard tar program", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-tar-"));
    const file = path.join(dir, "a.tar");
    fs.writeFileSync(file, build(files));
    const listed = execFileSync("tar", ["-tf", file], { encoding: "utf8" }).trim().split("\n");
    expect(listed).toEqual(["manifest.json", "files/filDemo0000000001.jpg", "files/filDemo0000000002.m4a"]);
    execFileSync("tar", ["-xf", file, "-C", dir]);
    expect(fs.readFileSync(path.join(dir, "files/filDemo0000000001.jpg")).length).toBe(1300);
    fs.rmSync(dir, { recursive: true });
  });
});
