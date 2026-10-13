import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { attendeesCsv } from "@/lib/events/manage";
import { slugify } from "@/lib/format";

/** CSV export of an event's attendees (auth required). */
export async function GET(_req: Request, ctx: RouteContext<"/events/[id]/export">) {
  await requireUser();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ws = await getSetting("workspace");
  const out = await attendeesCsv(id, ws.timezone);
  if (!out) notFound();
  return new Response(`﻿${out.csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slugify(out.event.title) || "event"}-attendees.csv"`,
      "cache-control": "no-store",
    },
  });
}
