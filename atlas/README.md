# ATLAS

The operating system for Whispering Leaf Landscaping & Construction. A Next.js app with its own Postgres database (data imported once from the old Airtable base), and a server-side API that checks permissions and logs every change. It can still run directly on the Airtable base during the changeover.

## Run it locally (fictional demo data)

```bash
npm install
npm run dev            # http://localhost:3000
```

Sign in with any demo account shown on the login page (password `atlas-demo-2026`). Demo mode uses fictional data only and never touches Airtable.

## Run on ATLAS's own database (recommended)

```
ATLAS_DATA_SOURCE=postgres
DATABASE_URL=postgres://user:pass@host:5432/atlas
ATLAS_SESSION_SECRET=...        # openssl rand -hex 32
ATLAS_OWNER_EMAIL=you@yourdomain.com.au
ATLAS_OWNER_PASSWORD=...        # 12+ characters
```

Tables are created on first use. Bring data in from Settings → Backup and import. On Render, `render.yaml` sets all of this up; see `docs/DEPLOYMENT.md`. Postgres tests run when `TEST_DATABASE_URL` is set (they recreate the ATLAS tables in that database).

## Connect to Airtable (old base, during the changeover)

Create `.env.local` from `.env.example`:

```
ATLAS_DATA_SOURCE=airtable
AIRTABLE_TOKEN=pat...           # scopes: data.records:read, data.records:write, schema.bases:read
AIRTABLE_BASE_ID=appygHLmJTH1ew5r6
ATLAS_SESSION_SECRET=...        # openssl rand -hex 32
ATLAS_USERS_JSON=[{"id":"u1","name":"...","email":"...","role":"owner","passwordHash":"..."}]
```

Generate a password hash with `npm run hash-password -- 'a long password'`. Demo logins are disabled automatically when Airtable is the data source.

If fields are added or renamed in Airtable, run `AIRTABLE_TOKEN=... node scripts/gen-schema.mjs` and then `npm test`. A test fails if any field ATLAS relies on is missing.

## Checks

```bash
npm run typecheck
npm test                 # unit tests (finance engine, data mapping, permissions, CRM)
npm run build && ATLAS_ALLOW_DEMO_LOGINS=1 ATLAS_SESSION_SECRET=$(openssl rand -hex 32) npm start &
BASE_URL=http://localhost:3000 npm run e2e   # browser tests (Playwright); start a fresh server each run
```

## Layout

| Path | What |
|---|---|
| `src/lib/finance` | Pricing, GST, commission, payment schedules, labour, reconciliation. Pure functions, fully tested. |
| `src/lib/data` | Entity mapping, Airtable client (field IDs, rate limit, retries), in-memory demo store |
| `src/lib/auth` | Roles and permissions, signed sessions, password hashing, field redaction |
| `src/lib/domain` | CRM, estimates, inspections, projects: validation and calculations built on the finance engine |
| `src/lib/server` | Request context, API wrapper, audit log, search, portal allow-list |
| `src/lib/ai` | Ask ATLAS: role-filtered read tools, confirm-before-save suggestions, the model loop |
| `src/app` | Pages and API routes |
| `docs/` | Airtable audit, schema snapshot, financial rules |

## Docs

| Doc | For |
|---|---|
| `docs/DEPLOYMENT.md` | Hosting, environment variables, go-live checklist, rollback |
| `docs/ADMIN_GUIDE.md` | Roles, adding people, business settings, audit log, the assistant |
| `docs/KNOWN_LIMITATIONS.md` | What isn't built yet and what is waiting on a decision |
| `docs/FINANCIAL_RULES.md` | How every number is calculated |
| `docs/AIRTABLE_AUDIT.md` | Issues found in the existing base |
