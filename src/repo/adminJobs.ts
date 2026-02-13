import type { Env } from "../env";
import { dbFirst, dbRun } from "../db";
import { nowMs } from "../utils/time";

export type AdminJobType = "token_refresh" | "token_nsfw_refresh";
export type AdminJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface AdminJobRow {
  job_id: string;
  job_type: string;
  status: string;
  total: number;
  processed: number;
  success: number;
  failed: number;
  invalidated: number;
  current_step: string;
  last_error: string;
  payload_json: string;
  result_json: string;
  cancel_requested: number;
  created_at: number;
  updated_at: number;
}

export interface AdminJob {
  job_id: string;
  job_type: AdminJobType;
  status: AdminJobStatus;
  total: number;
  processed: number;
  success: number;
  failed: number;
  invalidated: number;
  current_step: string;
  last_error: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  cancel_requested: boolean;
  created_at: number;
  updated_at: number;
}

interface CreateAdminJobInput {
  job_id: string;
  job_type: AdminJobType;
  total: number;
  payload?: Record<string, unknown>;
}

interface UpdateAdminJobInput {
  status?: AdminJobStatus;
  total?: number;
  processed?: number;
  success?: number;
  failed?: number;
  invalidated?: number;
  current_step?: string;
  last_error?: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

let tableReady = false;

function parseJsonObject(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed json
  }
  return {};
}

function toAdminJob(row: AdminJobRow): AdminJob {
  return {
    job_id: row.job_id,
    job_type: row.job_type as AdminJobType,
    status: row.status as AdminJobStatus,
    total: Number(row.total || 0),
    processed: Number(row.processed || 0),
    success: Number(row.success || 0),
    failed: Number(row.failed || 0),
    invalidated: Number(row.invalidated || 0),
    current_step: row.current_step || "",
    last_error: row.last_error || "",
    payload: parseJsonObject(row.payload_json || "{}"),
    result: parseJsonObject(row.result_json || "{}"),
    cancel_requested: row.cancel_requested === 1,
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  };
}

async function ensureAdminJobsTable(db: Env["DB"]): Promise<void> {
  if (tableReady) return;
  await dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS admin_jobs (
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
    )`,
  );
  await dbRun(db, "CREATE INDEX IF NOT EXISTS idx_admin_jobs_type_status ON admin_jobs(job_type, status)");
  await dbRun(db, "CREATE INDEX IF NOT EXISTS idx_admin_jobs_updated_at ON admin_jobs(updated_at)");
  tableReady = true;
}

export async function createAdminJob(db: Env["DB"], input: CreateAdminJobInput): Promise<AdminJob> {
  await ensureAdminJobsTable(db);
  const now = nowMs();
  const payload = JSON.stringify(input.payload || {});
  await dbRun(
    db,
    `INSERT INTO admin_jobs(
      job_id, job_type, status, total, processed, success, failed, invalidated,
      current_step, last_error, payload_json, result_json, cancel_requested, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.job_id,
      input.job_type,
      "queued",
      Math.max(0, Math.floor(Number(input.total || 0))),
      0,
      0,
      0,
      0,
      "queued",
      "",
      payload,
      "{}",
      0,
      now,
      now,
    ],
  );
  const created = await getAdminJob(db, input.job_id);
  if (!created) throw new Error("Create job failed");
  return created;
}

export async function getAdminJob(db: Env["DB"], jobId: string): Promise<AdminJob | null> {
  await ensureAdminJobsTable(db);
  const row = await dbFirst<AdminJobRow>(db, "SELECT * FROM admin_jobs WHERE job_id = ?", [jobId]);
  return row ? toAdminJob(row) : null;
}

export async function findRunningAdminJobByType(db: Env["DB"], type: AdminJobType): Promise<AdminJob | null> {
  await ensureAdminJobsTable(db);
  const row = await dbFirst<AdminJobRow>(
    db,
    "SELECT * FROM admin_jobs WHERE job_type = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",
    [type],
  );
  return row ? toAdminJob(row) : null;
}

export async function updateAdminJob(db: Env["DB"], jobId: string, input: UpdateAdminJobInput): Promise<void> {
  await ensureAdminJobsTable(db);
  const current = await getAdminJob(db, jobId);
  if (!current) return;
  const now = nowMs();
  const nextPayload = input.payload ? JSON.stringify(input.payload) : JSON.stringify(current.payload || {});
  const nextResult = input.result ? JSON.stringify(input.result) : JSON.stringify(current.result || {});
  await dbRun(
    db,
    `UPDATE admin_jobs SET
      status = ?,
      total = ?,
      processed = ?,
      success = ?,
      failed = ?,
      invalidated = ?,
      current_step = ?,
      last_error = ?,
      payload_json = ?,
      result_json = ?,
      updated_at = ?
    WHERE job_id = ?`,
    [
      input.status || current.status,
      input.total ?? current.total,
      input.processed ?? current.processed,
      input.success ?? current.success,
      input.failed ?? current.failed,
      input.invalidated ?? current.invalidated,
      input.current_step ?? current.current_step,
      input.last_error ?? current.last_error,
      nextPayload,
      nextResult,
      now,
      jobId,
    ],
  );
}

export async function requestCancelAdminJob(db: Env["DB"], jobId: string): Promise<boolean> {
  await ensureAdminJobsTable(db);
  const now = nowMs();
  await dbRun(db, "UPDATE admin_jobs SET cancel_requested = 1, updated_at = ? WHERE job_id = ?", [now, jobId]);
  const job = await getAdminJob(db, jobId);
  return Boolean(job?.cancel_requested);
}

export async function cleanupAdminJobsByStatus(db: Env["DB"], statuses: AdminJobStatus[]): Promise<number> {
  await ensureAdminJobsTable(db);
  const deduped = Array.from(new Set((statuses || []).filter(Boolean)));
  if (!deduped.length) return 0;
  const placeholders = deduped.map(() => "?").join(",");
  const countRow = await dbFirst<{ total: number }>(
    db,
    `SELECT COUNT(1) AS total FROM admin_jobs WHERE status IN (${placeholders})`,
    deduped,
  );
  const total = Number(countRow?.total || 0);
  if (total <= 0) return 0;
  await dbRun(db, `DELETE FROM admin_jobs WHERE status IN (${placeholders})`, deduped);
  return total;
}
