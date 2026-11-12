-- Provenance log for every illustrative render request (AI-generated or imported).
CREATE TABLE IF NOT EXISTS render_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  proposal_id TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('ai-generated', 'imported')),
  provider TEXT,
  model TEXT,
  prompt TEXT,
  source_media TEXT NOT NULL DEFAULT '[]', -- JSON array of media ids used as input
  media_id TEXT,                           -- stored result, null on failure
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'not-configured')),
  error TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS render_log_project ON render_log(project_id);
CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
