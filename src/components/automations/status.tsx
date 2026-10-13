import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge, type Tone } from "@/components/app/status-badge";
import { cn } from "@/lib/utils";

export const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Running", tone: "blue" },
  waiting: { label: "Waiting", tone: "amber" },
  completed: { label: "Completed", tone: "green" },
  exited: { label: "Exited", tone: "neutral" },
  failed: { label: "Failed", tone: "red" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const LOG_STATUS: Record<string, { label: string; tone: Tone }> = {
  ok: { label: "OK", tone: "green" },
  skipped: { label: "Skipped", tone: "amber" },
  error: { label: "Error", tone: "red" },
  exited: { label: "Exited", tone: "neutral" },
};

export function RunStatusBadge({ status }: { status: string }) {
  const s = RUN_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

/** Underlined route tabs (server-rendered links). */
export function RouteTabs({ tabs, active, className }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string; className?: string }) {
  return (
    <nav className={cn("flex gap-1 overflow-x-auto", className)} aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
            t.key === active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          {t.count != null && <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Small filter pills that live in the URL. */
export function FilterPills({ items, active }: { items: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === active ? "true" : undefined}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            i.key === active ? "border-primary bg-primary/10 text-foreground" : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

export function ListPagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        {page <= 1 ? (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft /> Previous
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(page - 1)}>
              <ChevronLeft /> Previous
            </Link>
          </Button>
        )}
        <span className="tabular-nums">
          Page {page} of {pages}
        </span>
        {page >= pages ? (
          <Button variant="outline" size="sm" disabled>
            Next <ChevronRight />
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(page + 1)}>
              Next <ChevronRight />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
