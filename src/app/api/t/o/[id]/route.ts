import { type NextRequest } from "next/server";
import { recordOpen } from "@/lib/email/tracking";

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** Open-tracking pixel. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/t/o/[id]">) {
  const { id } = await ctx.params;
  await recordOpen(id).catch(() => {});
  return new Response(GIF, {
    headers: {
      "content-type": "image/gif",
      "cache-control": "no-store, no-cache, must-revalidate, private",
    },
  });
}
