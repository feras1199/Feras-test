# Known limitations

What ATLAS does not do yet, and what is waiting on a decision. Nothing here is hidden behind a button that pretends to work. Last reviewed 10 November 2026.

## Waiting on the owner

| Item | Effect until then |
|---|---|
| `ANTHROPIC_API_KEY` and a transcription key | Ask ATLAS and the voice-note write-up say they are not set up. They have only ever run against a scripted stand-in, never a real model, so expect some fixing on the first real run. |
| File storage account (for example Cloudflare R2 or S3) | Photos, recordings and PDFs are kept inside the database, which includes 1 GB on the current plan. Settings > Backup and import shows how much is used. |
| Is component revenue ex GST or inc GST? | ATLAS assumes ex GST. If it's inc GST, profit on finished components is overstated by the GST. |
| Which Airtable records to bring across | Only the price lists have been prepared for import. Almost every customer and project in the old base is test data. |
| Removing the live-Airtable mode | The code can still run directly on the old Airtable base. Since the decision to leave Airtable this is unused; removing it is a one-way change and needs a yes. |

## Not built yet

- **QuickBooks Online.** The adapter is a placeholder that reports "not connected". ATLAS never creates invoices; "Raise now" only marks a stage as due and reminds you to invoice from QuickBooks.
- **Email, SMS and calendar.** Nothing is sent from ATLAS. Customer updates are published to the portal only. Contact is logged by hand.
- **Part payments.** A payment stage is either unpaid or paid in full. An amount received against a stage can't be recorded.
- **Editing business settings in the app.** Markup, GST, payment schedules and the labour rate are set with `ATLAS_SETTINGS_JSON` on the server.
- **Customer self-service password reset and invitations.** Customer logins are added by the owner.
- **Timesheet approval.** Submitted hours count straight away.
- **Putting photos and recordings back from the app.** The files download is restored with `npm run restore-files` (see the deployment guide), not from a screen.
- **A public enquiry form.** Enquiries are typed in by staff.

## Technical

- **Single server process.** Login throttling and the assistant's rate limit are held in memory. Run one always-on instance (see the deployment guide). Two instances would each keep their own counts. Quote acceptance and quote numbering are safe across instances: they lock in the database.
- **Login throttling trusts the forwarded address.** Failed sign-ins are counted per email and IP address, and the IP comes from the `X-Forwarded-For` header. Whether a caller can fake that header depends on the host's proxy; this has not been checked on Render.
- **The upload size limit trusts the size the browser declares.** A signed-in person could send an oversized upload without declaring its size and use up server memory. Refusing such requests outright was left out because the host's proxy may forward ordinary requests the same way; it needs checking on Render first.
- **Lists load whole tables.** Pages read every record of a type and filter in the app. This is fine for hundreds of records and will need paging or indexes somewhere in the thousands of estimate lines or timesheets.
- **Ask ATLAS answers arrive all at once.** A long answer can take up to two minutes with nothing on screen but the waiting state.
- **Quotes accepted on builds before 10 November 2026.** Quote acceptance is now all-or-nothing, but it does not repair a quote that an older version left with a short payment schedule. ATLAS had not been put into real use before this date, so none is expected; check any quote accepted on an older build.
- **Dependency advisories.** `npm audit` still lists PostCSS (build-time only, inside Next.js; it processes ATLAS's own stylesheet, not user input). It goes away with Next.js 16, which is a larger upgrade.
- **Linting** isn't configured. TypeScript strict mode, unit tests and browser tests run instead, automatically on every pull request (`.github/workflows/atlas.yml`).
