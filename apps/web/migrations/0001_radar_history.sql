-- Phase 1: append one scan every 30 minutes and retain its market prices.
-- Both tables are written by the scheduled Worker only.
CREATE TABLE IF NOT EXISTS radar_scans (
  scanned_at TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_history (
  ticker TEXT NOT NULL,
  sampled_at TEXT NOT NULL,
  yes_ask REAL,
  yes_bid REAL,
  last_price REAL,
  volume_24h REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (ticker, sampled_at)
);

CREATE INDEX IF NOT EXISTS idx_history_time ON market_history (sampled_at);
