# Research summary: Sydney / NSW landscaping

Research done 11 to 12 November 2026 via web search. Some primary sites (NSW legislation, NSW Planning Portal, BC Sands) could not be fetched directly from the build environment, so several findings come from search-engine excerpts of those pages. Where that matters it is marked **[excerpt]**. Nothing below is legal or engineering advice.

## 1. Highest-value activities to automate

From the brief and the shape of typical backyard jobs, the time sinks that software can actually remove are:

1. **Measure-to-drawing**: turning tape/laser measurements and photos into a scaled plan. Done here with a metric editor plus a "what to measure next" list ranked by cost impact.
2. **Quantity take-off**: walls (units, posts, drainage aggregate, ag pipe, fabric), paving (pavers, base, bedding, edging), soil, turf. These are formula-driven and error-prone by hand, especially unit conversion (m³ to tonnes) and pack rounding.
3. **Estimate assembly**: materials, labour hours, equipment, disposal, overhead, contingency, margin, GST, with markup and margin kept distinct.
4. **Option pricing**: the same layout in economy / balanced / premium materials.
5. **Crew documents**: set-out plan with coordinates from a datum, wall elevation, section, sequence and hold points.
6. **Approval-trigger screening**: retaining wall height, contract value thresholds, tree root zones.

Lower value for automation (high risk of false confidence): structural design of walls and decks, hydraulic drainage design, planning approval itself.

## 2. Australian / NSW requirements used in the app

| Topic | Finding | Source | How it is used |
|---|---|---|---|
| Contractor licence | Licence required for residential building work including structural landscaping valued over $5,000 labour + materials inc GST. Structural landscaping is an "other building work" category. | NSW Government, Structural landscaping work (page updated 23 June 2026): https://www.nsw.gov.au/business-and-economy/licences-and-credentials/building-and-trade-licences-and-registrations/structural-landscaping-work | Licence check against estimate value |
| What counts as structural landscaping | Retaining walls, fencing, driveways, paths and paving, pergolas, decks, ponds and water features (Home Building Regulation 2014 Sch 4). Soft landscaping (turf, plants, soil, mulch) is not residential building work and may be contracted separately. | SIRA guidance for landscaping projects (31 March 2026): https://www.sira.nsw.gov.au/home-building-compensation/home-building-compensation-for-builders-and-tradies/contracting-and-home-building-compensation-guidance-for-landscaping-projects | Contract/insurance check note |
| Contracts and HBC insurance | Written contract over $5,000 inc GST (small-job contract to $20,000); over $20,000 needs a large-job contract and Home Building Compensation cover before work or payment; max deposit 10%. | NSW Government, Contracts for residential building work: https://www.nsw.gov.au/housing-and-construction/building-or-renovating-a-home/preparing/contracts ; SIRA insurance obligations | Contract/insurance check; quote PDF basis note |
| Specialist work | Electrical and plumbing/drainage work need a licence regardless of value. | NSW Government, Categories of work: https://www.nsw.gov.au/business-and-economy/licences-and-credentials/building-and-trade-licences-and-registrations/categories-of-work | Lighting and drainage checks |
| Exempt earthworks / retaining walls | Codes SEPP 2008 Pt 2 Div 1 Subdiv 15 (cl 2.29 to 2.30). Exempt only if cut/fill is not more than 600 mm, not on a flood control lot or heritage item, and other standards met (a later amendment added a natural-waterbody setback). **The full current clause text, including boundary setback and wall separation, was not retrieved and is not encoded.** | NSW Planning Portal exempt development pages **[excerpt]**; council summaries; Tweed guidance note | Wall planning check: >600 mm flagged; ≤600 mm still "insufficient information" until the rest of cl 2.30 is checked by a person |
| Exempt decks | ≤25 m², floor ≤1 m above existing ground, ≥900 mm from boundaries (5 m in some rural zones), behind building line, total area limits, ≤3 m high. | NSW Planning Portal, Balconies, decks and patios (updated 23 March 2026) | Deck check (numeric standards only) |
| Exempt paving | Codes SEPP Subdiv 28: not on heritage / foreshore / sensitive land; cut/fill ≤600 mm (residential, ancillary to dwelling); runoff to existing stormwater; landscaped-area and total-area limits. | NSW Planning, Driveways, pathways and paving; DPE fact sheet (2022) | Paving check (cut/fill and heritage only; area ratios not encoded) |
| Retaining wall engineering | AS 4678 applies to earth-retaining structures 800 mm to 15 m. Manufacturer limits apply below (e.g. Adbri Versawall: 800 mm unreinforced, 1400 mm with engineering; "consult council for walls over 800 mm"). Austral Pioneer sleeper system guide: posts at sleeper length + 30 mm, 100 mm slotted ag pipe at 1:100, surcharge tables. | NCC 2019 Vol 2 Part 3.1.2 explanatory note; Adbri Versawall page; Austral Masonry Pioneer installation guide (via Bunnings) | Engineering trigger at >800 mm or any surcharge; post spacing; drainage zone ≥300 mm |
| Slip resistance | HB 198:2014 recommends P4 for external pavements up to 1:14 and P5 steeper. | ACO summary of HB 198 / AS 4586-2013 | Paving slip check (always "insufficient" until a test report is recorded) |
| Trees | AS 4970:2025 (published 30 May 2025): notional root zone radius = 12 × trunk diameter at standard height; >10% encroachment needs arborist review. Council tree rules differ. | ECA Victoria summary of AS 4970:2025 | Tree root-zone check |
| Services | Before You Dig Australia enquiry before excavation. | byda.com.au | Always flagged when excavation is in scope |

Not encoded (needs a person): council LEP/DCP controls, zone-specific landscaped-area ratios, easements and covenants, stormwater discharge rights, bushfire construction, BCA compliance, all structural capacity checks.

## 3. Suppliers and materials

Prices below were read from public pages on **11 November 2026** and are stored in the catalogue with source URL and date. All include GST. None is a trade price, stock confirmation or agreement.

| Product | Supplier | Price | Unit |
|---|---|---|---|
| Blue metal aggregate 20 mm, tipped | BC Sands | $149.00 list ($145.28 online) | t |
| Roadbase recycled DGB20 (RMS 3051), tipped | BC Sands | $90.99 list | t |
| Agi pipe and sock 100 mm × 20 m | BC Sands | $159.00 | roll |
| Agi pipe and sock 100 mm × 10 m | BC Sands | $84.99 | roll |
| Geofabric 140 g/m², 2 m × 50 m | BC Sands | $189.00 | roll |
| Organic garden mix AS 4419 | BC Sands | $139.00 | m³ |
| Turf Gro underlay loam, tipped | BC Sands | $129.00 | t |
| Sandstone blocks, various | BC Sands | $199.00 | m² |
| Sandstone billet 1000×300×300 A grade | BC Sands | $279.00 | each |
| Sandstone paver 600×400×30 / 400×400×30 | BC Sands | $53.99 / $32.99 | each |
| Sandstone edging 500×100×150 | BC Sands | $42.99 | each |
| Sir Walter buffalo turf | BC Sands Spring 2025 catalogue | $15.99 | m² — **marked outdated** (promotion ended Feb 2026) |
| Pioneer concrete sleeper 2.0 m × 200 × 75 Charcoal / Sandstone | Bunnings (Austral Masonry) | $63 / $69 | each (special order) |
| Pioneer 2.4 m × 200 × 75 Charcoal | Bunnings | $72 | each |
| Galintel H joiner post 1500 mm / C end post 1800 mm | Bunnings | $84.03 / $75.51 | each — suitability not verified |
| Brutus 100 mm × 20 m slotted socked agi pipe | Bunnings | $138 | roll |
| Cliftonvale travertine paver 610×406×30 | Bunnings | $26.99 ($108.98/m²) | each |
| Adbri Versawall block / cap | Nuway (Brisbane reseller list, Oct 2026) | $15.56 / $7.11 | each — **placeholder only, not a Sydney price** |

Findings that changed the design:
- **Nuway is a South-East Queensland supplier**, not Sydney. Its price lists are used only for published bulk-density conversions (e.g. blue metal 1.5 t/m³, road base 1.6 t/m³) and an Adbri placeholder.
- **Stone Front, Barrenjoey Timber and Martins**: no public price lists found. Kept as suppliers with "quote required" items. Stone Front states its guide prices exclude GST.
- BC Sands lists two different prices for 20 mm blue metal on the same day (product page $149/t, category page $129/t). The catalogue stores the product-page price and notes the discrepancy.
- Sellers mix units (tonne vs m³ vs bag vs roll vs each), so the engine refuses to convert volume to mass without a stored density.

## 4. Practical ways to capture dimensions

| Method | Accuracy (indicative) | Status in app |
|---|---|---|
| Laser distance meter / tape | Millimetres to centimetres | Primary "verified" method |
| Registered survey / survey plan | Survey grade | "Verified"; only valid boundary source |
| Phone LiDAR (iPhone Pro) via third-party apps (Polycam, Scaniverse, etc.) | Centimetres over short ranges, drifts over a yard | Files accepted and stored; values entered as "estimated" |
| Photogrammetry | Depends on scale references | Same as LiDAR |
| Aerial / satellite screenshot | Decimetres to metres; offsets and lean | Underlay with two-point calibration; anything traced stays "estimated" |
| Single photo | No absolute scale | Feature tagging only; never produces dimensions |

Native ARKit/ARCore capture needs a native mobile app; this web build accepts exported files instead.

## 5. Key technical and regulatory risks

1. Retaining walls under 800 mm are not automatically safe: surcharge, slope, fill, water and nearby structures all matter. The app flags any non-level surcharge for engineering.
2. "Under 600 mm is exempt" is not a complete rule; other cl 2.30 standards and council controls apply. The app never reports a wall as exempt.
3. Stormwater discharge rights and connection condition are unknown until a plumber inspects.
4. Prices drift quickly; one of the gathered prices (turf) was already stale.
5. Labour productivity varies more than material prices; the defaults are assumptions and should be calibrated from the Performance page.

## 6. Recommended architecture (as built)

TypeScript React app over a deterministic core library; Node server with SQLite (single file, zero ops) and file storage for media; AI behind a narrow server-side adapter that can only propose validated operations; Airtable as an optional sync target for business records while geometry stays in the app. Rationale and trade-offs in `ARCHITECTURE.md`.
