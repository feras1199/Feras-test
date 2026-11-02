# Deploying ATLAS

ATLAS is a standard Next.js 15 app. It needs Node 20 or newer and one long-running server process.

## 1. Choose a host

**Recommended for now: one always-on Node server** (Render, Railway, Fly.io, or a small VPS) in the Sydney region.

Why not serverless (e.g. Vercel) yet: three things are held in server memory and would reset on every cold start or be split across instances:

- the audit log shown on the Audit page (it is also written to the server log as JSON lines, so a log drain keeps it),
- login throttling and the assistant's per-person rate limit,
- the 30-second Airtable read cache (harmless if lost).

Once the additive "Atlas Audit Log" table is approved in Airtable, the audit log moves there and serverless hosting becomes fine.

## 2. Environment variables

| Variable | Required | What |
|---|---|---|
| `ATLAS_DATA_SOURCE` | yes | `airtable` for the live base. Anything else runs the fictional demo store. |
| `AIRTABLE_TOKEN` | yes | Personal access token. Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`. Access: only the Whispering Leaf base. |
| `AIRTABLE_BASE_ID` | yes | `appygHLmJTH1ew5r6` |
| `ATLAS_SESSION_SECRET` | yes | 32+ random bytes, e.g. `openssl rand -hex 32`. Changing it signs everyone out. |
| `ATLAS_USERS_JSON` | yes | Staff and customer logins, see the admin guide. |
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
