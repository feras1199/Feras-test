# Change log

## v0.2 — Photo → concepts → customer choice → buildable project (12 Nov 2026)

Everything from v0.1 is kept: drawing, quantities, estimate, safety labels, approvals, NSW checks, supplier provenance, PDF/DXF/CSV, tests.

**New workflow (Visual Concepts page)**
- Design brief: style, required items, budget ceiling, constraints, source photos.
- Generates three structured `DesignProposal`s (Economy / Balanced / Premium). Each one is a list of real operations (add paving 8.5 × 3 m, add 10 m wall at 0.6 m, set material…) costed by the existing estimate engine, with a cost range, materials, key changes, pros/cons, maintenance, assumptions, excluded items and review flags.
  - With no design yet: the layout is placed inside the drawn site outline beyond the house. Photos are never used for geometry; without a site outline, generation is refused.
  - With an existing design: options keep the dimensions and change materials only.
- Pictures: "Generate AI render" (server-side, provider adapter) or "Import render". Every picture carries "Illustrative concept only - not surveyed, not to scale, not for construction." Imported pictures are labelled "Imported illustrative render". With no key, the app says "AI image generation is not configured" and generates nothing.
- Customer selection: records customer name, who recorded it and when; sets status "Customer selected concept". The app states what selection does and does not mean.
- Apply: change-by-change approval with price impact and affected purchase quantities. Saves a "Before" version and a "Customer choice" version that carries the proposal id and render ids. Either can be restored.

**Linked outputs**
- 3D massing moved into the core (`src/core/iso.ts`). The screen view and the new drawing sheet use the same function, coordinates and material colours.
- Build layers (`src/core/layers.ts`) for paving, turf, garden beds and retaining walls: layer, purpose, product, quantity (from the take-off), source, status (verified / assumed / review required), crew instruction and hold point, plus an exploded diagram. Walls carry "Concept detail - engineer/manufacturer design required before construction." and the footing is always "SIZE BY ENGINEER / MANUFACTURER" until an engineer approval is recorded.
- Drawing pack: new sheets for the selected concept (with the embedded render), 3D massing, and one build-layer sheet per element.
- Procurement: "needed for" construction stage, missing information per line, purchase-order draft text.
- Customer estimate PDF reads "PRELIMINARY ESTIMATE - INCOMPLETE, NOT A FINAL QUOTATION" while any selected item is unpriced or unmeasured.

**Approval gate** (`src/core/approval.ts`)
- Status path: Draft → Concept generated → Customer selected concept → Measurements verified → Technical review required → Approved → Issued for construction.
- The crew role cannot change status. Approve and Issue need the Authorised reviewer role and no open technical blockers. Issue needs Approved first. Each reviewer action is recorded as an approval.

**Server and data**
- `POST /api/ai/render`: image provider adapter (`server/image.ts`, OpenAI image edits implemented, not verified live). Key read from server environment only.
- Migration `002_renders.sql`: `render_log` (provider, model, prompt, source media, result, status, error, who, when) for every AI or imported render. A migration runner now applies all files in `server/migrations` in order and records them in `schema_migrations`.
- `GET /api/renders/:projectId` lists the provenance log.
- Project document gains `proposals[]` and `activeProposalId`; `DesignVersion` gains `proposalId`, `renderIds`. Media gains kind `render`, which is excluded from site-photo pickers.

**Other**
- "Open demo site (no design yet)" on the Dashboard: synthetic existing conditions only, the starting point for the concept flow.
- Design versions list now shows even when the design is empty, so you can restore from an empty state.
- Drawing page states that perspective photos cannot give reliable dimensions, and shows which concept the plan is linked to.

**Tests**: unit 25 → 38 (new `tests/concepts.test.ts`); browser 16 → 25 (photo, concepts, selection, apply, linked plan and 3D, build layers, procurement, drawing pack, approval gate, version restore).
