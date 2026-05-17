-- Run this once in your Neon SQL editor to set up the database schema

CREATE TABLE IF NOT EXISTS watchlist (
  symbol    TEXT PRIMARY KEY,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recipients (
  email     TEXT PRIMARY KEY,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_cache (
  symbol     TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_state (
  key        TEXT PRIMARY KEY,
  value      JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default watchlist
INSERT INTO watchlist (symbol) VALUES
  ('AAPL'), ('MSFT'), ('GOOGL'), ('NVDA'), ('TSLA')
ON CONFLICT DO NOTHING;
