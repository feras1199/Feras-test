import type { CompanySettings, Material, Project, Supplier } from '../core/types.ts';
import { SEED_MATERIALS, SEED_SUPPLIERS } from '../core/catalogue.ts';
import { DEFAULT_SETTINGS } from '../core/project.ts';

export interface ProjectSummary { id: string; name: string; customer: string; address: string; status: string; updatedAt: string; synthetic?: boolean }
export interface Catalogue { materials: Material[]; suppliers: Supplier[] }
export interface Health { ok: boolean; ai: { configured: boolean; model?: string }; airtable: { configured: boolean }; auth: { required: boolean; user?: { name: string; role: string } } }
export interface AiFeature { label: string; type: string; x: number; y: number; note?: string }
export interface AiAnalysis { live: boolean; model?: string; summary: string; features: AiFeature[]; measurements: string[] }

export interface Storage {
  mode: 'server' | 'local';
  health: Health;
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<Project | null>;
  saveProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  getCatalogue(): Promise<Catalogue>;
  saveCatalogue(c: Catalogue): Promise<void>;
  getSettings(): Promise<CompanySettings>;
  saveSettings(s: CompanySettings): Promise<void>;
  putMedia(projectId: string, id: string, blob: Blob): Promise<void>;
  getMedia(projectId: string, id: string): Promise<Blob | null>;
  deleteMedia(projectId: string, id: string): Promise<void>;
  analyzePhoto(projectId: string, mediaId: string): Promise<AiAnalysis>;
  assist(text: string, context: unknown): Promise<{ ops: unknown[]; answer: string; model: string }>;
  airtableSync(project: Project): Promise<{ ok: boolean; message: string }>;
}

export const summarise = (p: Project): ProjectSummary => ({ id: p.id, name: p.name, customer: p.customer.name, address: [p.site.address, p.site.suburb].filter(Boolean).join(', '), status: p.status, updatedAt: p.updatedAt, synthetic: p.synthetic });

export class ApiError extends Error { status: number; code?: string; constructor(status: number, message: string, code?: string) { super(message); this.status = status; this.code = code; } }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(`/api${path}`, { credentials: 'same-origin', ...init, headers: init?.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } : init?.headers }); }
  catch { throw new ApiError(0, 'Cannot reach the server. Your changes are kept on screen; try saving again.'); }
  if (!res.ok) { let j: any = {}; try { j = await res.json(); } catch { /* not json */ } throw new ApiError(res.status, j.error || `Server error ${res.status}`, j.code); }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

class ServerStorage implements Storage {
  mode = 'server' as const;
  health: Health;
  constructor(health: Health) { this.health = health; }
  listProjects() { return api<ProjectSummary[]>('/projects'); }
  async getProject(id: string) { try { return await api<Project>(`/projects/${id}`); } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; } }
  async saveProject(p: Project) { await api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify(p) }); }
  async deleteProject(id: string) { await api(`/projects/${id}`, { method: 'DELETE' }); }
  getCatalogue() { return api<Catalogue>('/catalogue'); }
  async saveCatalogue(c: Catalogue) { await api('/catalogue', { method: 'PUT', body: JSON.stringify(c) }); }
  getSettings() { return api<CompanySettings>('/settings'); }
  async saveSettings(s: CompanySettings) { await api('/settings', { method: 'PUT', body: JSON.stringify(s) }); }
  async putMedia(projectId: string, id: string, blob: Blob) { await api(`/media/${projectId}/${id}`, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } }); }
  async getMedia(projectId: string, id: string) { const r = await fetch(`/api/media/${projectId}/${id}`, { credentials: 'same-origin' }); return r.ok ? r.blob() : null; }
  async deleteMedia(projectId: string, id: string) { await api(`/media/${projectId}/${id}`, { method: 'DELETE' }); }
  analyzePhoto(projectId: string, mediaId: string) { return api<AiAnalysis>('/ai/analyze-photo', { method: 'POST', body: JSON.stringify({ projectId, mediaId }) }); }
  assist(text: string, context: unknown) { return api<{ ops: unknown[]; answer: string; model: string }>('/ai/assist', { method: 'POST', body: JSON.stringify({ text, context }) }); }
  airtableSync(project: Project) { return api<{ ok: boolean; message: string }>('/airtable/sync', { method: 'POST', body: JSON.stringify({ projectId: project.id }) }); }
}

// ---- Browser-only storage (IndexedDB). Used when no server is reachable, e.g. a static preview. ----
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('landscape-studio', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('media'); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idb<T>(store: 'kv' | 'media', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(req.result as T); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Storage write was aborted (storage may be full)')); };
  });
}

class LocalStorage implements Storage {
  mode = 'local' as const;
  health: Health = { ok: true, ai: { configured: false }, airtable: { configured: false }, auth: { required: false } };
  async listProjects() {
    const keys = await idb<IDBValidKey[]>('kv', 'readonly', s => s.getAllKeys());
    const out: ProjectSummary[] = [];
    for (const k of keys) if (String(k).startsWith('project:')) { const p = await idb<Project>('kv', 'readonly', s => s.get(k)); if (p) out.push(summarise(p)); }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getProject(id: string) { return (await idb<Project | undefined>('kv', 'readonly', s => s.get(`project:${id}`))) ?? null; }
  async saveProject(p: Project) { await idb('kv', 'readwrite', s => s.put(p, `project:${p.id}`)); }
  async deleteProject(id: string) {
    await idb('kv', 'readwrite', s => s.delete(`project:${id}`));
    const keys = await idb<IDBValidKey[]>('media', 'readonly', s => s.getAllKeys());
    for (const k of keys) if (String(k).startsWith(`${id}/`)) await idb('media', 'readwrite', s => s.delete(k));
  }
  async getCatalogue() { return (await idb<Catalogue | undefined>('kv', 'readonly', s => s.get('catalogue'))) ?? { materials: structuredClone(SEED_MATERIALS), suppliers: structuredClone(SEED_SUPPLIERS) }; }
  async saveCatalogue(c: Catalogue) { await idb('kv', 'readwrite', s => s.put(c, 'catalogue')); }
  async getSettings() { return { ...DEFAULT_SETTINGS, ...((await idb<CompanySettings | undefined>('kv', 'readonly', s => s.get('settings'))) ?? {}) }; }
  async saveSettings(v: CompanySettings) { await idb('kv', 'readwrite', s => s.put(v, 'settings')); }
  async putMedia(projectId: string, id: string, blob: Blob) { await idb('media', 'readwrite', s => s.put(blob, `${projectId}/${id}`)); }
  async getMedia(projectId: string, id: string) { return (await idb<Blob | undefined>('media', 'readonly', s => s.get(`${projectId}/${id}`))) ?? null; }
  async deleteMedia(projectId: string, id: string) { await idb('media', 'readwrite', s => s.delete(`${projectId}/${id}`)); }
  async analyzePhoto(): Promise<AiAnalysis> { throw new ApiError(503, 'AI analysis needs the server with an API key. This browser-only mode has no AI connection.', 'AI_NOT_CONFIGURED'); }
  async assist(): Promise<never> { throw new ApiError(503, 'AI assistant needs the server with an API key.', 'AI_NOT_CONFIGURED'); }
  async airtableSync() { return { ok: false, message: 'Airtable sync needs the server with AIRTABLE_TOKEN configured.' }; }
}

export async function connect(): Promise<Storage> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch('/api/health', { signal: ctl.signal, credentials: 'same-origin' });
    clearTimeout(t);
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) return new ServerStorage(await r.json());
  } catch { /* fall through to local */ }
  return new LocalStorage();
}
