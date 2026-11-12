import { useDerived, useStore } from '../../store/useStore.ts';
import { ACCESS_FACTOR } from '../../core/estimate.ts';
import { workflow } from '../../core/project.ts';
import { Banner, Field, Num, Select, Text } from '../kit.tsx';
import { money } from '../../core/units.ts';
import type { Project } from '../../core/types.ts';
import type { Page } from '../../store/useStore.ts';

export const COUNCILS = ['Bayside', 'Blacktown', 'Blue Mountains', 'Burwood', 'Camden', 'Campbelltown', 'Canada Bay', 'Canterbury-Bankstown', 'Cumberland', 'Fairfield', 'Georges River', 'Hawkesbury', 'Hornsby', 'Hunters Hill', 'Inner West', 'Ku-ring-gai', 'Lane Cove', 'Liverpool', 'Mosman', 'North Sydney', 'Northern Beaches', 'Parramatta', 'Penrith', 'Randwick', 'Ryde', 'Strathfield', 'Sutherland Shire', 'City of Sydney', 'The Hills Shire', 'Waverley', 'Willoughby', 'Wollondilly', 'Woollahra'].map(c => (c.startsWith('City') || c.endsWith('Shire') ? c : `${c} Council`));
const TRI = [['unknown', 'Unknown'], ['no', 'No'], ['yes', 'Yes']] as const;

export function ProjectPage() {
  const s = useStore(), d = useDerived()!, p = s.project!;
  const up = (fn: (p: Project) => void) => s.update(fn);
  const steps = workflow(p, d.estimate.complete);
  const next = steps.find(x => !x.done);
  return <>
    {p.synthetic && <Banner kind="info"><b>Synthetic demonstration project.</b> The customer, address, measurements and rates are invented for demonstration. Supplier prices marked "verified" are real published prices on the date shown in the Materials Library.</Banner>}
    <div className="grid g3" style={{ marginBottom: 14 }}>
      <div className="card"><small>Next step</small><div style={{ fontWeight: 650, margin: '4px 0 8px' }}>{next ? `${next.label}: ${next.hint}` : 'All workflow steps complete'}</div>{next && <button className="btn primary sm" onClick={() => s.go(next.page as Page)}>Go to {next.label}</button>}</div>
      <div className="card"><small>Preliminary price inc GST</small><div className="stat">{p.objects.some(o => o.layer === 'proposed') ? money(d.estimate.priceInc, 0) : '-'}</div><small>{d.estimate.flags.length ? `${d.estimate.flags.length} open pricing items: total is incomplete` : 'All items priced'}</small></div>
      <div className="card"><small>Review flags</small><div className="stat">{d.checks.filter(c => c.status === 'potential').length + d.issues.filter(i => i.severity === 'error').length}</div><small>{d.tasks.length} site measurements still needed</small></div>
    </div>
    <div className="card">
      <h2>Project and customer</h2>
      <div className="grid g2">
        <Field label="Project name"><Text value={p.name} onChange={v => up(x => { x.name = v || 'Untitled project'; })} /></Field>
        <Field label="Customer name"><Text value={p.customer.name} onChange={v => up(x => { x.customer.name = v; })} /></Field>
        <Field label="Customer phone"><Text value={p.customer.phone} onChange={v => up(x => { x.customer.phone = v; })} /></Field>
        <Field label="Customer email"><Text value={p.customer.email} onChange={v => up(x => { x.customer.email = v; })} /></Field>
      </div>
    </div>
    <div className="card">
      <h2>Site</h2>
      <div className="grid g2">
        <Field label="Site address"><Text value={p.site.address} onChange={v => up(x => { x.site.address = v; })} /></Field>
        <Field label="Suburb"><Text value={p.site.suburb} onChange={v => up(x => { x.site.suburb = v; })} /></Field>
        <Field label="Local council" hint="Select manually. The app does not look the council up from the address.">
          <select value={p.site.council} onChange={e => up(x => { x.site.council = e.target.value; })}><option value="">Select council…</option>{COUNCILS.map(c => <option key={c}>{c}</option>)}<option>Other NSW council</option></select></Field>
        <Field label="Lot area" hint="From the title or survey, if known"><Num value={p.site.lotAreaM2} allowNull min={1} onChange={v => up(x => { x.site.lotAreaM2 = v; })} unit="m²" /></Field>
        <Field label="Site access" hint="Sets the labour access factor in the estimate"><Select value={p.site.access} onChange={v => up(x => { x.site.access = v; x.estimate.accessFactor = ACCESS_FACTOR[v]; })} options={[['easy', 'Easy: machine and truck access'], ['restricted', 'Restricted: narrow side access'], ['difficult', 'Difficult: hand carry / stairs']]} /></Field>
        <Field label="Heritage item or conservation area"><Select value={p.site.heritage} onChange={v => up(x => { x.site.heritage = v; })} options={TRI} /></Field>
        <Field label="Flood control lot"><Select value={p.site.floodControlLot} onChange={v => up(x => { x.site.floodControlLot = v; })} options={TRI} /></Field>
        <Field label="Bushfire prone land"><Select value={p.site.bushfire} onChange={v => up(x => { x.site.bushfire = v; })} options={TRI} /></Field>
        <Field label="Easements on title"><Select value={p.site.easements} onChange={v => up(x => { x.site.easements = v; })} options={TRI} /></Field>
        <Field label="Near a natural waterbody"><Select value={p.site.nearWaterbody} onChange={v => up(x => { x.site.nearWaterbody = v; })} options={TRI} /></Field>
      </div>
      <div style={{ marginTop: 12 }}><Field label="Existing site conditions"><Text area value={p.site.conditions} onChange={v => up(x => { x.site.conditions = v; })} /></Field></div>
      <small>These attributes feed the NSW compliance checks. Find them on the section 10.7 planning certificate or the NSW Planning Portal Spatial Viewer.</small>
    </div>
    <div className="card">
      <h2>Brief</h2>
      <div className="grid g2">
        <Field label="Project description"><Text area value={p.brief.description} onChange={v => up(x => { x.brief.description = v; })} /></Field>
        <Field label="Scope of work"><Text area value={p.brief.scope} onChange={v => up(x => { x.brief.scope = v; })} /></Field>
        <Field label="Budget from"><Num value={p.brief.budgetMin} allowNull min={0} onChange={v => up(x => { x.brief.budgetMin = v; })} unit="AUD" /></Field>
        <Field label="Budget to"><Num value={p.brief.budgetMax} allowNull min={0} onChange={v => up(x => { x.brief.budgetMax = v; })} unit="AUD" /></Field>
        <Field label="Preferred materials"><Text value={p.brief.preferredMaterials} onChange={v => up(x => { x.brief.preferredMaterials = v; })} /></Field>
        <Field label="Target completion"><Text value={p.brief.targetCompletion} onChange={v => up(x => { x.brief.targetCompletion = v; })} /></Field>
      </div>
      <div style={{ marginTop: 12 }}><Field label="Notes"><Text area value={p.brief.notes} onChange={v => up(x => { x.brief.notes = v; })} /></Field></div>
      {p.brief.budgetMax != null && d.estimate.priceInc > p.brief.budgetMax && p.objects.some(o => o.layer === 'proposed') &&
        <Banner kind="warn">Current preliminary price {money(d.estimate.priceInc, 0)} is over the budget ceiling {money(p.brief.budgetMax, 0)}. Try the Design Studio alternatives or the "make it cheaper" assistant command.</Banner>}
    </div>
  </>;
}
