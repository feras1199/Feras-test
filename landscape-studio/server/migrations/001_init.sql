CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  customer TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  synthetic INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,          -- full project JSON: geometry, measurements, estimate settings, approvals, audit
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_history (project_id TEXT NOT NULL, saved_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS project_history_pid ON project_history(project_id);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('owner','estimator','crew','reviewer')), password TEXT NOT NULL);
