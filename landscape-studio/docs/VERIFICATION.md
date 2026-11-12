# Verification report

Run on 12 November 2026 in the build container (Linux, Node 22.23, Chromium via Playwright). Re-run with `npm test` and `npm run e2e` (server running). Evidence files are written to `test-output/`.

Unit = `tests/*.test.ts` (Vitest, 25 tests). E2E = `e2e/run.mjs` (Playwright driving the built app against the real server and SQLite database, 16 checks). Manual = scripted one-off check described in the row.

| # | Feature | Test procedure | Expected | Actual | Result | Evidence | Known limitation |
|---|---|---|---|---|---|---|---|
| 21.1 | Navigation | E2E: click all 13 main navigation items with a project open | Every page renders content | 13/13 rendered | PASS | e2e results.json | Text-presence check, not visual review of each page |
| 21.2 | Persistence | E2E: create project, enter customer, wait for "Saved", reload browser | Data survives reload | Customer name present after reload (server SQLite) | PASS | e2e | Browser-only mode (IndexedDB) not covered by E2E |
| 21.3 | Rectangle area | Unit + E2E: draw paving, type 5 × 4 m, then 6 × 4 m | 20 m² → 24 m²; quantities follow | Area 20 → 24 m²; pavers incl. 5% waste 21 → 25.2 m²; base 2.4 m³ at 24 m² | PASS | unit `21.3`; e2e screenshot drawing-paving.png | |
| 21.4 | Retaining wall | Unit + E2E: draw wall, set 10 m, height 0.6; then 12 m | Face 6 m² → 7.2 m²; materials and estimate recalc | Face 6 → 7.2 m²; sleepers 15 → 18; posts 6 → 7; drainage agg 2.16 m³ net; price rose ($12,544 → $13,348 in E2E run) | PASS | unit `21.4`; e2e | Post count assumes one post per bay + 1; post size never designed |
| 21.5 | Procurement maths | Unit: 37.4 m² paver area with 5% waste; pack 50; min order 300; m³→t with and without density; rolls; consolidation of the same product across objects | 246 ea; 250; 300; null without density; 4.0 t; 1 roll; 2 rolls for 22 m | All as expected | PASS | unit `21.5` | Supplier-specific rules (e.g. part-pallet surcharges) not modelled |
| 21.6 | Pricing formulas | Unit: worked example with known inputs; markup vs margin functions; GST | Matches hand calculation to the cent | Exact; 25% markup = 20% margin; 20% margin = 1250 on 1000 cost | PASS | unit `21.6` | Rates are user assumptions |
| 21.6b | Unpriced items | Unit: catalogue item with no price | Excluded and flagged, never guessed | Flagged "No price for …" | PASS | unit | |
| 21.6c | Price assumptions | Unit: project allowance for unpriced item | Included, labelled "assumption", catalogue untouched | As expected | PASS | unit | |
| 21.7 | PDF drawing pack | Unit (A3 and A4) + E2E download | Valid PDF; project name/id; dimensions match geometry; materials named; scale statement; status stamp on every sheet; nothing off the sheet | 10 sheets A3 / 11 A4; `%PDF` header and EOF; 7.00 / 3.00 verified dims and ~10.0 estimated wall shown; drawn width = 12 m ÷ stated scale; NOT FOR CONSTRUCTION on every sheet; all primitives inside 8 mm margin | PASS | test-output/demo-pack-A3.pdf, demo-pack-A4.pdf, SVG sheets; visually inspected | Text width is estimated for the margin test; long text is wrapped/truncated rather than measured exactly |
| 21.7b | Other exports | Unit + E2E | BoQ CSV, schedule CSV, estimate CSV, DXF, customer estimate PDF download and contain model data | All produced; DXF has layers and EOF | PASS | test-output/e2e/* | DXF not opened in a CAD package in this environment |
| 21.8 | AI analysis | E2E: "Analyse with AI" with no key; "Simulated analysis" | Clear not-configured message; simulated result labelled SIMULATED | As expected | PASS (offline path) | e2e capture.png | **Live AI call not tested: no API key available in this environment** |
| 21.9 | Mobile | E2E: 390 × 844 touch viewport, open menu and visit 12 pages | No horizontal overflow; menu works | 0 px overflow on all 12 | PASS | mobile-*.png | Drawing on a phone is usable but cramped; tested by script, not on a real device |
| 21.9b | Desktop | E2E at 1440 × 900 | All flows work | Covered by all other E2E checks | PASS | | |
| 21.10a | Invalid dimensions | E2E: −3 and "abc" in width | Rejected with message; geometry unchanged | "Must be at least 0.01", "Enter a number"; area unchanged | PASS | e2e | |
| 21.10b | Unsupported / empty / corrupt files | E2E: .exe, 0-byte PNG, fake JPEG | Each rejected with a specific reason; valid JPEG accepted | 3 rejected with reasons, 1 accepted | PASS | e2e | HEIC rejected with instructions rather than converted |
| 21.10c | Missing file | E2E (API): fetch nonexistent media | 404, UI shows "File missing" | 404 | PASS | e2e | |
| 21.10d | Missing AI credentials | see 21.8 | | | PASS | | |
| 21.10e | Supplier API failure | n/a | | | NOT APPLICABLE | | No supplier API is integrated; prices are manual/CSV |
| 21.10f | Interrupted upload | E2E: abort media PUT | Error shown; file not listed as saved | "upload interrupted" shown; not listed | PASS | e2e | |
| 21.10g | Empty project | E2E | Helpful empty states on Estimate, Documents, Design | Shown | PASS | e2e | |
| 21.10h | Missing prices | Unit + E2E | Estimate marked incomplete | Banner "Estimate incomplete" | PASS | e2e estimate.png | |
| 21.10i | Conflicting measurements | Unit + E2E: verified 6.2 m vs drawn 6.0 m | Flagged, not auto-corrected; user can apply explicitly | Flagged with 200 mm difference; "Apply to drawing" resolved it | PASS | e2e | |
| 21.10j | Server unreachable on save | E2E: block project PUT | "Not saved" + Retry; recovers | As expected | PASS | e2e | |
| — | Server validation | E2E (API): NaN coordinates | 400 | 400 | PASS | e2e | |
| — | Material change | E2E: switch paving to sandstone | Object cost changes | $5,078 → $7,729 | PASS | e2e | |
| — | Assistant change gate | E2E: "make this design $2,000 cheaper" on demo, approve | Impact shown before applying; version saved | $28,018 → $25,509 inc GST shown, applied after approval, version listed | PASS | e2e design.png | Built-in parser only understands listed phrasings |
| — | Approval gate | E2E: owner tries to set "Approved" | Blocked | Blocked with message | PASS | e2e | Credentials typed by reviewer are not verified |
| — | Compliance rules | Unit: demo wall with slope surcharge; raise to 1.2 m | Engineering "potential issue"; exempt check never "verified"; >600 mm and >800 mm messages | As expected | PASS | unit | Only the encoded subset of rules |
| — | Sign-in and roles | Manual script: server with `LIS_AUTH=on`, crew user | 401 without login; wrong password rejected; login works; crew cannot delete | All as expected | PASS | session log | Not part of the automated suite (needs a second server) |
| — | Uncaught errors | E2E: console and page errors collected across the run | None | None | PASS | e2e | |

Totals: unit 25/25, E2E 16/16, manual auth script 4/4.

Not verified anywhere: live AI responses, live Airtable sync (no credentials), real-device mobile use, printing at scale on paper, opening the DXF in AutoCAD/QCAD.
