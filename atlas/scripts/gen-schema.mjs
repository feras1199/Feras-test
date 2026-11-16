// Regenerates src/lib/data/airtable/schema.generated.ts from the live base.
// Usage: AIRTABLE_TOKEN=... AIRTABLE_BASE_ID=... node scripts/gen-schema.mjs
import { writeFileSync } from "node:fs";
const token = process.env.AIRTABLE_TOKEN;
const base = process.env.AIRTABLE_BASE_ID ?? "appygHLmJTH1ew5r6";
if (!token) { console.error("AIRTABLE_TOKEN is required"); process.exit(1); }
const res = await fetch(`https://api.airtable.com/v0/meta/bases/${base}/tables`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) { console.error(`Airtable ${res.status}: ${await res.text()}`); process.exit(1); }
const { tables } = await res.json();
const snap = { baseId: base, capturedAt: new Date().toISOString().slice(0, 10), tables: tables.map((t) => ({ id: t.id, name: t.name, fields: t.fields.map((f) => ({ id: f.id, name: f.name, type: f.type })) })) };
writeFileSync("docs/airtable-schema-snapshot.json", JSON.stringify(snap, null, 1));
const out = ["// Generated from docs/airtable-schema-snapshot.json. Do not edit by hand.", "// Regenerate with: node scripts/gen-schema.mjs", "export const AIRTABLE_SCHEMA = {"];
for (const t of snap.tables) {
  out.push(`  ${JSON.stringify(t.name)}: { id: ${JSON.stringify(t.id)}, fields: {`);
  for (const f of t.fields) out.push(`    ${JSON.stringify(f.name)}: { id: ${JSON.stringify(f.id)}, type: ${JSON.stringify(f.type)} },`);
  out.push("  } },");
}
out.push("} as const;\n\nexport type AirtableTableName = keyof typeof AIRTABLE_SCHEMA;\n");
writeFileSync("src/lib/data/airtable/schema.generated.ts", out.join("\n"));
console.log(`Wrote ${snap.tables.length} tables`);
