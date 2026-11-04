import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { formatAud, formatPct } from "@/lib/finance/money";
import { markupToMargin } from "@/lib/finance/pricing";
import { dataSource, getRepo, getSettings, requirePage } from "@/lib/server/context";
import { transcriptionProvider } from "@/lib/ai/transcribe";
import { addressProvider } from "@/lib/domain/address";
import { CHANGE_PREFIX } from "@/lib/domain/changeRequests";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/auth/roles";
import { ROLE_LABELS, ROLE_PERMISSIONS, ROLES } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";
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
  const s = await requirePage("settings.view");
  const st = getSettings();
  const source = dataSource();
  const stt = transcriptionProvider();
  const ap = addressProvider();
  const changes = (await getRepo().list("tasks")).filter((t) => t.title?.startsWith(CHANGE_PREFIX) && !["Done", "Cancelled"].includes(t.status ?? "")).sort((a, b) => (b.createdTime ?? "").localeCompare(a.createdTime ?? ""));
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
            <Row k="Data source" v={source === "postgres" ? "ATLAS database (live)" : source === "airtable" ? "Airtable (live)" : "Demo data (fictional)"} />
            <Row k="Timezone" v={st.business.timezone} />
            <Row k="Version" v={(process.env.RENDER_GIT_COMMIT ?? process.env.ATLAS_VERSION ?? "local").slice(0, 7)} note="Code version running on the server" />
            <Row k="QuickBooks" v="Not connected" note="OAuth sign-in and sandbox test still to do" />
            <Row k="AI assistant and write-ups" v={process.env.ANTHROPIC_API_KEY ? "Anthropic key present" : "Not configured"} note="ANTHROPIC_API_KEY: Ask ATLAS and voice-note write-ups" />
            <Row k="Voice notes to text" v={stt === "deepgram" ? "Deepgram key present" : stt === "openai" ? "OpenAI key present" : "Not configured"} note="DEEPGRAM_API_KEY or OPENAI_API_KEY" />
            <Row k="Address suggestions" v={ap === "google" ? "Google key present" : ap === "photon" ? "Free OpenStreetMap lookup (no key)" : ap === "demo" ? "Demo addresses" : "Switched off"} note="GOOGLE_MAPS_API_KEY for the most accurate Australian addresses; without it ATLAS uses the free OpenStreetMap lookup, which misses some house numbers" />
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {can(s.role, "users.manage") && <Link href="/settings/people" className="btn-secondary inline-flex">People and logins</Link>}
            {can(s.role, "settings.edit") && <Link href="/settings/data" className="btn-secondary inline-flex">Backup and import data</Link>}
          </div>
        </section>
        {can(s.role, "settings.edit") && (
          <section className="card p-5 lg:col-span-2" aria-label="Change requests">
            <h2 className="mb-1 font-semibold">Change requests ({changes.length})</h2>
            <p className="mb-2 text-sm text-stone-600">Ideas for changing ATLAS, written up with Ask ATLAS. Nothing changes until a request is built. Send the ones you want to your developer.</p>
            {changes.length === 0 ? <p className="text-sm text-stone-500">None open. Anyone can suggest one in Ask ATLAS.</p> : (
              <ul className="divide-y divide-stone-100">
                {changes.slice(0, 20).map((t) => (
                  <li key={t.id} className="py-2 text-sm">
                    <details>
                      <summary className="cursor-pointer font-medium">{t.title!.slice(CHANGE_PREFIX.length)} <span className="text-xs font-normal text-stone-500">· {formatDate(t.createdTime?.slice(0, 10))}</span></summary>
                      <p className="mt-1 whitespace-pre-wrap text-stone-700">{t.notes}</p>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/tasks" className="mt-2 inline-block text-sm text-forest-700 underline">Mark them done in Tasks</Link>
          </section>
        )}
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
