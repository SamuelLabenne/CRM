import Link from "next/link";
import { cn } from "@/lib/utils";

/** Segmented date-range selector rendered as links (state lives in `?range=`). */
export function RangeTabs({
  basePath,
  current,
  options,
  params = {},
  className,
}: {
  basePath: string;
  current: string;
  options: { value: string; label: string }[];
  /** Extra query params to preserve. */
  params?: Record<string, string | undefined>;
  className?: string;
}) {
  return (
    <nav aria-label="Date range" className={cn("inline-flex items-center rounded-lg border bg-muted/60 p-0.5", className)}>
      {options.map((o) => {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
        qs.set("range", o.value);
        const active = o.value === current;
        return (
          <Link
            key={o.value}
            href={`${basePath}?${qs.toString()}`}
            replace
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
              active ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/10" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
