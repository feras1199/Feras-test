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

**Cost and backups (checked 4 Nov 2026 on render.com/pricing):** the blueprint uses a Starter web service (US$7/month, always on; the free plan sleeps after 15 idle minutes and takes about a minute to wake) and the smallest paid database (`0.1c-256mb`, US$6/month, 1 GB included then US$0.30/GB). A free Render Postgres is deleted 30 days after creation and has no backups, so don't use it for real data. Paid databases get point-in-time recovery (the last 3 days on the Hobby workspace plan, 7 days on Pro). On top of that, take both downloads on Settings → Backup and import weekly:

- **Download records (.json)**: every record, the logins added in the app (with scrambled passwords) and the audit log. Import it on the same screen of a fresh database to get all of that back.
- **Download photos and recordings (.tar)**: every stored file plus a `manifest.json` saying which record each belongs to. To put them back, import the records file first, then run `DATABASE_URL=… npm run restore-files -- atlas-files-YYYY-MM-DD.tar` from the `atlas` folder. Files already in the database are left alone.

Photos and recordings live in the database, so they count towards its 1 GB. The Backup and import screen shows how much is used.

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
| `ANTHROPIC_API_KEY` | no | Turns on "Ask ATLAS" and the AI write-up of site visit voice notes. Without it those features say they are not set up. |
| `DEEPGRAM_API_KEY` | no | Speech-to-text for voice notes (recommended: labels who is speaking). Model `nova-3` unless `ATLAS_DEEPGRAM_MODEL` is set. |
| `GOOGLE_MAPS_API_KEY` | no | Address suggestions in the Street address box (Google Places API (New), Autocomplete). Restrict the key to the Places API (New). Without it ATLAS uses the free OpenStreetMap lookup (Photon), which is less complete for Australian house numbers. |
| `ATLAS_ADDRESS_LOOKUP` | no | Set to `off` to stop sending typed addresses to any outside service. |
| `OPENAI_API_KEY` | no | Alternative speech-to-text if there is no Deepgram key. Model `gpt-4o-mini-transcribe` unless `ATLAS_TRANSCRIBE_MODEL` is set. Used for transcription only. |
| `ATLAS_AI_DEMO` | no | `1` turns on labelled stand-ins for transcription and the write-up, **only** in demo-data mode, so the flow can be tested without keys. Ignored with real data. |
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

1. Deploy with the blueprint (section 0) and check `https://<your site>/api/health` answers `{"ok":true}`. That address is what Render watches; it fails if ATLAS can't reach its database.
2. Sign in as the owner and import the price lists (Settings → Backup and import).
3. Add staff under Settings → People and logins.
4. Run one made-up job end to end: customer, site visit, estimate, approve, send, accept, mark the deposit paid. Check the figures by hand.
5. Take both backup downloads and keep them somewhere safe.
6. Optional: add `ANTHROPIC_API_KEY` and a transcription key, then try Ask ATLAS and one voice note. These have not run against the real services before, so check the results closely.

## 5. Rolling back

- **A bad code change:** in Render, redeploy the previous commit. Data is untouched.
- **Bad data:** Render's point-in-time recovery restores the database to a moment in the last 3 days (Hobby) or 7 days (Pro). For anything older, import the latest records backup into a fresh database and run `restore-files`.
- Nothing in ATLAS is hard-deleted, and the audit log lists every change with before and after values, so a single wrong edit can usually be put right by hand.

## 5a. Automatic checks

Every pull request that touches `atlas/` runs the type check, the unit tests (with a real Postgres database), the production build and every browser test suite (`.github/workflows/atlas.yml`). Run the same locally with `npm run typecheck && npm test && npm run build && npm run e2e:all`; set `TEST_DATABASE_URL` and `E2E_DATABASE_URL` to a throwaway database to include the database tests.

## 6. Schema changes in Airtable

If someone adds or renames fields, run `AIRTABLE_TOKEN=... node scripts/gen-schema.mjs` and then `npm test`. A test fails if any field ATLAS relies on is missing, before it can break a page.
