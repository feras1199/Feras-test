#!/usr/bin/env node
/**
 * Puts photos and recordings from an ATLAS files download back into a database.
 *
 *   DATABASE_URL=postgres://… node scripts/restore-files.mjs atlas-files-2026-11-10.tar
 *
 * Import the records backup (.json) through Settings > Backup and import first, so
 * the records these files belong to exist. Files already in the database are left
 * alone, so running this twice is safe.
 */
import fs from "node:fs";
import pg from "pg";

const [file] = process.argv.slice(2);
if (!file || !process.env.DATABASE_URL) {
  console.error("Usage: DATABASE_URL=postgres://… node scripts/restore-files.mjs <atlas-files.tar>");
  process.exit(1);
}

const buf = fs.readFileSync(file);
const entries = new Map();
for (let o = 0; o + 512 <= buf.length; ) {
  const name = buf.subarray(o, o + 100).toString("utf8").replace(/\0.*$/, "");
  if (!name) break;
  const size = parseInt(buf.subarray(o + 124, o + 136).toString("utf8").replace(/\0.*$/, "").trim(), 8) || 0;
  entries.set(name, buf.subarray(o + 512, o + 512 + size));
  o += 512 + size + ((512 - (size % 512)) % 512);
}
const manifestBytes = entries.get("manifest.json");
if (!manifestBytes) throw new Error("This isn't an ATLAS files download: no manifest.json inside");
const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (manifest.format !== "atlas-files") throw new Error("This isn't an ATLAS files download");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let added = 0, kept = 0, missing = 0;
try {
  for (const f of manifest.files) {
    const bytes = entries.get(f.path);
    if (!bytes) { missing++; continue; }
    const r = await pool.query(
      "INSERT INTO atlas_files (id, entity, record_id, kind, mime, name, size, duration_s, created_by, created_time, archived, transcript, bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING",
      [f.id, f.entity, f.recordId, f.kind, f.mime, f.name, bytes.length, f.durationS ?? null, f.createdBy, f.createdTime, !!f.archived, f.transcript ?? null, bytes],
    );
    if (r.rowCount) added++; else kept++;
  }
} finally {
  await pool.end();
}
console.log(`Files restored: ${added} added, ${kept} already there and kept, ${missing} listed but not in the archive.`);
