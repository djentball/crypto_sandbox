import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/* GET /api/leaderboard — top 50 sorted by pnl_pct DESC */
export async function GET() {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM bt_leaderboard ORDER BY pnl_pct DESC LIMIT 50
  `;
  return NextResponse.json(rows);
}

/* POST /api/leaderboard — add a backtest result */
export async function POST(req: NextRequest) {
  try {
    const { id, strategy, symbols, instrument, leverage, timeframe, period, slPct, tpPct, pnlPct, pnl, trades, winRate, maxDD, liquidations } = await req.json();
    if (!strategy) {
      return NextResponse.json({ error: "missing fields" }, { status: 400 });
    }
    const sql = getDb();
    await sql`
      INSERT INTO bt_leaderboard (id, strategy, symbols, instrument, leverage, timeframe, period, sl_pct, tp_pct, pnl_pct, pnl, trades, win_rate, max_dd, liquidations)
      VALUES (${id}, ${strategy}, ${JSON.stringify(symbols)}, ${instrument || "FUTURES"}, ${leverage || 5}, ${timeframe || "1h"}, ${period || "3m"}, ${slPct ?? 0}, ${tpPct ?? 0}, ${pnlPct ?? 0}, ${pnl ?? 0}, ${trades ?? 0}, ${winRate ?? 0}, ${maxDD ?? 0}, ${liquidations ?? 0})
    `;
    return NextResponse.json({ id });
  } catch (e: unknown) {
    console.error("Leaderboard POST error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/* DELETE /api/leaderboard — clear all */
export async function DELETE() {
  const sql = getDb();
  await sql`DELETE FROM bt_leaderboard`;
  return NextResponse.json({ ok: true });
}
