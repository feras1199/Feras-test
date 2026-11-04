# Known limitations

What ATLAS does not do yet, and what is waiting on a decision. Nothing here is hidden behind a button that pretends to work.

## Waiting on the owner

| Item | Effect until then |
|---|---|
| Airtable personal access token | ATLAS has only been tested against the fictional demo store and a read-only copy of the schema. Live reads and writes are untested. |
| Decision on the four Airtable payment automations | Accepting a quote in ATLAS is blocked in Airtable mode, so payments are never created twice. |
| Approval for additive tables (Atlas Users, Audit Log, Settings) | Users and settings come from server variables; the audit log lives in server logs and resets on the Audit page when the server restarts. |
| Is component revenue in Airtable ex GST or inc GST? | ATLAS assumes ex GST. If it's inc GST, profit on finished components is overstated by the GST. |
| Clean-up of DEMO / QA TEST records in the live base | Those records will appear in ATLAS lists. Nothing is deleted without a backup and your approval. |

## Not built yet

- **QuickBooks Online.** The adapter is a placeholder that reports "not connected". ATLAS never creates invoices; "Raise now" only marks a stage as due and reminds you to invoice from QuickBooks.
- **Email, SMS and calendar.** Nothing is sent from ATLAS. Customer updates are published to the portal only. Contact is logged by hand.
- **File and photo uploads.** The Project Files table isn't wired up.
- **Customer self-service password reset and invitations.** Customer logins are added by the admin.
- **Timesheet approval.** Airtable only has a Submitted checkbox, so submitted hours count straight away.
- **Editing settings and users in the app.** Needs the additive tables above.

## Technical

- **Single server process.** Login throttling, the assistant's rate limit, the Audit page and the Airtable read cache are in memory. Run one always-on instance (see the deployment guide). Two instances would each keep their own copies.
- **Airtable rate limit.** Requests are queued at about 4–5 per second with retries on 429. Pages that load many tables (Finance) can take a second or two on a large base. Lists load whole tables; this is fine at the base's current size (hundreds of records) and would need paging or caching above several thousand rows per table.
- **The assistant has only been tested with a simulated model.** Its tool calls, permission filtering and confirm-before-save flow are unit tested with a fake client, and the "not set up" and rejected-key paths were checked in the browser. No live model answers have been checked yet, because no API key was available.
- **Dependency advisories.** `npm audit` still lists PostCSS (build-time only, inside Next.js; it processes ATLAS's own stylesheet, not user input). It goes away with Next.js 16, which is a larger upgrade.
- **Linting** isn't configured (`next lint` asks interactive setup questions). TypeScript strict mode, unit tests and browser tests run instead.
