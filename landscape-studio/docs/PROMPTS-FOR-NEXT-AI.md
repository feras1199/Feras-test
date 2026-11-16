# Prompts for continuing this project with another AI

Copy the **Master prompt** first, in a new chat, with the project zip (or the GitHub branch) attached. Then paste one **Task prompt** at a time. Each task prompt is self-contained.

---

## Master prompt (paste first)

```
You are continuing an existing, working software project. Do not rebuild it or replace working parts with mock-ups. Read before you change anything.

PROJECT
Landscape Intelligence Studio: a web app for a Sydney landscaping contractor. It turns a site visit (before photos, quick yard size, measurements) into design ideas, three priced options (Economy / Balanced / Premium), a customer choice, and a buildable project: editable 2D plan, interactive 3D model, quantities, transparent estimate, build layers with crew instructions, NSW compliance prompts, procurement list and a PDF drawing pack.

WHERE THINGS ARE (folder landscape-studio/)
- README.md: setup and how to use it. Node 22.18+; `npm install`, `npm run build`, `npm run server` → http://localhost:8787.
- docs/HANDOFF-FOR-AI.md: architecture rules you must keep.
- docs/FEATURES.md: what is tested, partial or missing.  docs/VERIFICATION.md: test evidence.
- docs/CHANGELOG.md: history (v0.1 to v0.4).  docs/RESEARCH.md: NSW rules and Sydney supplier prices with sources.
- src/core/: the deterministic engine (no UI). Key files: types.ts, geometry.ts, assemblies.ts (quantity take-off), units.ts (purchase rounding), estimate.ts, compliance.ts, ideas.ts (six layout ideas), proposals.ts (Economy/Balanced/Premium), layers.ts (build layers), approval.ts (status gate), exports/ (PDF, SVG, CSV, DXF).
- src/ui/pages/: React screens. IdeasPanel.tsx and Concepts.tsx = photo → ideas → tiers → customer choice. Scene3D.tsx = three.js 3D model.
- server/: Express + node:sqlite, media storage, optional AI (Anthropic) and image (OpenAI) adapters, Airtable sync, migrations.
- tests/ (Vitest, 115 tests) and e2e/ (Playwright: run.mjs 25 checks, demo-tour.mjs, photo-tour.mjs).

RULES THAT MUST NOT BE BROKEN
1. One source of truth: geometry objects in metres → take-off → estimate → drawings → purchase list. Never store derived numbers separately.
2. Unknown stays unknown (null). Never guess a dimension, a price or a density. Unpriced items are excluded from totals and flagged.
3. AI and pictures never create geometry, measurements, boundaries, drainage design or engineering. AI may only propose whitelisted operations that the user approves (see validateOps in ops.ts).
4. Never size footings, posts, reinforcement, pergola structure, deck framing or drainage capacity. These always say "by engineer / manufacturer".
5. Only the "Authorised reviewer" role can approve or issue for construction, and only with no open technical blockers. Customer selection is not engineering, council, boundary, supplier, drainage or electrical approval.
6. Supplier prices: "verified" only with a source URL and date. Example allowances must stay labelled "EXAMPLE ALLOWANCE, not a quote".
7. Keep every visible label: "Illustrative concept only - not surveyed, not to scale, not for construction", "Conceptual 3D model ... not structural design", "NOT FOR CONSTRUCTION" on drawings.
8. Markup and margin are different (25% markup = 20% margin). GST 10%.

HOW TO WORK
- Before changing code: run `npm test` and (with `npm run server` running) `npm run e2e`. Both must pass now (115 unit, 25 browser).
- After every change: add or update tests, run both suites again, and report real pass/fail output. Never claim something works without running it.
- Keep changes small and explain them in plain English. Update docs/CHANGELOG.md and docs/FEATURES.md.
- If you cannot do something (no API key, blocked website), say so plainly and do the rest.

First, read README.md and docs/HANDOFF-FOR-AI.md, run both test suites, and reply with: what you understand the app does, the test results, and any problems you see. Do not change code in this first reply.
```

---

## Task prompts (paste one at a time after the master prompt)

### 1. Real Sydney prices
```
Replace example allowances with real prices. I will give you supplier price lists or quotes (or tell you which supplier websites you may read). For each item in src/core/catalogue.ts that is "quote-required" or uses EXAMPLE_ALLOWANCES: add the verified price, unit, GST treatment, source URL or quote reference and date. Never invent a price. Keep items without evidence as quote-required. Update docs/RESEARCH.md. Show me a table: item, old status, new price, source.
```

### 2. AI reads the before photo
```
When an AI key is configured on the server, add a "Read this photo" button in IdeasPanel.tsx that sends the before photo to the existing /api/ai/analyze-photo route (server/ai.ts) and pre-ticks the checklist (overgrown, slope, kids/pets signs, existing patio, trees) with a short reason for each tick. The user must be able to untick anything. The AI must not set any dimension or geometry. Without a key, show "AI photo reading is not configured" and keep the manual checklist. Add tests for the no-key path and for the mapping from AI output to checklist ticks (mock the provider in tests; label mocks clearly).
```

### 3. More design ideas
```
Add new layout ideas to src/core/ideas.ts following the existing pattern (min yard size, fit scoring with reasons, layout per tier, inset hostId for things set into another surface): (a) pool surround with paving and screening plants, (b) veggie garden with raised beds and path, (c) water feature courtyard, (d) curved lawn and border garden. Every idea must pass the existing test that checks all ideas × tiers × yard shapes stay inside the boundary with no overlaps. Do not add structural sizing for pool fencing or water features; flag pool barrier compliance for review.
```

### 4. Non-rectangular yards and curved shapes
```
Ideas currently use the bounding box of the site outline. Make ideas work inside L-shaped and irregular outlines: clip each idea's areas to the actual site polygon (geometry.ts has polygon helpers) and skip areas that become too small. Add curved lawn edges using the existing arcThrough helper where an idea asks for curves. Extend tests with an L-shaped yard and a trapezoid yard.
```

### 5. Real phone use
```
Make the phone experience field-ready: test the app at 390 px width with touch for the full flow (photo, checklist, size, idea, tier, select, apply, 3D). Fix anything hard to tap or read. Add an offline-friendly "site visit" mode that saves photos and measurements locally and syncs to the server when back online, with clear "not yet uploaded" states. Do not lose data on a failed upload. Add browser tests that simulate offline then online.
```

### 6. Better construction drawings per idea
```
For each design idea, make sure the PDF pack has what a crew needs: set-out dimensions for every proposed element from the datum corner, stepping-stone spacing, pergola post positions marked "indicative - confirm with kit/engineer", fire-pit clearances noted as "check council rules", and a one-page "crew summary" sheet (what goes where, order of work, hold points, materials to have on site). Use the existing sheet primitives in src/core/exports/sheets.ts. Keep NOT FOR CONSTRUCTION stamps. Add tests that no sheet content is clipped.
```

### 7. Hosting so others can use it
```
Prepare the app for a small company deployment: a Dockerfile, a guide for hosting on a low-cost VPS with HTTPS (Caddy), LIS_AUTH=on with user setup, nightly backup of the data folder, and how to set ANTHROPIC_API_KEY / OPENAI_API_KEY as server secrets. Do not put any secret in the repository. Test the Docker image locally and report the results. List monthly costs only from current official pricing pages, with dates, or mark them as estimates.
```

### 8. Learning from finished jobs
```
Build a company-wide rate library from completed projects: when a project has actual costs and hours (Project Performance page), store productivity per activity and access class. Suggest updated productivity rates for new estimates, showing how many jobs each suggestion is based on. Never change rates automatically; the user approves each change. Add tests with three synthetic completed jobs (clearly labelled synthetic).
```

---

## What "done" looks like for any task
- Both test suites pass, with the real output shown.
- New behaviour has tests.
- Docs updated (CHANGELOG, FEATURES, and README if usage changed).
- Nothing in "Rules that must not be broken" was weakened.
- A short plain-English summary: what changed, how to use it, what is still missing.
