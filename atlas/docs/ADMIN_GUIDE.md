# ATLAS admin guide

For the owner or whoever looks after ATLAS. Day-to-day use doesn't need any of this.

## Who can do what

Permissions are checked on the server for every page and every API call. Hiding a button is never the only protection.

| Role | Can | Can't |
|---|---|---|
| Owner / Admin | Everything, including approving quotes outside the margin band (with a reason), settings and users | Use the customer portal |
| Manager | Everything except changing settings and managing users | Settings, users |
| Sales / Estimator | Customers, pipeline, inspections, build estimates, see costs and margins, draft variations | Approve or send quotes, approve variations, finance |
| Supervisor | See customers and inspections, edit the schedule, record costs, see everyone's timesheets, draft variations | Costs/profit totals, finance, estimates |
| Worker | Today, their projects (no money), checklists, their own timesheets, Ask ATLAS | Customers, costs, pay rates, profit, finance |
| Customer | Their own portal: progress updates, upcoming schedule, their payments, their quotes and accepting them | Anything internal: costs, notes, other customers |

## Adding and removing people

**With ATLAS's own database (recommended):** Settings → **People and logins**. The owner can do all of this from a phone:
- Add someone with a role, and give them the starting password shown on screen. It is shown only once.
- Change a role. The person is signed out and sees only what the new role allows.
- Reset a password, or switch a login off. Switching off signs them out straight away, and their records stay.
- Link a customer login to that customer's record.

Anyone added this way can change their own password under **My account**. The owner's first login comes from `ATLAS_OWNER_EMAIL` / `ATLAS_OWNER_PASSWORD` on the host, and can only be changed there. Logins are not included in the backup download; after restoring into a new database, add people again.

**Without the database (Airtable or demo mode)**, logins live in the `ATLAS_USERS_JSON` server variable:

```json
[
  { "id": "u-owner", "name": "Your Name", "email": "you@yourdomain.com.au", "role": "owner", "passwordHash": "scrypt$..." },
  { "id": "u-jo", "name": "Jo", "email": "jo@yourdomain.com.au", "role": "supervisor", "passwordHash": "scrypt$..." },
  { "id": "c-smith", "name": "Pat Smith", "email": "pat@example.com", "role": "customer", "customerId": "recXXXXXXXXXXXXXX", "passwordHash": "scrypt$..." }
]
```

- Make a password hash with `npm run hash-password -- 'the password'`. Never put plain passwords in the file.
- `id` must be unique and should never be reused for a different person.
- A customer login needs `customerId`, the Airtable record id of their row in Customers. They only ever see records linked to that customer.
- To remove someone, delete their entry or add `"active": false`, then restart. They are signed out on their next click, even if their cookie hasn't expired. Changing someone's role or linked customer also signs them out.
- Sessions last 12 hours.

## Price lists and site photos

- **Price lists from Airtable.** Settings > Backup and import > *Get your price lists from Airtable*. Paste an Airtable token with the `data.records:read` scope on the Whispering Leaf base and tap *Copy price lists from Airtable*. It copies the Cost Library, Productivity Rates and Omission Rules. Airtable is only read; the token is used once and not stored. Running it again only adds items ATLAS doesn't have yet, so edits made in ATLAS are kept. Choosing the exported `.json` file under *Import data* does the same without a token.
- **Photos and voice notes on site visits.** Open a site inspection. *Take or add photos* opens the camera or photo library; photos are shrunk on the phone (longest side 1600 px) before upload. *Record a voice note* records from the phone's microphone (the browser asks for permission the first time) until *Stop and save*, up to 15 minutes. They are stored in ATLAS's own database, only staff who can see inspections can open them, and *Remove* archives rather than deletes. They are not in the backup download yet, and voice notes are not transcribed yet.

## Cost Library

Menu > Cost Library. Search by name, supplier or code, or pick a category. Owners and managers can **Add an item** and **Edit** any item: name, price inc GST, unit, category, supplier, notes, and whether it is in use. Items are never deleted; switching one off moves it down the estimate suggestions. A price change records the date, who changed it, and an entry in the price history, and new estimate lines use the new price straight away. Lines already on an estimate keep the price they were added with.

## Voice notes written up by AI

On a site inspection, every voice note can be turned into text and the AI fills in the site-note boxes (what the customer wants, existing conditions, slope, drainage, services, risks, priorities, other notes, access) and writes a meeting summary. It runs by itself after each voice note is saved, or with *Write up voice notes*.

- It needs two keys on the server: a speech-to-text key (`DEEPGRAM_API_KEY`, or `OPENAI_API_KEY`) and `ANTHROPIC_API_KEY`. Settings shows which are present.
- It only fills empty boxes, or boxes that still hold its own earlier text. Anything a person typed is left alone, and the result says which boxes it kept.
- It is told to use only what was said and leave the rest blank. Read the boxes before relying on them; speech-to-text can mishear.
- The text of each voice note is under *What was said*. Every write-up is in the audit log.
- Rough cost: transcription is about US$0.20–0.40 per hour of audio at published third-party price summaries (Nov 2026; check the provider's own pricing page). Each write-up is one Claude request of a few thousand tokens; check Anthropic's pricing page for the current rate.

## Contact buttons

Customer, inspection and project pages show **Call**, **WhatsApp**, **Email** and **Map** buttons. Australian numbers are converted for WhatsApp (0412… becomes +61 412…). They are hidden for customers marked do-not-contact, except Map.

## Change requests

Anyone can ask Ask ATLAS for a change to ATLAS itself. It helps write the request up, the person confirms, and it lands in Settings > Change requests (also a task for the Owner). Ask ATLAS cannot change ATLAS, its settings or prices; requests are built by the developer once the owner approves them.

## Business settings

Defaults match what the Airtable base already uses: GST 10%, markup 30%, marketing commission 6% of the invoice inc GST (absorbed, not added to the price), margin band 15–45%, quotes valid 30 days, default payment schedule 10/30/30/20/10, deposit warning above 10%, payments due 7 days after raising, labour $45 per person-hour, 8-hour day.

To change any of them, set `ATLAS_SETTINGS_JSON` with only the values you want to change, then restart:

```json
{ "pricing": { "defaultMarkup": 0.32 }, "labour": { "defaultRatePerPersonHourCents": 5000 } }
```

Rates are fractions (0.32 = 32%) and money is in cents. If the settings are invalid, ATLAS shows an error on the first page load instead of quietly using a wrong number. The Settings page shows what is in force. Every schedule must add up to exactly 100% and the amounts always sum to the contract to the cent.

Changing settings affects new work only. Approved quotes keep the snapshot they were approved with.

## The audit log

Every change made through ATLAS (who, when, what, before and after) is listed on the Audit log page and written to the server log as a JSON line starting `{"type":"atlas.audit"`. The page shows what this server process has seen since it started; the server log is the permanent copy until the "Atlas Audit Log" table is approved.

## Ask ATLAS (the assistant)

- Turned on by setting `ANTHROPIC_API_KEY`. Usage is billed to that Anthropic account; each question typically makes 2–4 model calls.
- It reads records through the same permission rules as the person asking, so a worker's question never pulls in money.
- It cannot send messages, raise invoices, take payments, approve anything or change records on its own. It can suggest a task, a follow-up date, customer details, a new enquiry or estimate lines; nothing is saved until the person presses Confirm, and that save goes through the normal checks and audit log.
- If the model's safety checks decline a request, the API retries it on Anthropic's recommended fallback model automatically (`fallbacks: "default"`). If that also declines, the person sees "I can't help with that request."
- Each person is limited to 20 questions per 10 minutes.

### Sharing a PDF, photo or voice note

Tap 📎 to share a PDF or photo, or 🎙 to record a voice note, then say which job it's for ("This is for the Sample job, fill the estimate"). ATLAS reads it and suggests what to fill in, each on its own card with Confirm and Dismiss.

- **Customer details** (new customer, or the empty boxes on an existing one). Details already saved are never changed; if the file says something different, the card says so and you change it yourself if it's right. If the new customer looks like someone already in ATLAS, it shows the match instead.
- **Estimate lines** added to a draft estimate. Lines matched to the Cost Library use the library's price, never a price the AI made up. A line with no match only gets a price if that price is written in the file (the line's note says so); otherwise it stays at $0 and the estimate checks flag it. Every line is marked "AI suggested" with its quantity unchecked, so the estimate can't be approved until someone ticks each quantity as checked. Existing lines are never touched, and the customer scope is only written if that box is empty.
- What it accepts: PDFs up to 10 MB, photos (JPEG, PNG, WebP; phone photos are shrunk first), and voice recordings up to 15 minutes. Save Word or Excel files as PDF first. Up to 4 files per message and 6 per chat.
- Shared files are private to the person who shared them. They're kept in ATLAS's database (never deleted, like everything else) and appear in the audit log.
- PDFs and photos need `ANTHROPIC_API_KEY`. Voice notes also need a transcription key (`DEEPGRAM_API_KEY` or `OPENAI_API_KEY`), the same one site visits use.
- Rough cost (US dollars, Anthropic list price for Claude Opus 5.5 of $4 per million tokens in and $20 out, at the time of writing): a question about a short PDF or a photo is about 10 to 30 cents, because each page is read as text and as a picture and ATLAS usually makes 2 to 4 calls per question. A 30-page PDF is roughly 50 cents to $1 for the first question; follow-up questions within a few minutes are cheaper because the document is cached. Voice notes add the transcription cost (Deepgram charges well under 1 cent a minute). Check current prices with Anthropic and Deepgram before relying on these.

## Payment automations in Airtable

The base has four `Atlas P2 — Payment …` automations that create payment records. ATLAS also creates the payment stages when a quote is accepted. Running both would double up the payments, so in Airtable mode ATLAS refuses to accept quotes until you:

1. back up the base,
2. turn those automations off in Airtable,
3. set `ATLAS_LEGACY_PAYMENT_AUTOMATIONS_OFF=1` and restart.

Nothing in ATLAS changes the automations itself.

## When something looks wrong

- **A figure doesn't match Airtable:** check `docs/FINANCIAL_RULES.md`. The common causes are GST basis (Airtable actual costs are inc GST; ATLAS reports them ex GST) and unsubmitted timesheets (ATLAS only counts submitted ones).
- **"Airtable … expects" errors on save:** a field was renamed or its type changed in Airtable. Run the schema check in the deployment guide.
- **Everyone got signed out:** `ATLAS_SESSION_SECRET` changed, or `ATLAS_USERS_JSON` was edited.
