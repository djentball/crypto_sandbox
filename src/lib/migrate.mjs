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

  console.log("All migrations complete!");
}

migrate().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
