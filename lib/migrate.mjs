/**
 * Run: npm run db:migrate
 * Requires DATABASE_URL in .env or environment
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  console.log("Running migrations...");

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      start_bal     DOUBLE PRECISION NOT NULL DEFAULT 1000,
      balance       DOUBLE PRECISION NOT NULL DEFAULT 1000,
      spot          JSONB NOT NULL DEFAULT '{}',
      futures       JSONB NOT NULL DEFAULT '[]',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  console.log("  ✓ users");

  await sql`
    CREATE TABLE IF NOT EXISTS trades (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time          TEXT NOT NULL,
      symbol        TEXT NOT NULL,
      instrument    TEXT NOT NULL,
      side          TEXT NOT NULL,
      price         DOUBLE PRECISION NOT NULL,
      amount        DOUBLE PRECISION NOT NULL,
      fee           DOUBLE PRECISION NOT NULL,
      qty           DOUBLE PRECISION NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  console.log("  ✓ trades");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS strategies (
      user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      type              TEXT NOT NULL DEFAULT 'none',
      symbols           JSONB NOT NULL DEFAULT '["BTCUSDT"]',
      amount_per_trade  DOUBLE PRECISION NOT NULL DEFAULT 100,
      active            BOOLEAN NOT NULL DEFAULT false
    )
  `;
  console.log("  ✓ strategies");

  await sql`
    CREATE TABLE IF NOT EXISTS strategy_log (
      id            SERIAL PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time          TEXT NOT NULL,
      symbol        TEXT NOT NULL,
      action        TEXT NOT NULL,
      price         DOUBLE PRECISION NOT NULL,
      amount        DOUBLE PRECISION NOT NULL,
      reason        TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  console.log("  ✓ strategy_log");

  await sql`
    CREATE INDEX IF NOT EXISTS idx_strategy_log_user ON strategy_log(user_id)
  `;

  /* v2: add timeframe column to strategies */
  await sql`
    ALTER TABLE strategies ADD COLUMN IF NOT EXISTS timeframe TEXT NOT NULL DEFAULT '15m'
  `;
  console.log("  ✓ strategies.timeframe column");

  /* v3: add futures fields to strategies (instrument, leverage, sl_pct, tp_pct) */
  await sql`ALTER TABLE strategies ADD COLUMN IF NOT EXISTS instrument TEXT NOT NULL DEFAULT 'SPOT'`;
  await sql`ALTER TABLE strategies ADD COLUMN IF NOT EXISTS leverage INTEGER NOT NULL DEFAULT 5`;
  await sql`ALTER TABLE strategies ADD COLUMN IF NOT EXISTS sl_pct DOUBLE PRECISION NOT NULL DEFAULT 3`;
  await sql`ALTER TABLE strategies ADD COLUMN IF NOT EXISTS tp_pct DOUBLE PRECISION NOT NULL DEFAULT 15`;
  console.log("  ✓ strategies futures columns (instrument, leverage, sl_pct, tp_pct)");

  /* v4: backtest leaderboard (drop old schema if columns changed) */
  await sql`DROP TABLE IF EXISTS bt_leaderboard`;
  await sql`
    CREATE TABLE IF NOT EXISTS bt_leaderboard (
      id            TEXT PRIMARY KEY,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      strategy      TEXT NOT NULL,
      symbols       JSONB NOT NULL DEFAULT '[]',
      instrument    TEXT NOT NULL DEFAULT 'FUTURES',
      leverage      INTEGER NOT NULL DEFAULT 5,
      timeframe     TEXT NOT NULL DEFAULT '1h',
      period        TEXT NOT NULL DEFAULT '3m',
      sl_pct        DOUBLE PRECISION NOT NULL DEFAULT 0,
      tp_pct        DOUBLE PRECISION NOT NULL DEFAULT 0,
      pnl_pct       DOUBLE PRECISION NOT NULL,
      pnl           DOUBLE PRECISION NOT NULL,
      trades        INTEGER NOT NULL,
      win_rate      DOUBLE PRECISION NOT NULL,
      max_dd        DOUBLE PRECISION NOT NULL,
      liquidations  INTEGER NOT NULL DEFAULT 0
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_bt_leaderboard_pnl ON bt_leaderboard(pnl_pct DESC)`;
  console.log("  ✓ bt_leaderboard");

  console.log("All migrations complete!");
}

migrate().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
