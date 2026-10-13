import { NextResponse, type NextRequest } from "next/server";

// Optimistic auth check only (real checks happen in pages/actions via requireUser()).
const PUBLIC_PREFIXES = ["/login", "/setup", "/invite", "/e/", "/book/", "/m/", "/u/", "/embed", "/api/"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!request.cookies.has("relay_session")) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml)$).*)"],
};
