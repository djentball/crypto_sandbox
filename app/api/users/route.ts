import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* GET /api/users — list all users with their strategies */
export async function GET() {
  const sql = getDb();
  const users = await sql`
    SELECT u.*,
           COALESCE(s.type, 'none') as strategy_type,
           COALESCE(s.symbols, '["BTCUSDT"]'::jsonb) as strategy_symbols,
           COALESCE(s.amount_per_trade, 100) as strategy_amount,
           COALESCE(s.active, false) as strategy_active
    FROM users u
    LEFT JOIN strategies s ON s.user_id = u.id
    ORDER BY u.created_at
  `;
  return NextResponse.json(users);
}

/* POST /api/users — create user */
export async function POST(req: NextRequest) {
  const { name, startBal } = await req.json();
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const bal = Math.max(0, Number(startBal) || 1000);
  const id = uid();
  const sql = getDb();

  await sql`
    INSERT INTO users (id, name, start_bal, balance, spot, futures)
    VALUES (${id}, ${name.trim()}, ${bal}, ${bal}, '{}'::jsonb, '[]'::jsonb)
  `;
  await sql`
    INSERT INTO strategies (user_id) VALUES (${id})
  `;

  return NextResponse.json({ id, name: name.trim(), startBal: bal, balance: bal });
}

/* DELETE /api/users?id=xxx */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sql = getDb();
  await sql`DELETE FROM users WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
