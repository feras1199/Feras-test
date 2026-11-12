# Feature-completeness matrix

Legend: **Tested** = fully implemented and covered by automated or scripted tests. **Implemented** = built and used manually, not covered by a test. **Partial** = core works, listed parts missing. **Demo only** = shown with labelled sample behaviour. **Not implemented**.

## Priority A: foundation

| Requirement | Status | Notes |
|---|---|---|
| Navigation, guided workflow with saved progress | Tested | 13 pages; 11-step workflow bar with "next step" |
| Customer and project creation | Tested | Customers page lists by customer; no separate customer database |
| Persistent storage | Tested | SQLite on server (with last 30 saves per project kept as history); IndexedDB fallback |
| Photo upload | Tested | JPEG/PNG/WebP, resized, EXIF/GPS stripped; PDFs and scan files stored for reference |
| Manual measurement entry with method, source, date, confidence | Tested | Verified vs estimated vs unknown, precision shown accordingly |
| Scaled 2D editor | Tested (core) | Rect, polygon, polyline, arc, points, dimension, note; move, rotate, typed resize, duplicate, delete, lock, hide, undo/redo, snap, grid, layers, zoom/pan/pinch |
| Landscape objects | Tested | Paving, walls, gardens, turf, deck, gravel, steps, edging, drains, pits, lights, cable, plants, trees, levels |
| Parametric quantities from geometry | Tested | One geometry model; everything derived |
| Materials library with editable prices | Tested (core) | Manual edit, CSV import/export, price history, staleness warning |
| Working estimates | Tested | Materials, labour, equipment, subcontract, disposal, delivery, overhead, contingency, markup/margin, GST |
| PDF drawing export | Tested | A3/A4, 10+ sheets |
| Material schedule export | Tested | CSV and PDF sheet |
| Save and reload | Tested | Autosave + manual save + project file export/import |

## Priority B: AI

| Requirement | Status | Notes |
|---|---|---|
| AI photo analysis | Implemented, **not verified live** | Server calls Anthropic Messages API with the image; returns tagged features (unconfirmed until user confirms). Needs `ANTHROPIC_API_KEY` |
| Feature detection review (confirm / rename / remove) | Tested | Tags never become geometry |
| Measurement prompts | Tested | Ranked "measure next" list with diagram |
| Natural-language design editing | Partial | Built-in rule-based commands tested; free-form via live AI implemented but not verified; all ops validated and need approval |
| Cost-aware substitutions | Tested | "Make it $X cheaper" compares installed cost per object |
| Alternative designs (economy / balanced / premium) | Tested | Same layout, different materials; not different layouts |
| AI visual concepts / photorealistic rendering | Not implemented | Stated in the app; 3D massing view instead |
| Contextual construction guidance | Partial | Sequence, hold points and "why engineering" are rule-based, not AI |
| Optimise for cost / speed / maintenance / premium | Partial | Ranks the three alternatives; maintenance ranking is qualitative |

## Priority C: construction intelligence

| Requirement | Status | Notes |
|---|---|---|
| Retaining wall assemblies | Tested | Concrete sleeper, segmental block, sandstone, timber |
| Wall concept sections and elevations | Tested | Clearly stamped; footing shown as "size by engineer" |
| Engineering approval gate | Tested | Reviewer role, recorded credential and reference, blocks issue |
| Paving detail and quantities | Tested | Pattern waste, base, bedding, jointing, edge restraint, falls note |
| Decking | Partial | Boards and framing allowances only; spans must be entered from verified tables |
| Planting | Partial | Area × spacing quantities; five Sydney natives seeded; no plant database or invasive-species list |
| Drainage concept | Partial | Pipe, trench, pits, wall drainage; no hydraulic calculation |
| Lighting layout | Partial | Fittings and cable quantities; electrical flagged |
| NSW compliance checks | Partial | Licence, contract/HBC, wall exempt + engineering triggers, paving, decks, trees, BYDA, electrical, drainage, boundary; **council-specific controls and full clause 2.30 not encoded**; council is chosen manually, not looked up from address |
| Supplier comparison | Partial | Same-group products from other suppliers, before delivery |
| 3D visualisation | Partial | Isometric massing from plan geometry; no terrain, no materials texture |
| Historical cost learning | Partial | Per-project actual vs estimate and productivity scaling; no cross-project rate library |
| Procurement | Partial | Order lists, status, CSV order requests; no supplier ordering API |
| Airtable integration | Implemented, **not verified live** | One-way customer + project sync with stored record ids to avoid duplicates; no inbound sync |
| Authentication and roles | Tested (scripted) | Optional; owner/estimator/crew/reviewer; crew can only add notes/progress |
| Scan processing (LiDAR, point cloud, mesh) | Not implemented | Files stored only |
| Address search / map | Not implemented | Aerial screenshots can be uploaded and calibrated as an underlay |
| Video upload, voice notes | Not implemented | Rejected with a clear message |
| DXF export | Tested (file structure) | Not opened in a CAD package here |
| Version history | Tested | Named design versions + server keeps last 30 saves |
