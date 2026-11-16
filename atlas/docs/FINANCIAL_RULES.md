# ATLAS financial rules

Every money calculation in ATLAS goes through `src/lib/finance/`. Dashboards, quotes, the AI assistant and the portal all call the same functions, so a number can't mean different things on different screens. All values below are defaults from `src/lib/config/settings.ts` and can be changed by the owner.

## Money

- Money is stored and calculated as **integer cents**. Airtable currency fields (dollars) are converted on the way in and out by `src/lib/data/mapper.ts`.
- Rounding happens once per calculated amount, to the nearest cent.

## GST (10%)

- Costs are **ex GST** inside the pricing engine. Supplier prices recorded inc GST (the Cost Library default) are converted with `exGst()` before use.
- GST is added once, on the final ex-GST sell price: `sellIncGst = sellExGst + round(sellExGst × 10%)`.
- **Airtable difference (audit finding):** the existing Estimates formulas apply markup to a GST-inclusive cost base, and Actual Costs are recorded inc GST. ATLAS writes new estimate lines with `Net Cost Pricing = true` and `Input GST Rate = 0.1` so the Airtable `Line Cost` formula also lands on ex-GST cost, and sets `Pricing Basis = "Net costs + GST"`. Older estimates keep `Legacy – review`.

## Markup vs margin

- Markup is on cost. Default **30%**. `$10,000 cost → $13,000 ex GST → $1,300 GST → $14,300 inc GST`.
- Margin is profit ÷ sell price. A 30% markup is a **23.08%** margin. ATLAS always labels which one it is showing.
- Manager overrides outside the margin band (default 15% to 45%) are flagged and need owner approval with a reason.

## Cost build-up

`direct costs (materials, labour, subcontractors, equipment, delivery, disposal, permits, consumables, other)`
`+ overhead (fixed + rate × direct)`
`+ contingency (rate × direct + overhead)`
`= cost base` → `× (1 + markup)` = recommended price ex GST.

Labour is costed on **person-hours** (crew size × hours). Crew-hours and days are shown for scheduling only. Labour is written to Airtable as priced estimate lines (Cost Type `Labour`) because the existing `Estimated Labour Cost` field is not included in the `Line Cost` rollup.

## Marketing commission (6%)

- Base is configurable: **invoice total inc GST** (default, matches the agency agreement as recorded) or revenue ex GST. `$14,300 × 6% = $858`.
- Treatment is configurable: **absorb** (comes out of profit, price unchanged) or **pass through** (price grossed up so profit is preserved).
- Only applies to jobs flagged as marketing-sourced.

## Payment schedules

- Every schedule is split in basis points and the **last stage takes the rounding remainder**, so stages always sum exactly to the contract price inc GST.
- Presets: historical **50/25/15/10** and **10/30/30/20/10**. Default for new quotes: 10/30/30/20/10.
- ATLAS warns when a deposit is over **10%**. The NSW Home Building Act 1989 limits deposits on residential building work; confirm the exact rule for each contract with your advisor. ATLAS does not give legal advice.
- Payment status is derived, not typed: `scheduled → due → overdue`, `part_paid`, `paid`.

## Variations

- Only **Approved** variations change the contract value. `Sent for Approval` is reported separately as pending. Declined variations are ignored.

## Actuals and profit

- Reconciled actual cost per component = itemised actual costs + labour from **submitted** timesheets + unitemised adjustment. This mirrors the Airtable `Reconciled Actual Cost` formula.
- Actual profit is only shown when the component is Completed **and** has final revenue (or is the shared-costs component). Otherwise ATLAS shows "not final yet" rather than a guess.
- Component revenue is treated as **ex GST**. This is an assumption from the data and needs owner confirmation (see audit).

## Quality checks before an estimate can be approved

Blocking: priced lines, materials, labour, disposal for excavation/walls/paving/driveways/drainage, verified quantities, reviewed AI suggestions, customer scope, resolved exclusions.
Warnings: measurements linked, delivery, supplier prices older than 12 months, unconfirmed prices, productivity outliers.
