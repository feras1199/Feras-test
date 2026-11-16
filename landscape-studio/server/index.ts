// Landscape Intelligence Studio server: Express + node:sqlite. Run with Node 22.18+ (type stripping).
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SEED_MATERIALS, SEED_SUPPLIERS } from '../src/core/catalogue.ts';
import { DEFAULT_SETTINGS } from '../src/core/project.ts';
import { analyzePhoto, assist, aiStatus } from './ai.ts';
import { airtableStatus, syncProject } from './airtable.ts';
import { buildPrompt, generateRender, imageStatus } from './image.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DATA = resolve(process.env.LIS_DATA_DIR ?? 'data');
const AUTH = process.env.LIS_AUTH === 'on';
mkdirSync(join(DATA, 'media'), { recursive: true });

const db = new DatabaseSync(join(DATA, 'studio.db'));
// Run every migration file in order. All statements are idempotent (IF NOT EXISTS).
const migDir = new URL('./migrations/', import.meta.url);
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  db.exec(readFileSync(new URL(f, migDir), 'utf8'));
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  db.prepare('INSERT OR IGNORE INTO schema_migrations(name, applied_at) VALUES(?, ?)').run(f, new Date().toISOString());
}
const ID = /^[A-Za-z0-9_-]{1,80}$/;

const kvGet = (k: string) => { const r = db.prepare('SELECT value FROM kv WHERE key = ?').get(k) as { value: string } | undefined; return r ? JSON.parse(r.value) : null; };
const kvSet = (k: string, v: unknown) => db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v));
if (!kvGet('catalogue')) kvSet('catalogue', { materials: SEED_MATERIALS, suppliers: SEED_SUPPLIERS });

// ---- Optional authentication (LIS_AUTH=on). Users are created with: node server/admin.ts add <name> <role> <password>
const hash = (pw: string, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(pw, salt, 32).toString('hex')}`;
const verify = (pw: string, stored: string) => { const [salt, h] = stored.split(':'); return timingSafeEqual(Buffer.from(h, 'hex'), scryptSync(pw, salt, 32)); };
export { hash };
const sessions = new Map<string, { name: string; role: string; exp: number }>();
const cookie = (req: express.Request, name: string) => (req.headers.cookie ?? '').split(';').map(c => c.trim().split('=')).find(([k]) => k === name)?.[1];
const userOf = (req: express.Request) => { const t = cookie(req, 'lis_session'); const s = t ? sessions.get(t) : undefined; return s && s.exp > Date.now() ? s : null; };

const app = express();
app.disable('x-powered-by');
app.use((_, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });
app.use('/api', express.json({ limit: '8mb' }));

app.post('/api/login', (req, res) => {
  const { name, password } = req.body ?? {};
  const u = db.prepare('SELECT name, role, password FROM users WHERE name = ?').get(String(name ?? '')) as { name: string; role: string; password: string } | undefined;
  if (!u || !verify(String(password ?? ''), u.password)) return res.status(401).json({ error: 'Wrong name or password' });
  const t = randomBytes(24).toString('hex');
  sessions.set(t, { name: u.name, role: u.role, exp: Date.now() + 12 * 3600e3 });
  res.setHeader('Set-Cookie', `lis_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.json({ name: u.name, role: u.role });
});
app.get('/api/health', (req, res) => res.json({ ok: true, ai: aiStatus(), image: imageStatus(), airtable: airtableStatus(), auth: { required: AUTH, user: userOf(req) ?? undefined } }));
app.use('/api', (req, res, next) => { if (!AUTH || userOf(req)) return next(); res.status(401).json({ error: 'Sign in required', code: 'AUTH' }); });
const canWrite = (req: express.Request) => !AUTH || userOf(req)?.role !== 'crew';

app.get('/api/projects', (_, res) => res.json(db.prepare('SELECT id, name, customer, address, status, updated_at AS updatedAt, synthetic FROM projects ORDER BY updated_at DESC').all().map((r: any) => ({ ...r, synthetic: !!r.synthetic }))));
app.get('/api/projects/:id', (req, res) => { const r = db.prepare('SELECT data FROM projects WHERE id = ?').get(req.params.id) as { data: string } | undefined; r ? res.json(JSON.parse(r.data)) : res.status(404).json({ error: 'Not found' }); });
app.put('/api/projects/:id', (req, res) => {
  const p = req.body;
  if (!ID.test(req.params.id) || p?.id !== req.params.id || p?.schema !== 1 || !Array.isArray(p.objects) || !Array.isArray(p.measurements)) return res.status(400).json({ error: 'Invalid project payload' });
  for (const o of p.objects) if (!Array.isArray(o.points) || o.points.some((q: any) => !Number.isFinite(q?.x) || !Number.isFinite(q?.y))) return res.status(400).json({ error: `Object ${o.name ?? o.id} has invalid coordinates` });
  const prev = db.prepare('SELECT data FROM projects WHERE id = ?').get(p.id) as { data: string } | undefined;
  if (prev && !canWrite(req)) {
    // Crew may add site notes and progress only
    const old = JSON.parse(prev.data); old.progress = p.progress; old.updatedAt = p.updatedAt; Object.assign(p, old);
  }
  db.prepare(`INSERT INTO projects(id, name, customer, address, status, synthetic, data, updated_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, customer=excluded.customer, address=excluded.address, status=excluded.status, synthetic=excluded.synthetic, data=excluded.data, updated_at=excluded.updated_at`)
    .run(p.id, String(p.name), String(p.customer?.name ?? ''), [p.site?.address, p.site?.suburb].filter(Boolean).join(', '), String(p.status), p.synthetic ? 1 : 0, JSON.stringify(p), String(p.updatedAt));
  if (prev) db.prepare('INSERT INTO project_history(project_id, saved_at, data) VALUES(?,?,?)').run(p.id, new Date().toISOString(), prev.data);
  db.prepare('DELETE FROM project_history WHERE project_id = ? AND rowid NOT IN (SELECT rowid FROM project_history WHERE project_id = ? ORDER BY rowid DESC LIMIT 30)').run(p.id, p.id);
  res.status(204).end();
});
app.delete('/api/projects/:id', (req, res) => {
  if (!ID.test(req.params.id) || !canWrite(req)) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM project_history WHERE project_id = ?').run(req.params.id);
  rmSync(join(DATA, 'media', req.params.id), { recursive: true, force: true });
  res.status(204).end();
});
app.get('/api/catalogue', (_, res) => res.json(kvGet('catalogue')));
app.put('/api/catalogue', (req, res) => { if (!canWrite(req)) return res.status(403).json({ error: 'Not allowed' }); if (!Array.isArray(req.body?.materials) || !Array.isArray(req.body?.suppliers)) return res.status(400).json({ error: 'Invalid catalogue' }); kvSet('catalogue', req.body); res.status(204).end(); });
app.get('/api/settings', (req, res) => { const s = { ...DEFAULT_SETTINGS, ...(kvGet('settings') ?? {}) }; const u = userOf(req); res.json(u ? { ...s, userName: u.name, role: u.role } : s); });
app.put('/api/settings', (req, res) => { kvSet('settings', req.body ?? {}); res.status(204).end(); });

// Media: raw body upload, stored on disk per project. Sizes and ids validated.
const MAX = 40 * 1024 * 1024;
app.put('/api/media/:pid/:id', express.raw({ type: () => true, limit: MAX }), (req, res) => {
  const { pid, id } = req.params;
  if (!ID.test(pid) || !ID.test(id)) return res.status(400).json({ error: 'Bad id' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty upload' });
  mkdirSync(join(DATA, 'media', pid), { recursive: true });
  writeFileSync(join(DATA, 'media', pid, id), req.body);
  writeFileSync(join(DATA, 'media', pid, `${id}.type`), String(req.headers['content-type'] ?? 'application/octet-stream').slice(0, 100));
  res.status(204).end();
});
const mediaPath = (pid: string, id: string) => (ID.test(pid) && ID.test(id) ? join(DATA, 'media', pid, id) : null);
app.get('/api/media/:pid/:id', (req, res) => { const f = mediaPath(req.params.pid, req.params.id); if (!f || !existsSync(f)) return res.status(404).json({ error: 'Not found' }); const t = existsSync(`${f}.type`) ? readFileSync(`${f}.type`, 'utf8') : 'application/octet-stream'; res.setHeader('Content-Type', t); res.setHeader('Content-Disposition', 'inline'); res.send(readFileSync(f)); });
app.delete('/api/media/:pid/:id', (req, res) => { const f = mediaPath(req.params.pid, req.params.id); if (f) { rmSync(f, { force: true }); rmSync(`${f}.type`, { force: true }); } res.status(204).end(); });

app.post('/api/ai/analyze-photo', async (req, res) => {
  const f = mediaPath(String(req.body?.projectId), String(req.body?.mediaId));
  if (!f || !existsSync(f)) return res.status(404).json({ error: 'Photo not found' });
  try { res.json(await analyzePhoto(readFileSync(f), readFileSync(`${f}.type`, 'utf8'))); }
  catch (e: any) { res.status(e.status ?? 502).json({ error: e.message, code: e.code }); }
});
app.post('/api/ai/assist', async (req, res) => {
  try { res.json(await assist(String(req.body?.text ?? '').slice(0, 2000), req.body?.context)); }
  catch (e: any) { res.status(e.status ?? 502).json({ error: e.message, code: e.code }); }
});
const logRender = (r: Record<string, unknown>) => db.prepare('INSERT INTO render_log(id, project_id, proposal_id, origin, provider, model, prompt, source_media, media_id, status, error, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(String(r.id), String(r.projectId), (r.proposalId as string) ?? null, String(r.origin), (r.provider as string) ?? null, (r.model as string) ?? null, (r.prompt as string) ?? null, JSON.stringify(r.sourceMediaIds ?? []), (r.mediaId as string) ?? null, String(r.status), (r.error as string) ?? null, (r.createdBy as string) ?? null, new Date().toISOString());

// Generate an illustrative render from one site photo. Result is stored as media; nothing touches geometry.
app.post('/api/ai/render', async (req, res) => {
  const { projectId, proposalId, sourceMediaId, title, style, changes, materials } = req.body ?? {};
  const f = mediaPath(String(projectId), String(sourceMediaId));
  const id = 'rnd_' + randomBytes(8).toString('hex');
  const by = userOf(req)?.name ?? 'single-user';
  if (!f || !existsSync(f)) return res.status(404).json({ error: 'Source photo not found' });
  const prompt = buildPrompt({ title: String(title ?? ''), style: String(style ?? ''), changes: Array.isArray(changes) ? changes.map(String) : [], materials: Array.isArray(materials) ? materials.map(String) : [] });
  const st = imageStatus();
  if (!st.configured) { logRender({ id, projectId, proposalId, origin: 'ai-generated', prompt, sourceMediaIds: [sourceMediaId], status: 'not-configured', createdBy: by }); return res.status(503).json({ error: 'AI image generation is not configured.', code: 'IMAGE_NOT_CONFIGURED' }); }
  try {
    const out = await generateRender(readFileSync(f), readFileSync(`${f}.type`, 'utf8'), prompt);
    const mediaId = 'med_' + randomBytes(8).toString('hex');
    mkdirSync(join(DATA, 'media', String(projectId)), { recursive: true });
    writeFileSync(join(DATA, 'media', String(projectId), mediaId), out.png);
    writeFileSync(join(DATA, 'media', String(projectId), `${mediaId}.type`), 'image/png');
    logRender({ id, projectId, proposalId, origin: 'ai-generated', provider: out.provider, model: out.model, prompt, sourceMediaIds: [sourceMediaId], mediaId, status: 'ok', createdBy: by });
    res.json({ id, mediaId, provider: out.provider, model: out.model, prompt, createdAt: new Date().toISOString(), createdBy: by });
  } catch (e: any) {
    logRender({ id, projectId, proposalId, origin: 'ai-generated', provider: st.provider, model: st.model, prompt, sourceMediaIds: [sourceMediaId], status: 'failed', error: String(e.message).slice(0, 500), createdBy: by });
    res.status(e.status ?? 502).json({ error: e.message, code: e.code });
  }
});
app.post('/api/renders/log', (req, res) => { const r = req.body ?? {}; logRender({ ...r, origin: 'imported', status: 'ok', createdBy: userOf(req)?.name ?? r.createdBy ?? 'single-user' }); res.status(204).end(); });
app.get('/api/renders/:pid', (req, res) => res.json(db.prepare('SELECT * FROM render_log WHERE project_id = ? ORDER BY created_at DESC').all(req.params.pid)));

app.post('/api/airtable/sync', async (req, res) => {
  const r = db.prepare('SELECT data FROM projects WHERE id = ?').get(String(req.body?.projectId)) as { data: string } | undefined;
  if (!r) return res.status(404).json({ ok: false, message: 'Project not found' });
  try { const out = await syncProject(JSON.parse(r.data), (k, v) => (v === undefined ? kvGet(k) : kvSet(k, v))); res.json(out); }
  catch (e: any) { res.status(502).json({ ok: false, message: e.message }); }
});
app.use('/api', (_, res) => res.status(404).json({ error: 'Unknown API route' }));

const dist = resolve('dist');
if (existsSync(dist)) { app.use(express.static(dist, { index: 'index.html' })); app.get(/^(?!\/api).*/, (_, res) => res.sendFile(join(dist, 'index.html'))); }

app.listen(PORT, () => console.log(`Landscape Intelligence Studio on http://localhost:${PORT} (data: ${DATA}, auth ${AUTH ? 'on' : 'off'}, AI ${aiStatus().configured ? 'on' : 'off'})`));
void createHash;
