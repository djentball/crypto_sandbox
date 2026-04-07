/**
 * Seed bt_leaderboard with backtest results from backtest-all.mjs
 * Run: node lib/seed-leaderboard.mjs
 * Requires DATABASE_URL in .env.local
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const sql = neon(process.env.DATABASE_URL);
const uid = () => Math.random().toString(36).slice(2, 10);

const results = [
  { strategy: "Scalp: SMC Inducement", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "4h", period: "3m", slPct: 2, tpPct: 6, pnlPct: 9.1, pnl: 91.0, trades: 21, winRate: 42.9, maxDD: 3.3, liquidations: 0 },
  { strategy: "Donchian Breakout", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "1h", period: "3m", slPct: 2, tpPct: 5, pnlPct: 7.6, pnl: 76.0, trades: 26, winRate: 42.3, maxDD: 3.4, liquidations: 0 },
  { strategy: "RSI Mean Reversion", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "1h", period: "3m", slPct: 2, tpPct: 5, pnlPct: 6.9, pnl: 69.0, trades: 26, winRate: 42.3, maxDD: 3.7, liquidations: 0 },
  { strategy: "EMA Crossover", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "1h", period: "3m", slPct: 2, tpPct: 5, pnlPct: 6.4, pnl: 64.0, trades: 28, winRate: 39.3, maxDD: 3.4, liquidations: 0 },
  { strategy: "Stochastic RSI", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "4h", period: "3m", slPct: 2, tpPct: 6, pnlPct: 5.7, pnl: 57.0, trades: 23, winRate: 34.8, maxDD: 2.9, liquidations: 0 },
  { strategy: "SMC: Break of Structure", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "1h", period: "3m", slPct: 2, tpPct: 5, pnlPct: 5.3, pnl: 53.0, trades: 33, winRate: 36.4, maxDD: 5.0, liquidations: 0 },
  { strategy: "SMC: Break of Structure", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "4h", period: "3m", slPct: 2, tpPct: 6, pnlPct: 3.9, pnl: 39.0, trades: 14, winRate: 35.7, maxDD: 4.2, liquidations: 0 },
  { strategy: "Scalp: SMC Inducement", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "1h", period: "3m", slPct: 1, tpPct: 2, pnlPct: 3.2, pnl: 32.0, trades: 104, winRate: 39.4, maxDD: 4.4, liquidations: 0 },
  { strategy: "RSI Mean Reversion", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "4h", period: "3m", slPct: 2, tpPct: 6, pnlPct: 2.7, pnl: 27.0, trades: 15, winRate: 33.3, maxDD: 2.4, liquidations: 0 },
  { strategy: "SMC: Order Block", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "4h", period: "3m", slPct: 2, tpPct: 6, pnlPct: 2.4, pnl: 24.0, trades: 23, winRate: 30.4, maxDD: 2.9, liquidations: 0 },
  { strategy: "RSI Mean Reversion", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "1h", period: "3m", slPct: 1, tpPct: 3, pnlPct: 2.4, pnl: 24.0, trades: 37, winRate: 32.4, maxDD: 1.9, liquidations: 0 },
  { strategy: "RSI Mean Reversion", symbols: ["BTC"], instrument: "FUTURES", leverage: 3, timeframe: "1h", period: "3m", slPct: 1, tpPct: 3, pnlPct: 2.4, pnl: 24.0, trades: 37, winRate: 32.4, maxDD: 1.9, liquidations: 0 },
  { strategy: "Bollinger Bands", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "4h", period: "3m", slPct: 2, tpPct: 6, pnlPct: 2.1, pnl: 21.0, trades: 12, winRate: 33.3, maxDD: 1.3, liquidations: 0 },
  { strategy: "Scalp: SMA(5)×EMA(9)", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "4h", period: "3m", slPct: 2, tpPct: 6, pnlPct: 2.0, pnl: 20.0, trades: 2, winRate: 50.0, maxDD: 0.6, liquidations: 0 },
  { strategy: "Scalp: SMC Inducement", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "1h", period: "6m", slPct: 1, tpPct: 3, pnlPct: 1.7, pnl: 17.0, trades: 165, winRate: 27.9, maxDD: 5.4, liquidations: 0 },
  { strategy: "Donchian Breakout", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "1h", period: "3m", slPct: 1, tpPct: 2, pnlPct: 1.6, pnl: 16.0, trades: 45, winRate: 40.0, maxDD: 1.7, liquidations: 0 },
  { strategy: "SMC: Break of Structure", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "1h", period: "6m", slPct: 1, tpPct: 3, pnlPct: 1.3, pnl: 13.0, trades: 133, winRate: 27.8, maxDD: 6.4, liquidations: 0 },
  { strategy: "MACD Crossover", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "4h", period: "3m", slPct: 2, tpPct: 6, pnlPct: 1.3, pnl: 13.0, trades: 21, winRate: 28.6, maxDD: 3.5, liquidations: 0 },
  { strategy: "Donchian Breakout", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "1h", period: "6m", slPct: 1, tpPct: 3, pnlPct: 1.1, pnl: 11.0, trades: 86, winRate: 27.9, maxDD: 4.3, liquidations: 0 },
  { strategy: "RSI Mean Reversion", symbols: ["BTC"], instrument: "FUTURES", leverage: 5, timeframe: "1h", period: "6m", slPct: 1, tpPct: 3, pnlPct: 1.0, pnl: 10.0, trades: 86, winRate: 27.9, maxDD: 4.2, liquidations: 0 },
];

async function seed() {
  /* clear existing data first */
  await sql`DELETE FROM bt_leaderboard`;
  console.log("Cleared existing leaderboard data");

  console.log(`Seeding ${results.length} leaderboard entries...`);
  for (const r of results) {
    const id = uid();
    await sql`
      INSERT INTO bt_leaderboard (id, strategy, symbols, instrument, leverage, timeframe, period, sl_pct, tp_pct, pnl_pct, pnl, trades, win_rate, max_dd, liquidations)
      VALUES (${id}, ${r.strategy}, ${JSON.stringify(r.symbols)}, ${r.instrument}, ${r.leverage}, ${r.timeframe}, ${r.period}, ${r.slPct}, ${r.tpPct}, ${r.pnlPct}, ${r.pnl}, ${r.trades}, ${r.winRate}, ${r.maxDD}, ${r.liquidations})
    `;
    console.log(`  ✓ ${r.strategy} | ${r.timeframe} x${r.leverage} SL${r.slPct}/TP${r.tpPct} | +${r.pnlPct}%`);
  }
  console.log("Done!");
}

seed().catch(console.error);
