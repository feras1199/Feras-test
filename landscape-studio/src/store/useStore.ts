import { create } from 'zustand';
import { useMemo } from 'react';
import type { CompanySettings, Material, Project, Supplier } from '../core/types.ts';
import { connect, summarise, type ProjectSummary, type Storage } from './storage.ts';
import { DEFAULT_SETTINGS, newProject } from '../core/project.ts';
import { demoProject, DEMO_ID } from '../core/demo.ts';
import { takeoff } from '../core/assemblies.ts';
import { computeEstimate } from '../core/estimate.ts';
import { evaluateCompliance, issueBlockers } from '../core/compliance.ts';
import { guidedMeasurements, validateProject } from '../core/validation.ts';

export type Page = 'dashboard' | 'customers' | 'project' | 'capture' | 'drawing' | 'design' | 'details' | 'materials' | 'estimate' | 'procurement' | 'documents' | 'performance' | 'settings';

interface State {
  ready: boolean; error: string | null;
  storage: Storage | null;
  projects: ProjectSummary[];
  project: Project | null;
  materials: Material[]; suppliers: Supplier[]; settings: CompanySettings;
  page: Page; selectedId: string | null;
  past: string[]; future: string[];
  saveState: 'saved' | 'dirty' | 'saving' | 'error'; saveError: string | null;
  toast: { kind: 'ok' | 'error' | 'info'; text: string } | null;
  init(): Promise<void>;
  go(page: Page): void;
  select(id: string | null): void;
  open(id: string): Promise<void>;
  close(): void;
  create(name: string): Promise<void>;
  loadDemo(): Promise<void>;
  remove(id: string): Promise<void>;
  importProject(p: Project): Promise<void>;
  update(fn: (p: Project) => void, opts?: { undo?: boolean; audit?: string }): void;
  undo(): void; redo(): void;
  saveNow(): Promise<void>;
  setCatalogue(materials: Material[], suppliers: Supplier[]): Promise<void>;
  setSettings(s: CompanySettings): Promise<void>;
  notify(kind: 'ok' | 'error' | 'info', text: string): void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

function readHash(): { page: Page; id?: string } {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  return { page: (h[0] || 'dashboard') as Page, id: h[1] };
}

export const useStore = create<State>((set, get) => ({
  ready: false, error: null, storage: null, projects: [], project: null,
  materials: [], suppliers: [], settings: DEFAULT_SETTINGS, page: 'dashboard', selectedId: null,
  past: [], future: [], saveState: 'saved', saveError: null, toast: null,

  async init() {
    try {
      const storage = await connect();
      const [projects, cat, settings] = await Promise.all([storage.listProjects(), storage.getCatalogue(), storage.getSettings()]);
      set({ storage, projects, materials: cat.materials, suppliers: cat.suppliers, settings: { ...DEFAULT_SETTINGS, ...settings }, ready: true });
      const h = readHash();
      if (h.id) { await get().open(h.id); if (get().project) set({ page: h.page }); }
      else if (['materials', 'settings', 'customers'].includes(h.page)) set({ page: h.page });
      window.addEventListener('hashchange', () => { const r = readHash(); const s = get(); if (r.page !== s.page && (s.project || ['dashboard', 'materials', 'settings', 'customers'].includes(r.page))) set({ page: r.page }); });
      window.addEventListener('beforeunload', e => { if (get().saveState !== 'saved') { e.preventDefault(); } });
    } catch (e: any) { set({ error: e?.message ?? String(e), ready: true }); }
  },

  go(page) { const p = get().project; set({ page }); const want = `#/${page}${p && !['dashboard', 'customers'].includes(page) ? '/' + p.id : ''}`; if (location.hash !== want) history.replaceState(null, '', want); window.scrollTo(0, 0); },
  select(id) { set({ selectedId: id }); },

  async open(id) {
    const s = get();
    if (s.saveState === 'dirty') await s.saveNow();
    try {
      const p = await s.storage!.getProject(id);
      if (!p) { s.notify('error', 'That project no longer exists.'); return; }
      set({ project: p, past: [], future: [], selectedId: null, saveState: 'saved' });
      get().go('project');
    } catch (e: any) { s.notify('error', e.message); }
  },
  close() { set({ project: null, selectedId: null }); get().go('dashboard'); },

  async create(name) {
    const p = newProject(name.trim() || 'New project');
    p.audit[0].by = get().settings.userName;
    await get().storage!.saveProject(p);
    set({ project: p, projects: [summarise(p), ...get().projects], past: [], future: [], saveState: 'saved' });
    get().go('project');
  },
  async loadDemo() {
    const s = get();
    const existing = await s.storage!.getProject(DEMO_ID);
    if (!existing) { const d = demoProject(); await s.storage!.saveProject(d); set({ projects: [summarise(d), ...s.projects.filter(x => x.id !== DEMO_ID)] }); }
    await get().open(DEMO_ID);
  },
  async remove(id) {
    const s = get();
    const p = await s.storage!.getProject(id);
    if (p) for (const m of p.media) await s.storage!.deleteMedia(id, m.id).catch(() => undefined);
    await s.storage!.deleteProject(id);
    set({ projects: s.projects.filter(x => x.id !== id), project: s.project?.id === id ? null : s.project });
    s.notify('ok', 'Project and its uploaded files deleted.');
  },
  async importProject(p) {
    await get().storage!.saveProject(p);
    set({ projects: [summarise(p), ...get().projects.filter(x => x.id !== p.id)] });
    await get().open(p.id);
  },

  update(fn, opts) {
    const s = get();
    if (!s.project) return;
    const before = JSON.stringify(s.project);
    const next: Project = JSON.parse(before);
    fn(next);
    next.updatedAt = new Date().toISOString();
    if (opts?.audit) next.audit.push({ at: next.updatedAt, by: s.settings.userName, action: opts.audit });
    if (next.audit.length > 500) next.audit = next.audit.slice(-500);
    set({ project: next, saveState: 'dirty', ...(opts?.undo ? { past: [...s.past.slice(-49), before], future: [] } : {}) });
    clearTimeout(timer);
    timer = setTimeout(() => void get().saveNow(), 700);
  },
  undo() { const s = get(); if (!s.past.length || !s.project) return; const prev = s.past[s.past.length - 1]; set({ project: JSON.parse(prev), past: s.past.slice(0, -1), future: [JSON.stringify(s.project), ...s.future], saveState: 'dirty' }); clearTimeout(timer); timer = setTimeout(() => void get().saveNow(), 700); },
  redo() { const s = get(); if (!s.future.length || !s.project) return; set({ project: JSON.parse(s.future[0]), future: s.future.slice(1), past: [...s.past, JSON.stringify(s.project)], saveState: 'dirty' }); clearTimeout(timer); timer = setTimeout(() => void get().saveNow(), 700); },

  async saveNow() {
    const s = get();
    if (!s.project || !s.storage) return;
    clearTimeout(timer);
    const p = s.project;
    set({ saveState: 'saving' });
    try {
      await s.storage.saveProject(p);
      set(st => ({ saveState: st.project === p ? 'saved' : 'dirty', saveError: null, projects: [summarise(p), ...st.projects.filter(x => x.id !== p.id)] }));
      if (get().saveState === 'dirty') timer = setTimeout(() => void get().saveNow(), 700);
    } catch (e: any) { set({ saveState: 'error', saveError: e.message }); }
  },

  async setCatalogue(materials, suppliers) { set({ materials, suppliers }); try { await get().storage!.saveCatalogue({ materials, suppliers }); } catch (e: any) { get().notify('error', `Catalogue not saved: ${e.message}`); } },
  async setSettings(v) { set({ settings: v }); try { await get().storage!.saveSettings(v); } catch (e: any) { get().notify('error', `Settings not saved: ${e.message}`); } },
  notify(kind, text) { set({ toast: { kind, text } }); setTimeout(() => { if (get().toast?.text === text) set({ toast: null }); }, kind === 'error' ? 7000 : 3500); },
}));

/** Everything derived from the project. One source of truth: geometry in, numbers out. */
export function useDerived() {
  const project = useStore(s => s.project), materials = useStore(s => s.materials), suppliers = useStore(s => s.suppliers), settings = useStore(s => s.settings);
  return useMemo(() => {
    if (!project) return null;
    const lines = takeoff(project, materials);
    const estimate = computeEstimate(project, lines, materials, suppliers);
    const checks = evaluateCompliance(project, project.objects.some(o => o.layer === 'proposed') ? estimate.priceInc : null, settings);
    const issues = validateProject(project);
    const tasks = guidedMeasurements(project, materials);
    const blockers = issueBlockers(project, checks);
    return { lines, estimate, checks, issues, tasks, blockers };
  }, [project, materials, suppliers, settings]);
}
