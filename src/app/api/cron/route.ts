import { NextResponse, type NextRequest } from "next/server";
import { processDueJobs } from "@/lib/jobs/runner";
import { safeEqual } from "@/lib/crypto";

export const maxDuration = 60;

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (req.nextUrl.searchParams.get("secret") ?? "");
  return safeEqual(token, secret);
}

/** Processes due background jobs. Called every minute by Supabase pg_cron / Vercel cron. */
async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await processDueJobs({ maxBatches: 12 });
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
