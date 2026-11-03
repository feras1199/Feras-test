# Deploying ATLAS

ATLAS is a standard Next.js 15 app. It needs Node 20 or newer and one long-running server process.

## 0. Recommended: ATLAS's own database (no Airtable)

ATLAS can keep all its data in its own Postgres database (`ATLAS_DATA_SOURCE=postgres`). Airtable is then only a source you import from once; ATLAS never writes to it.

**One-tap setup on Render.** The `render.yaml` at the repo root creates the web service and a Postgres database together. Open
`https://render.com/deploy?repo=https://github.com/feras1199/Feras-test/tree/claude/project-thread-wby4er`
(use `main` instead of the branch once merged), enter the owner email and a password of 12+ characters when asked, and deploy. Then:

1. Sign in with that email and password.
2. Settings → **Backup and import** → choose the Airtable export file → **Check the file** → **Import new records**.
3. Download a backup from the same screen and keep it somewhere safe.

**Cost and backups (checked Nov 2026, confirm on Render's pricing page):** a free Render Postgres is deleted 30 days after creation and has no backups, so the blueprint uses the smallest paid plan (`0.1c-256mb`). Render quoted about US$13/month for a Starter web service plus this database in July 2026. Whatever the plan includes, use the **Download backup** button regularly (weekly at least); the file can be imported back into a fresh database.

**How data is stored.** One table, `atlas_records(entity, id, created_time, updated_time, data jsonb)`, holds every record; the field list stays in `src/lib/data/entities.ts`, so adding a field needs no database migration. `atlas_audit` keeps the audit log permanently and `atlas_imports` records each import. Tables are created automatically on first use.

**Importing.** The import reads two file types: an ATLAS backup, or an Airtable export (`{"format":"airtable","tables":{"<table id or name>":[records…]}}`, records as the Airtable API or the Airtable connector return them). Record ids are kept, so links between imported tables still work. Re-running is safe: "Keep the ATLAS version" only adds records ATLAS doesn't have; "Replace" overwrites matching records with the file's copy. An import is all-or-nothing.

**Calculated fields.** Values Airtable calculated with formulas (for example a cost item's effective price) are imported as a snapshot and are not recalculated; ATLAS's own pricing code does its own calculations.

## 1. Choose a host

**Recommended for now: one always-on Node server** (Render, Railway, Fly.io, or a small VPS) in the Sydney region.

Why not serverless (e.g. Vercel) yet: three things are held in server memory (with the Postgres database the audit log is stored there permanently, so only the last two apply) and would reset on every cold start or be split across instances:

- the audit log shown on the Audit page (it is also written to the server log as JSON lines, so a log drain keeps it),
- login throttling and the assistant's per-person rate limit,
- the 30-second Airtable read cache (harmless if lost).

Once the additive "Atlas Audit Log" table is approved in Airtable, the audit log moves there and serverless hosting becomes fine.

## 2. Environment variables

| Variable | Required | What |
|---|---|---|
| `ATLAS_DATA_SOURCE` | yes | `postgres` for ATLAS's own database (recommended), `airtable` for the old base. Anything else runs the fictional demo store. |
| `DATABASE_URL` | with postgres | Postgres connection string. Render fills it in from the blueprint. |
| `DATABASE_POOL_MAX` | no | Database connections per server, default 5. |
| `ATLAS_OWNER_EMAIL` / `ATLAS_OWNER_PASSWORD` | no | The owner's login without making a password hash (password 12+ characters). Other people still go in `ATLAS_USERS_JSON`. |
| `AIRTABLE_TOKEN` | no | Airtable personal access token. **Postgres mode:** optional, scope `data.records:read` only; if set and the Cost Library is empty when the server starts, ATLAS copies the Cost Library, Productivity Rates and Omission Rules from Airtable once (read only). The owner can do the same from Settings > Backup and import by pasting a token, which is used once and not stored. **Airtable mode:** required, scopes `data.records:read`, `data.records:write`, `schema.bases:read`. Access: only the Whispering Leaf base. |
| `AIRTABLE_BASE_ID` | no | Defaults to `appygHLmJTH1ew5r6` (Whispering Leaf). |
| `ATLAS_SESSION_SECRET` | yes | 32+ random bytes, e.g. `openssl rand -hex 32`. Changing it signs everyone out. |
| `ATLAS_USERS_JSON` | yes, unless only the owner logs in | Staff and customer logins, see the admin guide. |
| `ATLAS_SETTINGS_JSON` | no | Overrides for markup, GST, schedules, labour rate etc. Partial JSON merged over the defaults. |
| `ATLAS_LEGACY_PAYMENT_AUTOMATIONS_OFF` | no | Set to `1` **only after** the old Airtable payment automations are turned off. Until then, accepting a quote in ATLAS is blocked in Airtable mode so payment stages are never created twice. |
| `ANTHROPIC_API_KEY` | no | Turns on "Ask ATLAS". Without it the page says the assistant is not set up. |
| `ATLAS_AI_MODEL` | no | Defaults to `claude-opus-5-5`. |
| `QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` | no | Reserved. The QuickBooks connection is not built yet (see known limitations). |
| `ATLAS_ALLOW_DEMO_LOGINS` | never in production | Enables the demo accounts. Only for test environments. |
| `ATLAS_MEMORY_PERSIST` | no | `1` keeps the demo store in `data/local-store.json`. Demo mode only. |

Secrets live only in the host's environment settings. Nothing secret is sent to the browser; the Airtable token and Anthropic key are read on the server only.

## 3. Build and start

```bash
npm ci
npm run typecheck && npm test
npm run build
npm start               # listens on $PORT or 3000
```

Put the app behind HTTPS (all the hosts above do this). Session cookies are marked `Secure` in production, so plain HTTP logins will not stick.

## 4. Go-live checklist

1. Back up the Airtable base (Airtable snapshot, plus a CSV export of Customers, Enquiries, Estimates, Estimate Items, Projects, Payments).
2. Set the variables above. Leave `ATLAS_LEGACY_PAYMENT_AUTOMATIONS_OFF` unset.
3. Sign in as the owner and walk through: Today, a customer, an estimate (read only), a project, Finance. Check the figures against Airtable.
4. Decide on the payment automations. When they are off in Airtable, set `ATLAS_LEGACY_PAYMENT_AUTOMATIONS_OFF=1` and restart.
5. Add staff logins, then customer logins (each linked to their Airtable customer record).
6. Optional: add `ANTHROPIC_API_KEY` and try a few questions on Ask ATLAS.

## 5. Rolling back

ATLAS never hard-deletes Airtable records (removed lines are excluded, payments archived). To roll back, stop the ATLAS server; the base keeps working as before. Anything ATLAS changed is listed in the audit log with before and after values.

## 6. Schema changes in Airtable

If someone adds or renames fields, run `AIRTABLE_TOKEN=... node scripts/gen-schema.mjs` and then `npm test`. A test fails if any field ATLAS relies on is missing, before it can break a page.
