import { useEffect, useState } from 'react';
import { LayoutDashboard, Users, FolderKanban, Camera, PencilRuler, Sparkles, HardHat, Boxes, Calculator, Truck, FileText, LineChart, Settings as Cog, Menu, Check, CloudOff, Loader2, Save, Leaf, X } from 'lucide-react';
import { useDerived, useStore, type Page } from '../store/useStore.ts';
import { STATUS_LABEL, workflow } from '../core/project.ts';
import { Dashboard, Customers } from './pages/Dashboard.tsx';
import { ProjectPage } from './pages/ProjectPage.tsx';
import { Capture } from './pages/Capture.tsx';
import { Drawing } from './pages/Drawing.tsx';
import { Design } from './pages/Design.tsx';
import { Details } from './pages/Details.tsx';
import { Materials } from './pages/Materials.tsx';
import { EstimatePage } from './pages/Estimate.tsx';
import { Procurement } from './pages/Procurement.tsx';
import { Documents } from './pages/Documents.tsx';
import { Performance } from './pages/Performance.tsx';
import { SettingsPage } from './pages/Settings.tsx';

const NAV: { group: string; items: { page: Page; label: string; icon: typeof Leaf; needsProject?: boolean }[] }[] = [
  { group: 'Business', items: [{ page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { page: 'customers', label: 'Customers', icon: Users }] },
  { group: 'Project', items: [
    { page: 'project', label: 'Project', icon: FolderKanban, needsProject: true }, { page: 'capture', label: 'Site Capture', icon: Camera, needsProject: true },
    { page: 'drawing', label: 'Site Drawing', icon: PencilRuler, needsProject: true }, { page: 'design', label: 'Design Studio', icon: Sparkles, needsProject: true },
    { page: 'details', label: 'Construction Details', icon: HardHat, needsProject: true }, { page: 'estimate', label: 'Cost Estimator', icon: Calculator, needsProject: true },
    { page: 'procurement', label: 'Procurement', icon: Truck, needsProject: true }, { page: 'documents', label: 'Documents', icon: FileText, needsProject: true },
    { page: 'performance', label: 'Project Performance', icon: LineChart, needsProject: true },
  ] },
  { group: 'Library', items: [{ page: 'materials', label: 'Materials Library', icon: Boxes }, { page: 'settings', label: 'Settings', icon: Cog }] },
];

export function App() {
  const s = useStore();
  const d = useDerived();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { void s.init(); }, []); // eslint-disable-line
  useEffect(() => { document.title = s.settings.appName; }, [s.settings.appName]);

  if (!s.ready) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><div className="row"><Loader2 className="spin" size={18} /> Loading…</div></div>;
  if (s.error) return <div className="content"><div className="banner danger">Could not start: {s.error}. Reload the page. If this persists, your browser may be blocking storage (private browsing).</div></div>;

  const p = s.project;
  const needsProject = !['dashboard', 'customers', 'materials', 'settings'].includes(s.page);
  const page = needsProject && !p ? 'dashboard' : s.page;
  const steps = p && d ? workflow(p, d.estimate.complete) : [];
  const nextIdx = steps.findIndex(x => !x.done);

  return <div className="shell">
    <nav className={`nav ${navOpen ? 'open' : ''}`} aria-label="Main">
      <div className="brand"><span className="brand-mark"><Leaf size={17} color="#fff" /></span><span>{s.settings.appName}</span>
        <button className="btn ghost icon hide-lg" style={{ marginLeft: 'auto', color: '#fff', display: navOpen ? 'inline-flex' : 'none' }} aria-label="Close menu" onClick={() => setNavOpen(false)}><X size={18} /></button></div>
      {NAV.map(g => <div key={g.group}>
        <div className="nav-group">{g.group}{g.group === 'Project' && p ? `: ${p.name.slice(0, 22)}${p.name.length > 22 ? '…' : ''}` : ''}</div>
        {g.items.map(it => <button key={it.page} className={`item ${page === it.page ? 'active' : ''}`} disabled={it.needsProject && !p} aria-current={page === it.page ? 'page' : undefined}
          title={it.needsProject && !p ? 'Open or create a project first' : undefined} onClick={() => { s.go(it.page); setNavOpen(false); }}><it.icon size={17} />{it.label}</button>)}
      </div>)}
      <div className="nav-foot">
        {s.storage?.mode === 'server' ? 'Connected to server database' : 'Browser-only storage (this device)'}<br />
        AI: {s.storage?.health.ai.configured ? `live (${s.storage.health.ai.model})` : 'not configured'}
      </div>
    </nav>
    <div className="main">
      <header className="top">
        <button className="btn ghost icon menu" aria-label="Open menu" onClick={() => setNavOpen(true)}><Menu size={20} /></button>
        <div className="title">{needsProject && p ? p.name : NAV.flatMap(g => g.items).find(i => i.page === page)?.label}</div>
        {p && needsProject && <span className={`badge ${p.status === 'issued' ? 'ok' : p.status === 'approved' ? 'info' : 'warn'} hide-sm`}>{STATUS_LABEL[p.status]}</span>}
        {p && <button className="btn sm" onClick={() => void s.saveNow()} aria-label="Save project" title={s.saveError ?? 'Changes save automatically'} data-save-state={s.saveState}>
          {s.saveState === 'saved' ? <><Check size={15} color="var(--ok)" /> Saved</> : s.saveState === 'saving' ? <><Loader2 size={15} className="spin" /> Saving</> : s.saveState === 'error' ? <><CloudOff size={15} color="var(--danger)" /> Retry save</> : <><Save size={15} /> Save</>}
        </button>}
      </header>
      {p && needsProject && <div className="flow" role="navigation" aria-label="Project workflow">
        {steps.map((st, i) => <button key={st.key} className={`${st.done ? 'done' : ''} ${i === nextIdx ? 'next' : ''}`} title={st.done ? 'Done' : st.hint} onClick={() => s.go(st.page as Page)}>
          <span className="dot">{st.done ? '✓' : i + 1}</span>{st.label}</button>)}
      </div>}
      {s.saveState === 'error' && <div className="banner danger" style={{ margin: 12 }}>Not saved: {s.saveError} Your work is still on screen. Press "Retry save".</div>}
      <main className={`content ${page === 'drawing' ? 'full' : ''}`}>
        {page === 'dashboard' && <Dashboard />}
        {page === 'customers' && <Customers />}
        {page === 'materials' && <Materials />}
        {page === 'settings' && <SettingsPage />}
        {p && d && <>
          {page === 'project' && <ProjectPage />}
          {page === 'capture' && <Capture />}
          {page === 'drawing' && <Drawing />}
          {page === 'design' && <Design />}
          {page === 'details' && <Details />}
          {page === 'estimate' && <EstimatePage />}
          {page === 'procurement' && <Procurement />}
          {page === 'documents' && <Documents />}
          {page === 'performance' && <Performance />}
        </>}
      </main>
    </div>
    {s.toast && <div className={`toast ${s.toast.kind}`} role="status">{s.toast.text}</div>}
    <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>;
}
