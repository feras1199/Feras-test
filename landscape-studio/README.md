# Landscape Intelligence Studio

A working site-to-quote tool for a Sydney landscaping business: capture a site, draw it to scale, design walls, paving and gardens, get transparent quantities and a costed estimate, check NSW planning and engineering triggers, and export crew drawings and material schedules.

Everything is calculated by deterministic code from one geometry model. Changing a wall length or a material updates quantities, purchase rounding, labour, the estimate, the compliance checks and every exported document.

Status: **local development build**, tested in this repository. Not deployed anywhere public.

## Quick start

Requirements: Node.js 22.18 or newer (uses built-in `node:sqlite` and TypeScript type stripping). No database server, no Docker.

```bash
cd landscape-studio
npm install
npm run build          # type-check + build the web app into dist/
npm run server         # serves app + API on http://localhost:8787
```

Open http://localhost:8787, then **Open demo project** on the Dashboard to see a complete worked example (synthetic data, labelled as such everywhere).

Development with hot reload (two terminals):

```bash
npm run server         # API on :8787
npm run dev            # Vite on :5173, proxies /api to :8787
```

Browser-only mode: if the app is served without the Node server (for example `dist/` on any static host), it detects that and stores projects in the browser's IndexedDB. AI, Airtable and login are unavailable in that mode; everything else works.

## Tests

```bash
npm test                       # 25 unit tests: geometry, quantities, purchase rounding, pricing formulas, compliance, exports
npm run server &               # then, in another terminal:
npm run e2e                    # 16 browser checks against the running app (Playwright + Chromium)
```

Test outputs (PDF packs, SVG sheets, DXF, CSVs, screenshots, `results.json`) are written to `test-output/`.

## Configuration (all optional)

| Variable | Purpose |
|---|---|
| `PORT` | Server port, default 8787 |
| `LIS_DATA_DIR` | Where the SQLite file and uploaded media live, default `./data` |
| `LIS_AUTH=on` | Require sign-in. Create users with `npm run user:add -- <name> <owner\|estimator\|crew\|reviewer> <password>` |
| `ANTHROPIC_API_KEY` | Enables live AI photo analysis and free-form design instructions. Key stays on the server |
| `LIS_AI_MODEL` | Model id, default `claude-sonnet-5-5` |
| `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID` | Enables "Sync to Airtable" (customer + project summary only) |
| `AIRTABLE_CUSTOMERS_TABLE`, `AIRTABLE_PROJECTS_TABLE` | Table names, default `Customers` and `Projects`. Fields written: Name, Phone, Email, LIS Customer ID; Name, Site Address, Council, Status, LIS Project ID, Customer (link) |

Backups: copy `LIS_DATA_DIR` (one SQLite file plus a `media/` folder). Each project can also be exported as a `.lis.json` file from Documents and re-imported from the Dashboard.

## Workflow in the app

1. **Dashboard**: New site, or open the demo.
2. **Project**: customer, address, council, site attributes (heritage, flood, easements) that feed the NSW checks, brief and budget.
3. **Site Capture**: photos (location metadata stripped), plans and scan files; tag features on photos; record measurements with method, source, date and confidence. The app lists the smallest set of measurements still needed, with a diagram of where to measure.
4. **Site Drawing**: scaled 2D editor in metres. Rectangles, polygons, polylines, arcs, points; select, move, rotate, resize by typed dimensions, duplicate, lock, hide, undo/redo, snapping, layers, aerial/plan underlay with two-point calibration, basic 3D massing view. The inspector shows each object's quantities and cost live.
5. **Design Studio**: Economy / Balanced / Premium alternatives on the same layout, costed by the same engine; a command assistant ("make this design $2,000 cheaper", "replace the wall with sandstone") that shows the price impact and needs approval; design versions.
6. **Construction Details**: NSW screening checks with sources, concept wall and paving sections, measurement sign-off, engineering approvals (reviewer role only), project status gate, audit trail.
7. **Cost Estimator**: internal estimate, customer view, materials-only, labour-only, quantities with formulas and manual overrides, alternative comparison, editable rates and margins.
8. **Procurement**: purchase list by supplier after waste, conversion and pack rounding; supplier comparison; order request CSVs; order status.
9. **Documents**: A3/A4 PDF drawing pack, customer estimate PDF, BoQ and schedule CSV, DXF, SVG/PNG sheets, project file.
10. **Project Performance**: actual costs and hours against the estimate, with a suggested productivity adjustment.

## Repository layout

```
src/core/        deterministic engine: geometry, quantities, units, estimate, compliance, validation, ops, exports
src/ui/          React pages and components
src/store/       state store, server/browser storage adapters
server/          Express API, SQLite schema, AI and Airtable adapters, user admin
tests/           unit tests (Vitest)
e2e/             browser tests (Playwright)
docs/            research, verification, feature matrix, architecture, operating costs
```

See `docs/` for the research report, verification table, feature-completeness matrix, architecture and operating requirements.
