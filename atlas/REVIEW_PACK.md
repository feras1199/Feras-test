# ATLAS review pack

This file is for anyone, person or AI, who is reviewing ATLAS. It explains what was built, how it works, what has been tested, and what is missing or assumed. It doesn't depend on any other material, but the source code and the detailed docs are linked below.

**Prepared:** 2 November 2026, updated 3 November 2026

**New readers start here:** `docs/ARCHITECTURE.md` explains how the website is built, step by step, and how to extend it or build something similar.
**Branch:** `claude/project-thread-wby4er`
**Base branch:** `whispering-leaf-concept`

## 1. What ATLAS is

ATLAS is a business operating system for **Whispering Leaf Landscaping & Construction**, a landscaping and construction business in Sydney. It's a Next.js web app with **its own Postgres database**. The business's old Airtable base ("Whispering Leaf Operating System", 30 tables) is now only a read-only source for a one-time import. The owner wants to stop using Airtable.

It covers the full job lifecycle, in this order:

1. Enquiry
2. Site inspection and measurements
3. Estimate
4. Approved, locked quote
5. Customer acceptance
6. Project
7. Costs, time and variations
8. Payment stages
9. Finance

It also includes:
- a customer portal;
- an AI assistant ("Ask ATLAS") that answers only from the business's records.

**Business conventions (all configurable):**
- AUD, with GST at 10%.
- Cost-plus pricing with a 30% markup.
- An optional 6% marketing commission.
- Payment schedules of 10/30/30/20/10 (default) or 50/25/15/10 (legacy).

**Where to find it:**
- **Source:** https://github.com/feras1199/Feras-test/tree/claude/project-thread-wby4er/atlas (public repository).
- **Pull request:** https://github.com/feras1199/Feras-test/pull/1
- **Source ZIP:** https://github.com/feras1199/Feras-test/archive/refs/heads/claude/project-thread-wby4er.zip

## 2. Current state, honestly

| Item | State |
|---|---|
| Code for all 10 planned phases | Written, committed, pushed |
| Typecheck (TypeScript strict) | Clean |
| Unit tests (Vitest) | 136 pass, plus 6 Postgres tests that run against a real database when `TEST_DATABASE_URL` is set (142 of 142 pass on Postgres 16) |
| Browser end-to-end tests (Playwright, production build) | 23 of 23 pass on demo data **and** on a Postgres-backed server; 6 of 6 for logins managed in the database |
| Own database (Postgres) | Built and tested locally. Import from Airtable tested with the real price libraries (570 cost items, 35 productivity rates, 12 omission rules). |
| Hosted anywhere | **Not yet.** `render.yaml` creates the web service and a paid Postgres database. The owner deploys it with one link; it hasn't been run yet. |
| Running against the live Airtable base directly | Not tested live (no personal access token). No longer the plan; Airtable is only an import source. |
| AI assistant against the real model | **Not tested live.** There was no API key. The tool loop, permissions and confirm-before-save flow are unit-tested with a fake model client. |
| QuickBooks, email, SMS, calendar, file uploads | **Not built.** Adapters are placeholders that report "not connected". |
| Changes made to the live Airtable base | **None.** |

Everything is currently exercised in **demo mode**: an in-memory store with fictional records. The fictional customers all use the surname "Demo", example.com email addresses, and 0491 570 xxx phone numbers.

## 3. Architecture

```
Browser ── Next.js App Router (React 19, server components) ── Route handlers /api/* ── Repository
                                                                                          ├── PostgresRepository (live, own database)
                                                                                          ├── AirtableRepository (old base, changeover only)
                                                                                          └── MemoryRepository (demo/tests)
```

**Stack**
- Next.js 15.5, React 19.3, TypeScript strict (`noUncheckedIndexedAccess`).
- Tailwind 3.4, zod 4, Vitest 5, Playwright.
- About 9,700 lines of TypeScript, 37 API routes, 29 pages and 182 files.

### Server-only secrets

- The Airtable token and the Anthropic key are read only on the server, inside `server-only` modules.
- No secret is ever sent to the browser.

### Data layer (`src/lib/data/`)

- `entities.ts` maps friendly field names to Airtable field IDs. It is generated from, and tested against, `docs/airtable-schema-snapshot.json`.
- Calculated Airtable fields are marked read-only. Writing to one throws an error.
- Money is stored as integer cents and converted to and from dollars at the boundary.
- Airtable client:
  - one serialised request queue, about 4–5 requests per second;
  - retries on 429 and 5xx errors with backoff;
  - pagination, `returnFieldsByFieldId`, and `typecast:false`;
  - a 30-second read cache that is cleared on writes.
- Records are never hard-deleted. They are excluded or archived instead.
- Postgres store: one `atlas_records(entity, id, data jsonb)` table, tables created on first use, same write rules as the other stores. Also `atlas_audit` (permanent audit log), `atlas_users` (logins) and `atlas_imports` (import history).
- Settings → Backup and import: download every record as JSON; import an ATLAS backup or an Airtable export, with a preview first. All-or-nothing, and safe to re-run.
- Estimates: the Cost Library is searched as you type, from the first letter. New items can be saved to the library from an estimate line.

### Finance engine (`src/lib/finance/`)

- Pure, deterministic functions with no I/O.
- Every screen, the portal and the AI assistant use these same functions.

### Domain (`src/lib/domain/`)

- Input validation (zod) and calculations for CRM, inspections, estimates and projects.

### Auth

- HMAC-signed session cookies via Web Crypto. They are httpOnly, `Secure` in production, and last 12 hours.
- Passwords are hashed with scrypt.
- Six roles: owner, manager, sales, supervisor, worker, customer.
- Permissions live in `src/lib/auth/roles.ts`. They are enforced in three places:
  - middleware;
  - every page (`requirePage`);
  - every API route, through the `route(perm, handler)` wrapper.
- On each request the server also checks that the user still exists, is active, and has the same role and linked customer. Removing a user therefore signs them out right away.
- Logins come from the owner's host variables (`ATLAS_OWNER_EMAIL` / `ATLAS_OWNER_PASSWORD`), optional `ATLAS_USERS_JSON`, and people added in the app (Settings → People and logins, stored in Postgres). The owner can add people, change roles, reset passwords and switch logins off. Everyone added this way can change their own password.

### Write safety

- **Cross-site requests:** non-GET requests whose Origin differs from the host are blocked.
- **Body size:** request bodies over 256 KB are refused.
- **Audit log:** every write is audit-logged with who made it, what changed, and the values before and after. In Postgres mode the log is stored permanently in the database; otherwise it is kept in memory. It is always written to stdout as JSON lines too.
- **Confirmation:** actions that affect money or contracts require explicit confirmation in the UI. This covers approving a price, recording acceptance, marking a payment received, and approving a variation.

### Customer portal

- Data comes from an explicit allow-list (`src/lib/server/portal.ts`).
- A customer only sees their own project progress, schedule, payments and quotes.
- Other customers' quotes return 404.
- Browser tests check the raw HTML and server-component payload for leaks. The checks look for no internal costs, notes or other customers' IDs.

### AI assistant (`src/lib/ai/`)

- **API setup:**
  - Uses the Anthropic Messages API.
  - Model `claude-opus-5-5`, adaptive thinking, explicit effort.
  - Server-side refusal fallback (`fallbacks: "default"`).
- **Loop and limits:**
  - A manual tool loop of at most 8 steps.
  - A limit of 20 questions per 10 minutes per user.
- **Read tools:** search, today overview, pipeline, customer, project, payments, estimate, and tasks.
  - The model is only offered the tools the user's role allows.
  - Every tool re-checks permission on the server.
  - Money fields are removed for roles that can't see them.
- **Write tools:** these only *propose*.
  - `propose_task` and `propose_follow_up` return a suggestion card.
  - The user presses Confirm. That calls the normal API route, which does its own permission checks and audit logging.
  - The model can never write data directly.

## 4. Feature status

| Module | Status | Notes |
|---|---|---|
| Login, roles, session revocation | Done | Demo logins only in demo mode or with an explicit flag |
| Today screen | Done | Built only from records; empty states, no invented metrics |
| Global search, Create menu | Done | |
| Customers with duplicate detection (phone, email, address) | Done | |
| Pipeline board (drag on desktop, tap on mobile), stage rules, at-risk flags, contact log | Done | Moving to Lost needs a reason; open stages need a follow-up date |
| Tasks | Done | |
| Site inspections and measurements | Done | Measurements feed estimate quantities |
| Estimate builder | Done | Live pricing, cost categories, waste %, inc/ex GST inputs, labour in person-hours, quality checks that block approval |
| Approval and locking | Done | Locks an immutable snapshot (`snapshotJson`). Overrides outside the 15–45% margin band need owner approval with a reason |
| Quote document (printable) | Done | Built from the snapshot; no internal costs |
| Send, accept, decline, revise | Done | Acceptance creates the project and payment stages idempotently (key `estimateId:index`) |
| Projects | Done | Status, schedule, checklists, actual costs, timesheets, variations, customer updates, component profit |
| Finance | Done | Overdue, due soon, to raise, mark received, job profitability |
| Customer portal | Done | View progress and payments; accept own quote (records name and IP) |
| Ask ATLAS | Done, not live-tested | Honest "not set up" state without a key |
| Settings page | Partial | Read-only view. Values come from `ATLAS_SETTINGS_JSON`. In-app editing needs an additive Airtable table (approval pending) |
| Audit log page | Partial | In memory per server process plus the stdout log. A persistent table is pending approval |
| QuickBooks Online AU | Not built | Placeholder adapter only. ATLAS never creates invoices |
| Email, SMS, calendar | Not built | Nothing is ever sent. Customer updates are published to the portal only |
| File and photo uploads | Not built | |
| Timesheet approval step | Not built | Airtable only has a "Submitted" checkbox |

## 5. Financial rules (summary)

The full rules are in `atlas/docs/FINANCIAL_RULES.md`.

- **Money:** integer cents, rounded once per calculated amount.
- **GST:**
  - Costs are kept ex GST inside the engine.
  - Prices entered inc GST are converted.
  - GST is added once, to the final sell price.
- **Markup and margin:**
  - Markup is on cost (default 30%).
  - Margin is profit ÷ sell price. A 30% markup gives a 23.08% margin.
  - The UI always labels which of the two it is showing.
- **Cost build-up:** direct costs + overhead + contingency = cost base. Cost base × (1 + markup) = recommended price ex GST. Labour is priced per person-hour.
- **Commission:**
  - 6%, with a configurable base: invoice inc GST (default) or revenue ex GST.
  - Configurable treatment: absorb (default) or pass through.
- **Payment schedules:**
  - Stages are split in basis points. The last stage takes the rounding remainder, so the stages always add up exactly to the contract price inc GST.
  - ATLAS warns if a deposit is over 10%, because NSW limits deposits on residential building work. This is not legal advice.
- **Variations:** only Approved or Completed variations change the contract. "Sent for Approval" is shown as pending.
- **Actual costs:**
  - Costs are recorded inc GST in Airtable and converted to ex GST, except labour.
  - Only submitted timesheets count.
- **Profit:**
  - Profit is shown only for components that are Completed **and** have final revenue.
  - Work still underway shows "cost used as a percentage of the estimate" instead.
- **Worked example (from a browser test):**
  - Cost lines:
    - 50 m² pavers at $44 inc GST with 8% waste → $2,160 ex GST.
    - Labour, 64 person-hours at $45 → $2,880.
    - Skip bin, $495 inc GST → $450.
    - Road base, $1,452 ex GST.
  - Cost base $6,942.00.
  - × 1.3 = $9,024.60 ex GST.
  - GST $902.46.
  - **Total $9,927.06 inc GST.**
  - 10/30/30/20/10 schedule: $992.71 / $2,978.12 / $2,978.12 / $1,985.41 / $992.70, which sums to $9,927.06.

## 6. Airtable audit (summary)

The full audit is in `atlas/docs/AIRTABLE_AUDIT.md`.

- The schema is well developed: 30 tables and about 785 fields. Almost all records are DEMO, QA TEST or practice data.
- **Payment automations:**
  - Two deployed payment automations have a trigger that is always true, so they create partial payment records whenever an estimate is accepted.
  - The automations hard-code 50/25/15/10, while the Estimates table defaults to 10/30/30/20/10.
  - **ATLAS refuses to accept quotes in live mode until the owner turns these automations off.** Otherwise payments would be created twice.
- **Pricing in Airtable:**
  - GST is inconsistent: markup is applied to a GST-inclusive cost base in the legacy formulas.
  - Labour is missing from the Line Cost rollup.
  - The 30% markup is hard-coded in the formulas.
  - Manager price overrides have no bounds.
- ATLAS works around all of these in code and documents them. It has not changed anything in the Airtable base.

## 7. Testing

| Suite | Count | What it covers |
|---|---|---|
| Unit (`npm test`) | 136 (+6 Postgres) | Cost Library search and import file reader; Postgres store (create, merge updates, write rules, re-runnable import, rollback, audit, logins); finance engine (GST, markup, commission, schedules summing exactly, deposit warnings, reconciliation, variations), entity mapping against the live schema snapshot, memory repository, permissions, CRM rules, estimates, inspections, project financials, AI tool permissions and loop (fake client), session revocation, owner login from host variables |
| End-to-end (`npm run e2e`, Playwright on the production build) | 23 | Cost Library type-ahead and save-to-library; login and redirects; Today; search by phone; customer duplicate warning, create and edit with audit; pipeline flow; tasks; inspection and measurements; full estimate flow (build, check, approve, quote, send, accept → project and payments); sales can't approve; locked estimate rejects edits; project costs, variations and schedule; finance raise and receive; portal acceptance; worker sees no money; customer confined to portal; mobile navigation and no horizontal scroll on 8 pages; cross-site writes blocked; assistant not-configured state; raw-payload leak checks; oversized request refused |
| End-to-end logins (`npm run e2e:people`, needs a Postgres-backed server) | 6 | Owner adds a worker on a phone; duplicate emails refused; no password hashes sent; worker changes password; role change signs them out; switching off blocks them; customer logins must link to a real customer; audit entries |

**How to run the tests:**

```bash
cd atlas && npm ci
npm run typecheck && npm test
npm run build
ATLAS_ALLOW_DEMO_LOGINS=1 ATLAS_SESSION_SECRET=$(openssl rand -hex 32) npm start &
BASE_URL=http://localhost:3000 npm run e2e    # needs a fresh server each run
```

**Demo logins** (password `atlas-demo-2026`):
- owner@, manager@, sales@, supervisor@ and worker@example.com
- taylor.demo@example.com (customer)

## 8. Known limitations and open decisions

**Waiting on the owner**
1. Deploying to Render, then importing the price library file from the Backup and import screen.
2. Which Airtable records to carry over. Nearly all customers and every project in Airtable are DEMO/QA test records; only four customers look real.
3. Confirmation of whether component revenue in Airtable is ex GST (assumed) or inc GST.
4. An Anthropic API key, if the assistant should be switched on.
5. The legacy Airtable payment automations only matter if ATLAS is run directly on Airtable, which is no longer the plan.

**Technical limitations**
- **Single server process.** Login throttling and the assistant rate limit live in memory. Run one always-on instance.
- **Formula values from Airtable** are imported as a fixed snapshot and are not recalculated.
- **Backups don't include logins.** After restoring into a new database, add people again.
- **Customers can't change their own password yet.** The owner resets it for them.
- **List performance.** Lists load whole tables. That's fine at the current scale (hundreds of rows) but needs paging above several thousand rows per table.
- **Linting** is not configured. `next lint` needs interactive setup. TypeScript strict and the tests run instead.
- **Dependency advisory.** `npm audit` still reports a PostCSS advisory. It's build-time only, inside Next.js, and is fixed by Next 16.
- **Demo data gap.** Demo quote Q-DEMO-002 has a total but no cost lines, so it shows $0 in the estimate builder.

## 9. Suggested questions for a reviewer

1. Are the money rules in section 5 correct for an Australian landscaping business, especially the GST handling of costs recorded inc GST, and the commission base?
2. Does anything in the permission model let a worker or customer see costs, pay rates, margins or private notes? Start with `src/lib/auth/roles.ts`, `src/lib/server/api.ts`, `src/lib/server/portal.ts` and `src/lib/ai/tools.ts`.
3. Is quote acceptance safe against double-creating payments? See `acceptEstimate` in `src/lib/server/estimates.ts`.
4. Does the Airtable client handle rate limits, pagination and read-only fields correctly? See `src/lib/data/airtable/client.ts` and `mapper.ts`.
5. What's missing before this can run the real business? Compare against section 4.

## 10. File map

| Path | What |
|---|---|
| `atlas/src/lib/finance/` | Pricing, GST, commission, schedules, labour, reconciliation, estimate checks |
| `atlas/src/lib/domain/` | CRM, estimates, inspections, projects, today list |
| `atlas/src/lib/data/` | Entity map, Repository interface, Postgres store, Airtable client and mapper, memory store and fixtures, import file reader |
| `atlas/src/lib/auth/` | Roles, sessions, passwords, users |
| `atlas/src/lib/server/` | API wrapper, context, audit, search, portal allow-list, estimate acceptance, people/logins, backup and import |
| `atlas/src/lib/ai/` | Assistant tools, loop, client |
| `atlas/src/app/` | Pages (`(staff)/…`, `portal/…`) and API routes (`api/…`) |
| `atlas/tests/` | Unit tests and the Playwright end-to-end script |
| `atlas/docs/` | **ARCHITECTURE.md (how it's built)**, Airtable audit, financial rules, deployment guide, admin guide, known limitations, schema snapshots |
| `render.yaml` | Render blueprint: web service plus private Postgres database (not yet deployed) |
