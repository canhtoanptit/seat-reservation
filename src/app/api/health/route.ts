import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ ok: true, db: "ok" });
  } catch (err) {
    logger.error({ err }, "health check failed");
    return NextResponse.json({ ok: false, db: "error" }, { status: 503 });
  }
}
