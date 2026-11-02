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

Until the additive "Atlas Users" table is approved in Airtable, logins live in the `ATLAS_USERS_JSON` server variable:

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
- It cannot send messages, raise invoices, take payments, approve anything or change records. It can suggest a task or a follow-up date; nothing is saved until the person presses Confirm, and that save goes through the normal checks and audit log.
- If the model's safety checks decline a request, the API retries it on Anthropic's recommended fallback model automatically (`fallbacks: "default"`). If that also declines, the person sees "I can't help with that request."
- Each person is limited to 20 questions per 10 minutes.

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
