# Architecture

```
Browser (React + TypeScript, Vite build)
 ├─ src/core/*        pure, deterministic engine (no UI, no network) ── shared with tests and server
 │   types → geometry → assemblies (take-off) → units (purchase rounding) → estimate
 │   compliance · validation (geometry + measurement checks, guided measurements) · ops (approved changes)
 │   alternatives · sequence · exports (sheets → PDF/SVG, CSV, DXF, quote PDF)
 ├─ src/store         Zustand store; one Project object is the source of truth; useDerived() recomputes all outputs
 └─ storage adapter   ServerStorage (/api) or LocalStorage (IndexedDB) chosen at start-up

Node server (Express, node:sqlite)
 ├─ projects (JSON document per project + indexed summary columns), project_history, kv (catalogue, settings), users
 ├─ media files on disk per project
 ├─ ai.ts       provider adapter (Anthropic implemented). Key server-side only
 └─ airtable.ts optional outbound sync
```

## Key decisions

- **One geometry model, derived everything.** Objects store points in metres plus typed parameters. Quantities, costs, drawings, compliance and exports are pure functions of the project + catalogue, recomputed on every change. There are no stored copies of derived numbers to drift out of sync.
- **Deterministic engine, AI at the edge.** AI can tag photo features (unconfirmed) and propose operations from a fixed vocabulary. `validateOps` rejects anything outside it (including structural, drainage and footing inputs), and the user sees the price impact before approving. The model never produces a quantity or price.
- **Honest unknowns.** `null` means unknown throughout. Missing dimensions produce "unknown" quantities, missing prices are excluded and flagged, volume-to-mass needs an explicit density, estimated lengths print as `~10.0`.
- **Document-per-project storage.** A project is one JSON document in SQLite. This keeps geometry, measurements and audit together, makes export/import trivial and avoids forcing CAD data into relational or Airtable fields. Summary columns support listing. Trade-off: no cross-project SQL queries over objects; fine at a small company's scale.
- **SQLite over Postgres/PostGIS.** Zero-ops single file, adequate for one company. PostGIS would only pay off with real cadastral/GIS layers, which are not used.
- **SVG for the editor, primitives for drawings.** The editor is plain SVG with pointer events (no canvas library). Drawing sheets are built as paper-millimetre primitives once and rendered to both PDF (jsPDF) and SVG, so print and preview match.
- **Airtable stays the CRM.** Only customer and project summary fields sync out, keyed by stored record ids.

## Data model (summary)

`Project { customer, site, brief, status, objects[], measurements[], media[], underlay?, versions[], estimate settings, overrides[], approvals[], priceAssumptions?, procurement[], actuals[], progress[], audit[] }`

`SiteObject { id, type, layer: existing|proposed, points[], props, materialId, confidence, locked, hidden }`

`Material { id, unit, price|null, priceStatus, verifiedDate, sourceUrl, dims, density, packSize, minOrder, increment, group, … }`

## Security notes

- API keys only in server environment variables.
- Optional cookie sessions (HttpOnly, SameSite=Strict, scrypt password hashes). Crew role is limited server-side to notes and progress.
- IDs validated before touching the filesystem; uploads size-limited; photos re-encoded in the browser (strips EXIF/GPS).
- Without `LIS_AUTH=on` the server trusts anyone who can reach it: run it on a private network or behind a reverse proxy with TLS.

## Next development priorities

1. Live-test and harden the AI photo analysis and free-form assistant with a real key.
2. Council lookup from address (NSW Planning Portal / spatial services APIs, subject to terms) and encoding the full Codes SEPP clause 2.30 standards with versioning.
3. Cross-project rate library from completed jobs (median productivity by activity and access class).
4. Supplier price import templates per supplier and quote-upload parsing.
5. Better phone capture: native or PWA camera flow, offline queue for uploads.
6. Terrain/levels model for cut-and-fill and falls.
7. Plant database with Sydney suitability and invasive-species flags.
8. Multi-user editing safety (optimistic version check on save).
