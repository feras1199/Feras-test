import { PageHeader } from "@/components/ui";
import { formatAud, formatPct } from "@/lib/finance/money";
import { markupToMargin } from "@/lib/finance/pricing";
import { dataSource, getSettings, requirePage } from "@/lib/server/context";
import { ROLE_LABELS, ROLE_PERMISSIONS, ROLES } from "@/lib/auth/roles";

export const metadata = { title: "Settings" };

function Row({ k, v, note }: { k: string; v: React.ReactNode; note?: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-stone-100 py-2 text-sm last:border-0">
      <dt className="text-stone-600">{k}</dt>
      <dd className="text-right font-medium">{v}{note && <span className="block text-xs font-normal text-stone-500">{note}</span>}</dd>
    </div>
  );
}

export default async function SettingsPage() {
  await requirePage("settings.view");
  const st = getSettings();
  const airtable = dataSource() === "airtable";
  return (
    <>
      <PageHeader title="Settings" subtitle="Business rules ATLAS uses for every calculation." />
      <p className="mb-4 rounded-xl bg-stone-100 p-3 text-sm text-stone-700">
        These values are set in the server configuration (ATLAS_SETTINGS_JSON). Editing them here needs the additive “Atlas Settings” table in Airtable, which is waiting on your approval.
      </p>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="card p-5">
          <h2 className="mb-2 font-semibold">Pricing</h2>
          <dl>
            <Row k="GST" v={formatPct(st.pricing.gstRate, 0)} />
            <Row k="Default markup on cost" v={formatPct(st.pricing.defaultMarkup, 0)} note={`= ${formatPct(markupToMargin(st.pricing.defaultMarkup))} gross margin`} />
            <Row k="Overhead allowance" v={formatPct(st.pricing.overheadRate, 0)} />
            <Row k="Contingency" v={formatPct(st.pricing.contingencyRate, 0)} />
            <Row k="Override margin band" v={`${formatPct(st.pricing.minMargin, 0)} – ${formatPct(st.pricing.maxMargin, 0)}`} note="Prices outside this need owner approval" />
            <Row k="Quote valid for" v={`${st.pricing.quoteValidityDays} days`} />
          </dl>
        </section>
        <section className="card p-5">
          <h2 className="mb-2 font-semibold">Commission and labour</h2>
          <dl>
            <Row k="Marketing commission" v={st.commission.enabled ? formatPct(st.commission.rate, 0) : "Off"} note={`on ${st.commission.base === "invoice_inc_gst" ? "invoice total inc GST" : "revenue ex GST"}, ${st.commission.treatment === "absorb" ? "absorbed from profit" : "added to the price"}`} />
            <Row k="Default labour rate" v={`${formatAud(st.labour.defaultRatePerPersonHourCents)} / person-hour`} />
            <Row k="Hours per crew day" v={st.labour.hoursPerDay} />
          </dl>
        </section>
        <section className="card p-5">
          <h2 className="mb-2 font-semibold">Payment schedules</h2>
          {Object.entries(st.payments.schedules).map(([key, sch]) => (
            <div key={key} className="mb-3">
              <p className="text-sm font-medium">{sch.name}{key === st.payments.defaultSchedule && <span className="chip ml-2 bg-forest-100 text-forest-800">Default</span>}</p>
              <p className="text-sm text-stone-600">{sch.stages.map((x) => `${x.label} ${formatPct(x.rate, 0)}`).join(" · ")}</p>
            </div>
          ))}
          <dl><Row k="Deposit warning above" v={formatPct(st.payments.maxDepositRate, 0)} note="NSW Home Building Act deposit limit: confirm with your contract advisor" /></dl>
        </section>
        <section className="card p-5">
          <h2 className="mb-2 font-semibold">System</h2>
          <dl>
            <Row k="Data source" v={airtable ? "Airtable (live)" : "Demo data (fictional)"} />
            <Row k="Timezone" v={st.business.timezone} />
            <Row k="QuickBooks" v="Not connected" note="OAuth sign-in and sandbox test still to do" />
            <Row k="AI assistant" v={process.env.ANTHROPIC_API_KEY ? "API key present, not yet tested" : "Not configured"} />
          </dl>
        </section>
        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-2 font-semibold">Roles</h2>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            {ROLES.map((r) => (
              <div key={r}><span className="font-medium">{ROLE_LABELS[r]}</span><span className="text-stone-600"> · {ROLE_PERMISSIONS[r].size} permissions</span></div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
