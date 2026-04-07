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
  const { id, strategy, symbols, config, pnlPct, pnl, trades, winRate, maxDD, liquidations } = await req.json();
  if (!strategy || !config) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const sql = getDb();
  await sql`
    INSERT INTO bt_leaderboard (id, strategy, symbols, config, pnl_pct, pnl, trades, win_rate, max_dd, liquidations)
    VALUES (${id}, ${strategy}, ${JSON.stringify(symbols)}, ${config}, ${pnlPct}, ${pnl}, ${trades}, ${winRate}, ${maxDD}, ${liquidations})
  `;
  return NextResponse.json({ id });
}

/* DELETE /api/leaderboard — clear all */
export async function DELETE() {
  const sql = getDb();
  await sql`DELETE FROM bt_leaderboard`;
  return NextResponse.json({ ok: true });
}
