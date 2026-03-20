import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/* PATCH /api/users/:id — update user balance, spot, futures */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const sql = getDb();

  const sets: string[] = [];
  const vals: Record<string, unknown> = {};

  if (body.balance !== undefined) {
    await sql`UPDATE users SET balance = ${body.balance} WHERE id = ${id}`;
  }
  if (body.spot !== undefined) {
    await sql`UPDATE users SET spot = ${JSON.stringify(body.spot)}::jsonb WHERE id = ${id}`;
  }
  if (body.futures !== undefined) {
    await sql`UPDATE users SET futures = ${JSON.stringify(body.futures)}::jsonb WHERE id = ${id}`;
  }

  return NextResponse.json({ ok: true });
}
