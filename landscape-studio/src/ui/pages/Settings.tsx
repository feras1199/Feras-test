import { useStore } from '../../store/useStore.ts';
import { Banner, Field, Select, Text } from '../kit.tsx';

export function SettingsPage() {
  const s = useStore(), v = s.settings;
  const set = (patch: Partial<typeof v>) => void s.setSettings({ ...v, ...patch });
  const h = s.storage?.health;
  return <>
    <h1>Settings</h1>
    <div className="card">
      <h2>Business</h2>
      <div className="grid g2">
        <Field label="Application name" hint="Shown in the menu and on documents"><Text value={v.appName} onChange={x => set({ appName: x || 'Landscape Intelligence Studio' })} /></Field>
        <Field label="Company name"><Text value={v.company} onChange={x => set({ company: x })} /></Field>
        <Field label="Contractor licence number" hint="As entered. Not checked against the NSW register."><Text value={v.licence} onChange={x => set({ licence: x })} /></Field>
        <Field label="ABN"><Text value={v.abn} onChange={x => set({ abn: x })} /></Field>
        <Field label="Phone"><Text value={v.phone} onChange={x => set({ phone: x })} /></Field>
        <Field label="Email"><Text value={v.email} onChange={x => set({ email: x })} /></Field>
      </div>
    </div>
    <div className="card">
      <h2>Current user</h2>
      <div className="grid g2">
        <Field label="Your name" hint="Recorded in the audit trail, overrides and approvals"><Text value={v.userName} onChange={x => set({ userName: x || 'User' })} /></Field>
        <Field label="Role" hint={h?.auth.required ? 'Set by your server login' : 'Roles are advisory in single-user mode'}>
          <Select value={v.role} onChange={x => set({ role: x })} options={[['owner', 'Owner'], ['estimator', 'Estimator / designer'], ['crew', 'Crew (view, notes, progress)'], ['reviewer', 'Authorised reviewer (engineer / certifier)']]} /></Field>
      </div>
      <small>Engineering approvals can only be recorded while the role is "Authorised reviewer", and the reviewer's name, credential and document reference are stored with the approval. The software cannot verify credentials.</small>
    </div>
    <div className="card">
      <h2>Integrations</h2>
      <dl className="kv">
        <dt>Storage</dt><dd>{s.storage?.mode === 'server' ? 'Server database (SQLite file on the server)' : 'This browser only (IndexedDB)'}</dd>
        <dt>AI provider</dt><dd>{h?.ai.configured ? <span className="badge ok">Live: {h.ai.model}</span> : <span className="badge warn">Not configured</span>} {!h?.ai.configured && <small> Set ANTHROPIC_API_KEY on the server. Keys are never sent to the browser.</small>}</dd>
        <dt>Airtable</dt><dd>{h?.airtable.configured ? <span className="badge ok">Configured</span> : <span className="badge warn">Not configured</span>} {!h?.airtable.configured && <small> Set AIRTABLE_TOKEN, AIRTABLE_BASE_ID and table names on the server (see README).</small>}</dd>
        <dt>Sign-in</dt><dd>{h?.auth.required ? `Required (signed in as ${h.auth.user?.name ?? '?'})` : 'Off (single-user mode). Set LIS_AUTH=on on the server to require login.'}</dd>
      </dl>
      {s.storage?.mode === 'local' && <Banner kind="info">AI analysis, Airtable sync and multi-user sign-in need the Node server. Everything else works in this browser-only mode.</Banner>}
    </div>
    <div className="card">
      <h2>What this software does not know</h2>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        <li>Exact property boundaries (needs a registered survey)</li><li>Underground services (lodge a Before You Dig enquiry)</li>
        <li>Soil bearing capacity, groundwater, retaining wall stability (needs an engineer)</li><li>Precise levels (needs a level survey)</li>
        <li>Stormwater connection rights and council approval</li><li>Supplier stock on hand</li>
      </ul>
    </div>
  </>;
}
