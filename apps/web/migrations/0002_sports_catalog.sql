-- Full open-sports catalog: one state row per resumable traversal.
-- Keep market quotes in bounded JSON chunks to stay within D1 Free write limits.
-- This does not modify the existing market_history or radar_scans tables.
CREATE TABLE IF NOT EXISTS sports_catalog_runs (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('building', 'complete')),
  cursor TEXT NOT NULL DEFAULT '',
  pages_scanned INTEGER NOT NULL DEFAULT 0,
  sports_events INTEGER NOT NULL DEFAULT 0,
  markets_found INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  retry_after TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_sports_catalog_runs_status
  ON sports_catalog_runs (status, completed_at DESC, started_at DESC);

CREATE TABLE IF NOT EXISTS sports_catalog_pages (
  run_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (run_id, page_index, chunk_index),
  FOREIGN KEY (run_id) REFERENCES sports_catalog_runs(id)
);
