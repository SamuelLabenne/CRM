import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { decodeFilter } from "@/lib/contacts/filter-codec";
import { buildContactsCsv } from "@/lib/contacts/export";
import { QUICK_FILTER_KEYS, type QuickFilters } from "@/lib/contacts/query";

/**
 * GET /contacts/export?q=&f=&stage=&lead=&tag=&owner=&email=&source=   → everything matching
 * GET /contacts/export?ids=<uuid>,<uuid>…                               → explicit selection
 * Same query parameters as the /contacts page, so "Export" always matches what you see.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const idsParam = p.get("ids");
  let result;
  if (idsParam !== null) {
    const ids = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
    result = await buildContactsCsv({ ids });
  } else {
    const quick: QuickFilters = {};
    for (const k of QUICK_FILTER_KEYS) {
      const v = p.get(k);
      if (v) quick[k] = v;
    }
    result = await buildContactsCsv({ query: { q: p.get("q"), quick, filter: decodeFilter(p.get("f")) } });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse("﻿" + result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Contact-Count": String(result.count),
    },
  });
}
