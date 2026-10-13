import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { processDueJobs } from "@/lib/jobs/runner";

/** Opportunistic job processing while someone has the app open (backup for cron). */
export async function POST() {
  if (!(await getCurrentUser())) return NextResponse.json({ ok: false }, { status: 401 });
  const hb = await getSetting("jobsHeartbeat");
  if (hb.at && Date.now() - new Date(hb.at).getTime() < 50_000) return NextResponse.json({ ok: true, skipped: true });
  const res = await processDueJobs({ maxBatches: 4 });
  return NextResponse.json({ ok: true, ...res });
}
