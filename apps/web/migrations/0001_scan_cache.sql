-- Shared market snapshot and atomic lease. Provider scope is encoded in cache_key.
CREATE TABLE IF NOT EXISTS scan_cache (
  cache_key TEXT PRIMARY KEY,
  snapshot TEXT,
  captured_at INTEGER,
  expires_at INTEGER,
  lease_token TEXT,
  lease_until INTEGER
);
CREATE INDEX IF NOT EXISTS idx_scan_cache_expiry ON scan_cache(expires_at);
