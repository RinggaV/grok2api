CREATE TABLE IF NOT EXISTS admin_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  invalidated INTEGER NOT NULL DEFAULT 0,
  current_step TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_jobs_type_status ON admin_jobs(job_type, status);
CREATE INDEX IF NOT EXISTS idx_admin_jobs_updated_at ON admin_jobs(updated_at);
