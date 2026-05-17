import { neon } from '@neondatabase/serverless';
import type { StockData } from './types';

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL env var is not set');
  return neon(url);
}

let schemaReady = false;

export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const sql = getSql();

  // Create tables with per-user schema
  await sql`
    CREATE TABLE IF NOT EXISTS watchlist (
      user_id  TEXT NOT NULL,
      symbol   TEXT NOT NULL,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, symbol)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS recipients (
      user_id  TEXT NOT NULL,
      email    TEXT NOT NULL,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, email)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS stock_cache (
      symbol     TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      key        TEXT PRIMARY KEY,
      value      JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  // Migrate watchlist from old schema (no user_id) if needed
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'watchlist' AND column_name = 'user_id'
      ) THEN
        ALTER TABLE watchlist ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
        TRUNCATE TABLE watchlist;
        ALTER TABLE watchlist DROP CONSTRAINT IF EXISTS watchlist_pkey;
        ALTER TABLE watchlist ADD PRIMARY KEY (user_id, symbol);
      END IF;
    END $$
  `;

  // Migrate recipients from old schema if needed
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'recipients' AND column_name = 'user_id'
      ) THEN
        ALTER TABLE recipients ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
        TRUNCATE TABLE recipients;
        ALTER TABLE recipients DROP CONSTRAINT IF EXISTS recipients_pkey;
        ALTER TABLE recipients ADD PRIMARY KEY (user_id, email);
      END IF;
    END $$
  `;

  schemaReady = true;
}

// ─── Watchlist ────────────────────────────────────────────────

export async function getWatchlist(userId: string): Promise<string[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT symbol FROM watchlist WHERE user_id = ${userId} ORDER BY added_at
  `;
  if (rows.length === 0) {
    // Seed defaults for new users
    await sql`
      INSERT INTO watchlist (user_id, symbol)
      SELECT ${userId}, unnest(ARRAY['AAPL','MSFT','GOOGL','NVDA','TSLA'])
      ON CONFLICT DO NOTHING
    `;
    return ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA'];
  }
  return rows.map(r => r.symbol as string);
}

export async function addToWatchlist(
  userId: string,
  symbol: string
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO watchlist (user_id, symbol) VALUES (${userId}, ${symbol})
    ON CONFLICT DO NOTHING
  `;
}

export async function removeFromWatchlist(
  userId: string,
  symbol: string
): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM watchlist WHERE user_id = ${userId} AND symbol = ${symbol}`;
}

// Returns all unique symbols across every user's watchlist (for cron jobs)
export async function getAllWatchlistSymbols(): Promise<string[]> {
  const sql = getSql();
  const rows = await sql`SELECT DISTINCT symbol FROM watchlist ORDER BY symbol`;
  return rows.map(r => r.symbol as string);
}

export interface UserWatchlist {
  userId: string;
  symbols: string[];
}

// Returns each user's watchlist (for per-user alert emails)
export async function getAllUserWatchlists(): Promise<UserWatchlist[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT user_id, array_agg(symbol ORDER BY added_at) AS symbols
    FROM watchlist
    GROUP BY user_id
  `;
  return rows.map(r => ({
    userId: r.user_id as string,
    symbols: r.symbols as string[],
  }));
}

// ─── Recipients ───────────────────────────────────────────────

export async function getRecipients(userId: string): Promise<string[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT email FROM recipients WHERE user_id = ${userId} ORDER BY added_at
  `;
  return rows.map(r => r.email as string);
}

export async function addRecipient(
  userId: string,
  email: string
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO recipients (user_id, email) VALUES (${userId}, ${email})
    ON CONFLICT DO NOTHING
  `;
}

export async function removeRecipient(
  userId: string,
  email: string
): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM recipients WHERE user_id = ${userId} AND email = ${email}`;
}

// ─── Stock cache ──────────────────────────────────────────────

export async function getCachedStocks(userId: string): Promise<StockData[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT s.data
    FROM stock_cache s
    JOIN watchlist w ON w.symbol = s.symbol AND w.user_id = ${userId}
    ORDER BY w.added_at
  `;
  return rows.map(r => r.data as StockData);
}

export async function getLastPoll(): Promise<string | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT MAX(updated_at) as last_poll FROM stock_cache
  `;
  const val = rows[0]?.last_poll;
  if (!val) return null;
  return new Date(val).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export async function upsertStockCache(
  symbol: string,
  data: StockData
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO stock_cache (symbol, data, updated_at)
    VALUES (${symbol}, ${JSON.stringify(data)}, NOW())
    ON CONFLICT (symbol) DO UPDATE
      SET data = EXCLUDED.data, updated_at = NOW()
  `;
}

// ─── App state ────────────────────────────────────────────────

export async function getAlertsSent(): Promise<number> {
  const sql = getSql();
  const rows =
    await sql`SELECT value FROM app_state WHERE key = 'alerts_sent'`;
  return (rows[0]?.value as number) ?? 0;
}

export async function incrementAlertsSent(count: number): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO app_state (key, value)
    VALUES ('alerts_sent', ${count})
    ON CONFLICT (key) DO UPDATE
      SET value = (COALESCE((app_state.value)::int, 0) + ${count})::text::jsonb
  `;
}
