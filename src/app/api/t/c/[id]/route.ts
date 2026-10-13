import { NextResponse, type NextRequest } from "next/server";
import { verifySignature } from "@/lib/crypto";
import { recordClick } from "@/lib/email/tracking";

/** Click-tracking redirect. Only signed URLs are followed (no open redirect). */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/t/c/[id]">) {
  const { id } = await ctx.params;
  const url = req.nextUrl.searchParams.get("u") ?? "";
  const sig = req.nextUrl.searchParams.get("s");
  if (!/^https?:\/\//i.test(url) || !verifySignature(`${id}|${url}`, sig)) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  await recordClick(id, url).catch(() => {});
  return NextResponse.redirect(url, 302);
}
