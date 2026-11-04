# ATLAS — Airtable Database Audit

Base: **Whispering Leaf Operating System** (`appygHLmJTH1ew5r6`)
Inspected: 2 November 2026, via the Airtable connector (schema, formulas, automations, and records for Projects, Project Components, Estimates, Payments, Customers, Enquiries).
Raw snapshots: `airtable-schema-snapshot.json` (all 30 tables, field names and types) and `airtable-formulas-snapshot.txt` (formulas, select options and links for the 11 core tables).

No changes were made to the base during this audit.

## 1. Headline findings

1. **The schema is far more mature than the data.** 30 tables and about 785 fields, with careful reconciliation formulas, audit checks and snapshot fields. But nearly every record is DEMO, QA TEST or "LIVE AUDIT" practice data, and all 18 projects are flagged `Data Mode = Practice/Setup`. There is no live business history yet to drive dashboards. ATLAS must therefore show honest empty states rather than charts built on demo data, and must respect `Data Mode` everywhere.
2. **Two deployed automations are creating bad payment records.** `Atlas P2 — Payment 15% Progress` and `Atlas P2 — Payment 10% Final` trigger when `Payment Creation Ready` *is not empty*. That formula returns 0 or 1, so it is never empty. Result: any estimate set to Accepted spawns "AUTO – 15% Progress" and "AUTO – 10% Final" payments even when the quote is not locked, while the 50% and 25% stages (which correctly require `= 1`) are not created. This is visible on 11 LIVE AUDIT projects: 9 have only the AUTO 15% and 10% payments, and 2 have those plus a manual "Deposit 20%".
3. **Payment schedules disagree with each other.** The automations hardcode 50/25/15/10. The Estimates table defaults to a five-stage 10/30/30/20/10. Payments created by the automations are checked against neither.
4. **Likely compliance issue with a 50% deposit (needs your verification).** For residential building work in NSW, the Home Building Act 1989 caps deposits at 10% of the contract price, and contracts over $5,000 need a written contract. Structural landscaping (retaining walls, paving, pergolas, driveways) is generally licensed residential building work. The 10% deposit default already in the Estimates formulas suggests someone has already accounted for this. I have not changed anything: ATLAS keeps schedules configurable and warns when a deposit exceeds 10%. Please confirm with NSW Fair Trading or your lawyer.
5. **Pricing constants are hardcoded in formulas.** 30% markup appears as a literal `0.30` in Estimates and Project Components. ATLAS moves this into configurable settings and computes prices in tested code.
6. **GST basis is inconsistent.** Costs are stored GST-inclusive. Markup is applied to the GST-inclusive base unless an estimate line has `Net Cost Pricing` ticked. If markup is applied on GST-inclusive cost and GST is then added to the sell price, GST is effectively marked up and double counted. Most estimates use `Pricing Basis = Legacy – review`. ATLAS prices on GST-exclusive cost and adds GST once at the end.
7. **Manager price overrides have no sanity bound.** Several test estimates have a recommended price around $91 and an override of $20,500 to $21,800, and `Pricing Check` still says OK. Agreed price snapshots are stored unrounded (for example $28,399.0345937). ATLAS rounds to cents and flags overrides that move margin outside a configurable band.

## 2. Table-by-table summary

| Area | Tables | Status | Notes |
|---|---|---|---|
| CRM | Customers, Enquiries, Atlas Tasks, Communications, Marketing Campaigns | Usable now | Lead status exists on both Customers (13 options, mixes lead and project states) and Enquiries (12 options). ATLAS treats **Enquiries.Status** as the pipeline source of truth and Customers as the contact record. 3 enquiries have no customer; 1 has no enquiry date. |
| Site visits | Site Inspections, Site Measurements | Usable now | Rich structure (slope, drainage, services, transcript, AI fields). Measurement formulas for area and volume are correct. Inspections hold measurements twice (rich-text `Measurements` plus the linked table); ATLAS uses the linked table. |
| Estimating | Cost Library, Cost Price History, Recipes, Recipe Items, Productivity Library, Omission Rules, Estimates, Estimate Items | Usable, needs care | Cost Library has a legacy text price `Cost (inc GST)` plus a numeric one; `Effective Unit Cost inc GST` resolves both. Recipe quantity rules are free text, so they cannot be executed safely as-is. `Executable Rule Status` and `Structured Quantity Basis` exist to fix this and ATLAS uses them. Labour cost on estimate lines (`Estimated Labour Cost`) is **not** included in the `Estimate Line Cost Rollup` (it rolls up `Line Cost` only), so labour can be silently left out of the estimate total unless entered as a priced line. |
| Projects | Projects, Project Components, Project Schedule, Project Checklists, Variations, Project Files, Client Updates | Usable now | Component-level reconciliation is well designed: `Reconciled Actual Cost` = itemised costs + submitted labour + unitemised adjustment. 41 of 62 components have no reconciled cost and 16 still carry unitemised adjustments. |
| Costs and labour | Actual Costs, Timesheets | Usable now | Timesheet person-hours vs crew-hours logic is correct (`Rate Basis` Per Person vs Crew Total). Only submitted timesheets roll up, which is right. |
| Finance | Payments, Invoices & Claims, Business Targets | Usable with fixes | See findings 2 to 4. Payments carry both `Legacy Stage` and `Stage Label`/`Stage %`; ATLAS writes the new pair and reads both. |
| Settings | Integration Settings, Lists, Atlas Guide | Partial | `Lists` is an unstructured leftover (3 text fields). Integration Settings has the right shape for tracking connection status. |

## 3. Duplicated, legacy or inconsistent fields

- Projects: `Customer` and `Legacy Customer Link`; `Legacy Component Text`; four overlapping profit families (`Actual Profit`, `Component Profit Snapshot`, `Trusted Actual Profit`, `Reconciled Project Actual Profit`). ATLAS uses only the **Reconciled** family for reporting and shows the others as legacy.
- Customers: `Linked Projects` and `Legacy Projects Link`; `Legacy Campaign Text`; `Lifetime Value` is a manual currency field rather than a rollup.
- Estimates: legacy margin-method fields (`Legacy Target Margin %`, `Legacy Selling Price (Old Margin Method)`, `Legacy 50%…10%` amounts, `Legacy Sales Commission %`) alongside the newer cost-plus fields.
- Payments: `Legacy Stage` and `Stage Label`.
- Customer Type mixes classification (Residential, Commercial) with household type (Couple, Family, Single).
- Component Type has `Drainage ` with a trailing space alongside `Drainage (Ag Pipe)`.

## 4. Relationships

All core links are bidirectional and consistent. Customer → Enquiry → Site Inspection → Estimate → Project → Components → Costs/Timesheets/Payments is fully modelled. No component lacks a project. Site Measurements link to both Inspection and Project, which lets measurements flow into estimates without re-entry.

## 5. What ATLAS needs that the base lacks

| Need | Proposed change | Destructive? |
|---|---|---|
| App users, roles and login | New table `Atlas Users` (email, role, active, linked customer for portal users) | No, additive |
| Audit log | New table `Atlas Audit Log` (actor, action, table, record, before/after JSON, time) | No, additive |
| Configurable pricing and schedules | New table `Atlas Settings` (markup %, GST %, deposit cap, default schedules, commission defaults) | No, additive |
| Quote acceptance evidence | New fields on Estimates: acceptance token hash, accepted by name/email, accepted IP, accepted timestamp | No, additive |
| Fix payment automations | Turn off the four `Atlas P2 — Payment …` automations once ATLAS creates schedules itself | **Changes live behaviour, needs your approval** |
| Clean up test data | Archive or delete DEMO / QA TEST / LIVE AUDIT records before go-live | **Destructive, needs backup and your approval** |

Until the additive tables exist, ATLAS runs on a local configuration file for settings and users, so nothing in the base has to change for the app to work.

## 6. Architecture plan

- **Web app**: Next.js (TypeScript) with server-side API routes. The Airtable token lives only on the server.
- **Data layer**: a repository interface with two implementations: `AirtableRepository` (REST API, pagination, retry with backoff on 429/5xx, 5 req/s throttle, short-lived cache) and an `InMemoryRepository` seeded with clearly fictional fixtures for development and tests.
- **Business logic engine**: pure, deterministic TypeScript modules for pricing, GST, margin, payment schedules, labour, measurements and reconciliation, covered by unit tests. No financial number is produced by an AI model.
- **Auth and permissions**: signed session cookies, role-based checks enforced in every API route, customer portal scoped to the customer's own records.
- **Integrations**: QuickBooks, email, calendar, storage and AI behind adapters that report `not connected` until real credentials are supplied and tested.
- **AI assistant**: tool-calling over the repository with the same permission checks as the UI; actions that change money, contracts or customer communications return a proposal that a user must confirm.

## Addendum: GST basis of actuals and revenue

- **Actual Costs are recorded inc GST**, and the `Reconciled Actual Cost` formulas on Project Components add them as-is. Component revenue (`Quoted Revenue`, `Final Revenue`) appears to be ex GST. If both are true, Airtable's component profit understates profit by the GST on materials. ATLAS converts non-labour actual costs to ex GST in its own reports. **Needs owner confirmation:** is component revenue entered ex GST or inc GST?
- **Timesheets have only a `Submitted` checkbox**, no approval step. ATLAS counts submitted timesheets as actual labour (matching Airtable). An additive `Approved` field would let a manager sign off hours before they count.
