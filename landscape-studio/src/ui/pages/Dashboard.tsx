import { useRef, useState } from 'react';
import { Plus, FlaskConical, Trash2, Upload, ArrowRight } from 'lucide-react';
import { useStore } from '../../store/useStore.ts';
import { STATUS_LABEL } from '../../core/project.ts';
import { Banner, Empty } from '../kit.tsx';
import type { Project } from '../../core/types.ts';

export function Dashboard() {
  const s = useStore();
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const importJson = async (f: File) => {
    try {
      const p = JSON.parse(await f.text()) as Project;
      if (p.schema !== 1 || !p.id || !Array.isArray(p.objects)) throw new Error('Not a Landscape Intelligence Studio project file');
      await s.importProject(p);
      s.notify('ok', 'Project imported. Photos are not part of a project file.');
    } catch (e: any) { s.notify('error', `Import failed: ${e.message}`); }
  };
  return <>
    <h1>Dashboard</h1>
    <p className="muted">New Site → Upload → Measure → Design → Estimate. Each project keeps its progress.</p>
    {s.storage?.mode === 'local' && <Banner kind="info">Running without a server: projects are stored in this browser only (IndexedDB). Run the Node server for a shared database, AI analysis and Airtable sync. Use "Export project file" in Documents for backups.</Banner>}
    <div className="card">
      <h2>Start a new site</h2>
      <form className="row" onSubmit={e => { e.preventDefault(); void s.create(name); setName(''); }}>
        <input className="grow" style={{ minWidth: 180 }} aria-label="New project name" placeholder="Project name, e.g. Smith backyard, Manly" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn primary" type="submit"><Plus size={16} /> New site</button>
        <button className="btn" type="button" onClick={() => void s.loadDemo()}><FlaskConical size={16} /> Open demo project</button>
        <button className="btn" type="button" onClick={() => file.current?.click()}><Upload size={16} /> Import project file</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ''; }} />
      </form>
      <small>The demo project is synthetic and labelled as such everywhere it appears.</small>
    </div>
    <h2 style={{ marginTop: 22 }}>Projects</h2>
    {s.projects.length === 0 ? <Empty title="No projects yet"><p>Create a new site above, or open the demo project to see a complete worked example.</p></Empty> :
      <div className="cards">{s.projects.map(p => <div className="card" key={p.id}>
        <div className="row between"><span className={`badge ${p.status === 'issued' ? 'ok' : 'warn'}`}>{STATUS_LABEL[p.status as keyof typeof STATUS_LABEL] ?? p.status}</span>{p.synthetic && <span className="badge info">Synthetic demo</span>}</div>
        <h3 style={{ marginTop: 8 }}>{p.name}</h3>
        <div className="muted" style={{ fontSize: '.84rem', minHeight: 38 }}>{p.customer || 'No customer yet'}<br />{p.address || 'No address yet'}</div>
        <div className="row between" style={{ marginTop: 10 }}>
          <small>Updated {new Date(p.updatedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</small>
          <span className="row" style={{ gap: 6 }}>
            {confirm === p.id ? <><button className="btn sm danger" onClick={() => { void s.remove(p.id); setConfirm(null); }}>Delete permanently</button><button className="btn sm" onClick={() => setConfirm(null)}>Cancel</button></> :
              <><button className="btn sm ghost icon" aria-label={`Delete ${p.name}`} onClick={() => setConfirm(p.id)}><Trash2 size={15} /></button>
                <button className="btn sm primary" onClick={() => void s.open(p.id)}>Open <ArrowRight size={14} /></button></>}
          </span>
        </div>
      </div>)}</div>}
  </>;
}

export function Customers() {
  const s = useStore();
  const by = new Map<string, typeof s.projects>();
  for (const p of s.projects) { const k = p.customer || '(no customer recorded)'; by.set(k, [...(by.get(k) ?? []), p]); }
  return <>
    <h1>Customers</h1>
    <p className="muted">Customers are recorded on each project. Airtable can remain the CRM of record: see Settings → Integrations.</p>
    {by.size === 0 ? <Empty title="No customers yet"><p>Create a project and add the customer details on its Project page.</p></Empty> :
      <div className="tablewrap"><table><thead><tr><th>Customer</th><th>Projects</th><th>Latest activity</th><th></th></tr></thead><tbody>
        {[...by.entries()].map(([c, ps]) => <tr key={c}><td><b>{c}</b></td><td>{ps.map(p => <div key={p.id}>{p.name}</div>)}</td>
          <td>{new Date(ps[0].updatedAt).toLocaleDateString('en-AU')}</td><td className="num"><button className="btn sm" onClick={() => void s.open(ps[0].id)}>Open</button></td></tr>)}
      </tbody></table></div>}
  </>;
}
