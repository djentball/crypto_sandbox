import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/* PATCH /api/strategies — update strategy for a user */
export async function PATCH(req: NextRequest) {
  const { userId, type, symbols, amountPerTrade, active } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const sql = getDb();

  await sql`
    INSERT INTO strategies (user_id, type, symbols, amount_per_trade, active)
    VALUES (${userId}, ${type ?? "none"}, ${JSON.stringify(symbols ?? ["BTCUSDT"])}::jsonb, ${amountPerTrade ?? 100}, ${active ?? false})
    ON CONFLICT (user_id) DO UPDATE SET
      type = COALESCE(${type}, strategies.type),
      symbols = COALESCE(${symbols ? JSON.stringify(symbols) : null}::jsonb, strategies.symbols),
      amount_per_trade = COALESCE(${amountPerTrade ?? null}, strategies.amount_per_trade),
      active = COALESCE(${active ?? null}, strategies.active)
  `;
  return NextResponse.json({ ok: true });
}

/* GET /api/strategies?userId=xxx — get strategy log */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const sql = getDb();
  const logs = await sql`
    SELECT * FROM strategy_log WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50
  `;
  return NextResponse.json(logs);
}

/* POST /api/strategies — add strategy log entry */
export async function POST(req: NextRequest) {
  const { userId, time, symbol, action, price, amount, reason } = await req.json();
  if (!userId || !symbol) return NextResponse.json({ error: "missing fields" }, { status: 400 });
  const sql = getDb();
  await sql`
    INSERT INTO strategy_log (user_id, time, symbol, action, price, amount, reason)
    VALUES (${userId}, ${time}, ${symbol}, ${action}, ${price}, ${amount}, ${reason})
  `;
  return NextResponse.json({ ok: true });
}
