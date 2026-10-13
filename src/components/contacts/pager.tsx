import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Server-rendered pagination: "Showing 1–50 of 1,234" + prev/next + page window. `hrefFor(page)` builds the link. */
export function Pager({
  page,
  pageCount,
  total,
  pageSize,
  hrefFor,
  noun = "contacts",
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  hrefFor: (page: number) => string;
  noun?: string;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const window: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pageCount, page + 2); p++) window.push(p);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>
        Showing {from.toLocaleString("en-AU")}–{to.toLocaleString("en-AU")} of {total.toLocaleString("en-AU")} {noun}
      </span>
      {pageCount > 1 && (
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <Button variant="outline" size="sm" asChild={page > 1} disabled={page <= 1}>
            {page > 1 ? (
              <Link href={hrefFor(page - 1)} aria-label="Previous page">
                <ChevronLeft /> Prev
              </Link>
            ) : (
              <span>
                <ChevronLeft /> Prev
              </span>
            )}
          </Button>
          <div className="hidden items-center gap-1 sm:flex">
            {window[0] > 1 && (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={hrefFor(1)}>1</Link>
                </Button>
                {window[0] > 2 && <span className="px-1">…</span>}
              </>
            )}
            {window.map((p) => (
              <Button key={p} variant={p === page ? "secondary" : "ghost"} size="sm" asChild>
                <Link href={hrefFor(p)} aria-current={p === page ? "page" : undefined}>
                  {p}
                </Link>
              </Button>
            ))}
            {window[window.length - 1] < pageCount && (
              <>
                {window[window.length - 1] < pageCount - 1 && <span className="px-1">…</span>}
                <Button variant="ghost" size="sm" asChild>
                  <Link href={hrefFor(pageCount)}>{pageCount}</Link>
                </Button>
              </>
            )}
          </div>
          <Button variant="outline" size="sm" asChild={page < pageCount} disabled={page >= pageCount}>
            {page < pageCount ? (
              <Link href={hrefFor(page + 1)} aria-label="Next page">
                Next <ChevronRight />
              </Link>
            ) : (
              <span>
                Next <ChevronRight />
              </span>
            )}
          </Button>
        </nav>
      )}
    </div>
  );
}
