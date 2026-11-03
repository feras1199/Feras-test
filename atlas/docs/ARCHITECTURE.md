# How ATLAS is built

This guide explains how the ATLAS website works and why it is built this way. It is written so that another developer or AI model can understand the code, change it safely, or build a similar business system for another company.

Read it alongside `REVIEW_PACK.md`, which covers what the system does, what has been tested and what is still missing.

---

## 1. The idea in one paragraph

ATLAS is one Next.js web app that a small trade business uses for everything from the first enquiry to the final payment. Staff see different screens depending on their role, and customers get their own portal. All business rules run on the server, including money, permissions and what each person may see. The browser only displays results and sends requests, and it is never trusted to enforce anything. All data goes through one small interface, the **Repository**, so the same app runs on three different stores:
- its own Postgres database (live);
- the old Airtable base (during the changeover);
- an in-memory set of fictional records (demo and tests).

## 2. Technology

| Part | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router, React 19 | Pages and API in one project. Server components let pages read data on the server, so secrets never reach the browser. |
| Language | TypeScript, strict mode with `noUncheckedIndexedAccess` | Catches missing fields and undefined values before they reach production. |
| Styling | Tailwind CSS | Fast, consistent, mobile-first. The owner mostly uses a phone. |
| Validation | zod | Every request body is parsed against a schema before any logic runs. |
| Database | Postgres (via `pg`) | Owned by the business, cheap to host, easy to back up. |
| Tests | Vitest for unit tests, Playwright for end-to-end tests in a real browser | Runs against the production build. |
| AI | Anthropic Messages API (`@anthropic-ai/sdk`) | Optional "Ask ATLAS" assistant that uses read-only tools. |
| Hosting | Render (`render.yaml` creates the web service and the database) | One always-on Node server. |

## 3. Folder map

```
atlas/
  src/
    middleware.ts          first gate: no session → /login; customers kept inside /portal
    app/
      (staff)/…/page.tsx   staff screens (server components that load data, then render client components)
      portal/…             customer portal
      login/               sign-in page
      api/…/route.ts       JSON API, one folder per resource (37 routes)
    components/            client components: forms, builders, shell, UI kit
    lib/
      auth/                roles and permissions, signed sessions, password hashing, users
      data/                entities (data model), Repository interface, Postgres / Airtable / memory stores, importer
      domain/              business rules per area: CRM, estimates, inspections, projects, cost library
      finance/             pure money functions: GST, markup, commission, payment schedules, labour, reconciliation
      server/              API wrapper, request context, audit log, search, portal allow-list, people, backup/import
      ai/                  assistant loop and its tools
      config/              business settings (markup, GST, schedules) with defaults
  tests/
    unit/                  Vitest
    e2e/run.mjs            23-step browser journey (demo data)
    e2e/people.mjs         logins managed in the database (needs Postgres)
  docs/                    this guide, deployment, admin guide, financial rules, limitations, Airtable audit
```

## 4. How a request flows (worked example)

Here is what happens when an estimator adds a line to an estimate:

1. **Browser.** `components/estimates/EstimateBuilder.tsx` (a client component) collects the form. It sends `POST /api/estimates/{id}/lines` with JSON.
2. **Middleware.** `src/middleware.ts` checks the session cookie signature. If there is no valid session, the request gets a 401 and never reaches the route.
3. **Route wrapper.** `app/api/estimates/[id]/lines/route.ts` is wrapped in `route("estimates.edit", handler)` from `lib/server/api.ts`. The wrapper:
   - blocks cross-site requests by checking that Origin matches the host;
   - refuses bodies over 256 KB;
   - loads the session again and checks the user still exists, is active and has the same role;
   - checks the permission `estimates.edit` for that role;
   - turns errors into safe JSON: validation issues become 400, known problems use their own status, and anything else becomes a generic 500 that leaks no internals.
4. **Validation.** `LineInput.parse(body)` from `lib/domain/estimates.ts` (zod) rejects bad input, such as wrong types or negative quantities.
5. **Business rules.** `assertEditable(estimate)` refuses edits to a locked (approved) quote. `lineFields()` converts the input into stored fields. Money is always stored in **integer cents**.
6. **Data.** `getRepo().create("estimateLines", …)` goes through the Repository, whatever store is behind it.
7. **Audit.** `audit(session, {...})` records who did what, with before and after values. In Postgres mode it is stored permanently.
8. **Response.** The route returns JSON. The client calls `router.refresh()`, so the server component reloads and recalculates totals with the same finance functions.

Every write in the app follows this same pattern: **wrapper → zod → domain rule → repository → audit**.

## 5. The data model

- **`lib/data/entities.ts`** lists every entity, such as customers, enquiries, estimates, estimateLines, projects, payments and costItems. For each one it gives the friendly field names and a field *kind*: text, currency, number, date, select, links, checkbox or computed.
  - Currency fields are integer cents.
  - Links are arrays of record ids.
  - Computed fields are read-only. Writing one throws an error in every store.
- **`lib/data/repository.ts`** defines the interface the whole app uses:

  ```ts
  interface Repository {
    list(entity, { where, sort, limit }) ; get(entity, id) ; create(entity, data) ; update(entity, id, data)
  }
  ```

  There is deliberately **no delete**. Records are archived by status instead, so history is never lost.
- **`validateWrite()`** applies the same write rules in every store: only known fields, no writes to computed fields, cents must be integers, and dates must be YYYY-MM-DD.
- **Record ids** look like Airtable's (`rec` plus 14 characters). Records imported from Airtable keep their ids, so links between them still work.

### The three stores

| Store | File | Used for |
|---|---|---|
| Postgres | `lib/data/postgres/repository.ts` | Live. One table `atlas_records(entity, id, created_time, updated_time, data jsonb)` holds every record. Because the data model lives in code, adding a field needs no database migration. Updates use `data = data \|\| $patch`, so two people saving different fields don't overwrite each other. Other tables: `atlas_audit` (permanent audit log), `atlas_users` (logins), `atlas_imports` (import history). All tables are created on first use. |
| Airtable | `lib/data/airtable/client.ts` + `mapper.ts` | The old base during the changeover. Works by field id, queues and retries requests, and caches reads for 30 seconds. |
| Memory | `lib/data/memory/repository.ts` + `fixtures.ts` | Demo mode and tests. Fictional data only: "Demo" surnames, example.com emails and 0491 570 xxx phone numbers. |

The store is chosen by `ATLAS_DATA_SOURCE` (`postgres` | `airtable` | anything else = demo) in `lib/server/context.ts`.

## 6. Money

All money logic is in `lib/finance/`. These are pure functions with no database or network calls, so they are easy to test and are reused everywhere: screens, quotes, the portal and the AI assistant.
- Amounts are integer cents. Rounding happens in one place.
- The supplier costs typed in usually include GST. The finance engine converts them to ex GST for costing, applies markup (30% by default) and an optional commission, then adds GST for the customer price.
- Payment schedules (10/30/30/20/10 by default) are built so the stages always add up exactly to the contract total. Any leftover cent goes on the last stage.
- `estimateChecks.ts` blocks a quote from being approved when something important is missing. Examples are unchecked quantities or lines with no price.
- Approving a quote stores a **snapshot** of the priced quote. The printable quote, customer acceptance and payment stages all use that snapshot, so later price changes can't alter a quote that has already been sent.

The full rules are in `docs/FINANCIAL_RULES.md`.

## 7. Who can see what

- **Roles:** owner, manager, sales, supervisor, worker and customer. Each role is mapped to a set of permissions in `lib/auth/roles.ts`, for example `estimates.edit`, `costs.view` and `users.manage`.
- **Three gates:**
  - the middleware, which checks there is a session at all;
  - `requirePage(perm)` on every page;
  - `route(perm, …)` on every API.
- **Sessions:** HMAC-signed cookies that are httpOnly and Secure, and last 12 hours. On every request the server also checks that the login still exists, is active and has the same role. That means switching someone off or changing their role takes effect on their next click.
- **Logins** come from three places, in order of priority:
  1. the owner set in host variables (`ATLAS_OWNER_EMAIL`, `ATLAS_OWNER_PASSWORD`);
  2. the optional `ATLAS_USERS_JSON`;
  3. people added in the app under Settings → People and logins, stored in `atlas_users` with scrypt password hashes.
- **Customers** see only an explicit allow-list of fields (`lib/server/portal.ts`). Browser tests check the raw page payload to confirm that internal costs, notes and other customers' ids never appear in it.
- **Workers** never receive money fields. This is enforced on the server, not just hidden on screen.

## 8. Pages and the user interface

- Each page is a **server component**. It checks permission, loads data from the repository, does its calculations, and passes plain values to a **client component** for interaction. The cost library type-ahead is an example: `EstimateBuilder` receives the cost list and searches it in the browser as you type.
- The interface is mobile-first:
  - Touch targets are at least 44 px.
  - Grids use `min-w-0` on their children, so nothing forces the page wider than a phone. The e2e test checks for horizontal scroll on 8 pages.
- Actions that touch money, contracts or access always ask for confirmation. These include approving a price, recording acceptance, marking a payment received, switching a login off and replacing data on import.

## 9. The AI assistant

`lib/ai/` runs a small tool loop against the Anthropic Messages API:
- The model gets only the tools allowed for the signed-in role, and every tool re-checks permission on the server.
- Tools **read** through the same repository and finance functions as the rest of the app, so they can't contradict the screens.
- The model can only **propose** a task or follow-up. A person presses Confirm, and the normal API route saves it with its own checks and audit entry.
- The system prompt forbids inventing customers, amounts or statuses.
- There is a rate limit of 20 questions per 10 minutes per person.

## 10. Moving off Airtable (import and backup)

- **Settings → Backup and import** (owner only) has two parts:
  - **Download backup.** Every record goes into one JSON file (`{"format":"atlas-export","version":1,"entities":{…}}`).
  - **Import.** This reads an ATLAS backup, or an Airtable export with records grouped by table id or name, in the shape the Airtable API or connector returns them. You get a preview first. The import is all-or-nothing, and you can run it again safely. You choose to either keep ATLAS's version of a record or replace it with the file's version.
- Airtable is only ever *read* to make the export file. ATLAS never writes to it in Postgres mode.

## 11. How to extend it

| Task | Steps |
|---|---|
| Add a field | Add it to the entity in `entities.ts`, show it on the page, and accept it in the zod schema of the route that saves it. In Postgres mode no database migration is needed. |
| Add a new kind of record | Add an entity in `entities.ts`. Add domain rules and a zod schema in `lib/domain/`. Add `app/api/<thing>/route.ts` wrapped in `route(perm, …)` and calling `audit()`. Add a page under `app/(staff)/`. Add a nav item in `components/shell/nav.ts` with its permission. |
| Add a permission | Add it to `PERMISSIONS` in `roles.ts` and give it to the right roles. Use it in `route()` and `requirePage()`. |
| Change business numbers (markup, GST, schedules) | Use the `ATLAS_SETTINGS_JSON` override, or change the defaults in `lib/config/settings.ts`. Never hard-code them in a page. |
| Add an integration (QuickBooks, email) | Put it behind an adapter in `lib/`, keep its keys server-only, and report "not connected" until it has really been authenticated and tested. |

## 12. Rules the code follows (copy these for a similar project)

1. **Never trust the browser.** Check every permission and every money calculation on the server.
2. **One way to touch data:** the Repository. No page or route talks to a database directly.
3. **Money in integer cents.** Use one pure finance module, and test it first.
4. **No hard deletes.** Archive records, and audit every change with before and after values.
5. **Lock what the customer saw.** Store a snapshot on approval, and drive acceptance and payments from it.
6. **Validate every input with a schema** before running any logic.
7. **Secrets stay on the server.** Use `server-only` modules, and keep tokens and keys out of the client bundle.
8. **Ask before anything irreversible**, and say plainly when something isn't connected or tested.
9. **Fictional data in demos and tests**, so the code can be public.
10. **Test the real journey in a real browser** against the production build, including leak checks on raw page data.

## 13. Running it

```bash
cd atlas && npm ci
npm run typecheck && npm test        # unit tests (Postgres tests run if TEST_DATABASE_URL is set)
npm run build
ATLAS_ALLOW_DEMO_LOGINS=1 ATLAS_SESSION_SECRET=$(openssl rand -hex 32) npm start
# demo logins: owner@example.com etc., password atlas-demo-2026
BASE_URL=http://localhost:3000 npm run e2e
```

For live use with its own database, see `docs/DEPLOYMENT.md` (Render one-tap deploy).
