import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* GET /api/trades?userId=xxx */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const sql = getDb();
  const trades = await sql`
    SELECT * FROM trades WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 200
  `;
  return NextResponse.json(trades);
}

/* POST /api/trades — record a trade */
export async function POST(req: NextRequest) {
  const { userId, time, symbol, instrument, side, price, amount, fee, qty } = await req.json();
  if (!userId || !symbol) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const id = uid();
  const sql = getDb();
  await sql`
    INSERT INTO trades (id, user_id, time, symbol, instrument, side, price, amount, fee, qty)
    VALUES (${id}, ${userId}, ${time}, ${symbol}, ${instrument}, ${side}, ${price}, ${amount}, ${fee}, ${qty})
  `;
  return NextResponse.json({ id });
}
