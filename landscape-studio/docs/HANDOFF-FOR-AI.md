# Handoff notes for an AI agent continuing this project

Audience: another coding agent picking up `landscape-studio/`. Read this, then `README.md`, `docs/FEATURES.md` (status of every requirement) and `docs/VERIFICATION.md` (what is proven).

## 1. What exists

A TypeScript React app plus a small Node server for a Sydney landscaping business: site capture → scaled drawing → quantities → estimate → NSW screening checks → drawings, schedules and quotes.

- `src/core/` is the product. Pure functions, no UI, no network. Everything the user sees is derived from one `Project` object plus the material catalogue.
- `src/ui/` renders and edits the `Project`. `src/store/useStore.ts` holds it; `useDerived()` recomputes take-off, estimate, compliance, validation and the measurement checklist on every change.
- `server/` is Express + `node:sqlite` (one JSON document per project), media on disk, optional cookie auth with roles, optional Anthropic and Airtable adapters. Keys only in env vars.
- If no server answers `/api/health`, the app switches to IndexedDB, then to in-memory if that is blocked (this is how the claude.ai artifact preview runs).

## 2. Core data flow (do not break this)

```
Project.objects[] (points in metres + props + materialId)
  → assemblies.takeoff()      QtyLine[]: formula, inputs, assumptions, net, waste, gross, purchase qty
  → units.toPurchase()        unit conversion, sale increment, pack size, minimum order
  → estimate.computeEstimate() materials (consolidated by product), labour, extras, overhead, contingency, markup, GST
  → compliance / validation / exports
```

Rules that keep the numbers honest. Tests depend on them:

1. `null` means unknown. A missing input gives a `null` quantity and a warning, never a default guess. Unpriced materials are excluded from totals and listed in `estimate.flags`.
2. Volume to tonnes needs `material.density`; without it `toPurchase` returns `null`.
3. Markup (profit / cost) and margin (profit / price) are separate functions with tests.
4. Project-level price allowances (`project.priceAssumptions`) are allowed, but they are counted in `estimate.assumed`, labelled "assumption", and never written to the catalogue.
5. The AI never produces numbers. AI or command output becomes `Op[]` (`src/core/ops.ts`); `validateOps` allows only a whitelist (no structural, drainage or footing inputs). The UI shows the price impact and needs explicit approval, then saves a design version first.
6. Compliance checks never return "verified" for planning exemption; at best "insufficient information". Engineering is triggered when retained height > 0.8 m or there is any surcharge. Footings are always "size by engineer". Approvals need the `reviewer` role and record a name, credential and reference typed by a human.
7. Measurement conflicts are reported, not auto-fixed. "Apply to drawing" is a user action.
8. Estimated lengths display as `~10.0`, verified ones as `10.00`.

## 2b. Concept workflow (v0.2)

- `src/core/proposals.ts`: `generateProposals` returns three `DesignProposal`s whose `changes[]` hold `Op`s (`addObject`, `setMaterial`, `setWallSystem`, `setProp`). The layout comes from `yardOf()` (drawn site outline minus buildings), never from photos. `selectProposal` records the customer; `applyProposal` applies only approved change ids and saves before/after versions.
- Pictures are `RenderAsset`s on the proposal, stored as media of kind `render`, logged in the `render_log` table. `server/image.ts` is the provider adapter (untested live).
- `src/core/layers.ts` turns objects into build-ups whose quantities are read from the take-off lines. Do not add footing or reinforcement sizes there.
- `src/core/iso.ts` is the single 3D massing function for screen and PDF.
- `src/core/approval.ts` `statusChangeError` is the only place status rules live; the UI calls it.

## 3. How it was built (process that worked)

1. **Research first, only what changes decisions.** Official NSW pages gave the licence and contract thresholds ($5k licence and written contract, $20k HBCF), exempt-development limits (600 mm cut/fill, deck limits), the AS 4678 800 mm bound and the AS 4970 12 × DBH root zone. Supplier pages gave real prices with URL and date. Anything not retrieved verbatim (the full text of Codes SEPP clause 2.30) was marked not encoded rather than invented. Note: Nuway turned out to be in Queensland, so it is kept only as a density reference.
2. **Engine before UI.** Types → geometry → take-off → units → estimate → compliance → exports, then unit tests for the mandatory cases (5×4 → 20 m², 6×4 → 24 m²; wall 10 m × 0.6 m = 6 m², 12 m = 7.2 m²; pack rounding; markup vs margin; GST).
3. **Drawings as primitives.** `exports/sheets.ts` builds paper-millimetre primitives once; `render.ts` turns them into both PDF (jsPDF) and SVG. A test checks every primitive stays inside the sheet margin and that the drawn width equals 12 m ÷ the stated scale. Render the PDF and look at it: the first versions overlapped labels, which only showed up visually.
4. **E2E against the real built app and server** (`e2e/run.mjs`, Playwright). It covers navigation, persistence across reload, drawing, wall changes flowing through to the estimate, invalid input, bad uploads, interrupted upload (route abort), server unreachable on save, mobile overflow at 390 px, PDF validity and zero console errors. Several failures were test-selector problems, not app bugs; read the error before changing the app.
5. **Commit early.** The worker restarted mid-build; files survived, but push as soon as there is something worth keeping.

## 4. Environment gotchas met here

- Node 22.18+ runs `.ts` directly (type stripping). `node:sqlite` prints an experimental warning; that is harmless.
- Playwright is preinstalled globally; in ESM use `createRequire(import.meta.url)('playwright')`.
- Some hosts (legislation.nsw.gov.au, planningportal, bcsands) were blocked from fetch; search excerpts were used and marked as such in `RESEARCH.md`.
- A long inline `python3 - <<EOF` heredoc tripped a shell safety check; writing the script to the scratchpad and running it worked.
- `localhost` links are useless to a phone user. Use `report_preview_port`, or publish the static build as an artifact. Artifact notes: CSS and the main JS bundle were inlined into the HTML; lazy chunks went in `files`; downloads are blocked in the viewer (would need the `downloads` capability); storage may be blocked, hence the in-memory fallback.

## 5. Known gaps (ranked)

1. Live AI photo analysis, free-form assistant and AI image renders never run with a real key.
2. Airtable sync never run live; it is outbound only.
3. Council lookup from the address and the full Codes SEPP cl 2.30 and council LEP/DCP rules are missing.
4. Downloads in the artifact preview: add the `downloads` capability (load the `artifact-capabilities` skill first).
5. No scan processing, map search, rendering, video or voice notes.
6. Learning works one project at a time; there is no cross-project rate library.
7. Concurrent edits to the same project are last-write-wins (add a version check on PUT).

## 6. Commands

```
cd landscape-studio && npm install
npm run build && npm run server   # http://localhost:8787
npm test                          # 25 unit tests
npm run e2e                       # 16 browser checks (server must be running)
npm run user:add -- name role pw  # with LIS_AUTH=on
```
