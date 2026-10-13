import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabLink = { key: string; label: React.ReactNode; href: string; count?: number };

/** Server-rendered tab bar (links), so each tab is a shareable URL and data loads per tab. */
export function TabLinks({ tabs, active, className }: { tabs: TabLink[]; active: string; className?: string }) {
  return (
    <nav aria-label="Sections" className={cn("-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]", className)}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              on ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {t.label}
            {t.count != null && (
              <span className={cn("rounded-full px-1.5 text-xs tabular-nums", on ? "bg-background text-foreground" : "bg-muted text-muted-foreground")}>{t.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
