import { NextResponse, type NextRequest } from "next/server";
import { unsubscribeByToken } from "@/lib/email/tracking";

/** RFC 8058 one-click unsubscribe (POST from mail clients). GET redirects to the preferences page. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  await unsubscribeByToken(token);
  return new NextResponse("Unsubscribed", { status: 200 });
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/u/${token}`, req.url));
}
