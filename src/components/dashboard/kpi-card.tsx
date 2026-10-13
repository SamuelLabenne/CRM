import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * KPI tile in the style of StatCard, with a comparison against the previous period.
 * `delta` is a ratio (0.12 = +12%) – a relative change for counts, a point difference for rates.
 */
export function KpiCard({
  label,
  value,
  icon: Icon,
  delta,
  deltaKind = "relative",
  hint,
  tone = "primary",
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  delta?: number | null;
  deltaKind?: "relative" | "points";
  hint?: React.ReactNode;
  tone?: "primary" | "emerald" | "sky" | "amber" | "violet" | "rose";
}) {
  const hasDelta = delta != null && Number.isFinite(delta);
  const rounded = hasDelta ? Math.round(Math.abs(delta) * 100) : 0;
  const flat = hasDelta && rounded === 0;
  const up = hasDelta && delta > 0;
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm text-muted-foreground">{label}</span>
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", TONES[tone])}>
          <Icon className="size-3.5" />
        </span>
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="flex min-h-4 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {hasDelta && (
          <span
            className={cn(
              "inline-flex items-center font-medium",
              flat ? "text-muted-foreground" : up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
            )}
            title="Compared with the previous period of the same length"
          >
            {flat ? <Minus className="size-3" /> : up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {rounded}
            {deltaKind === "points" ? " pts" : "%"}
          </span>
        )}
        {hint && <span className="truncate">{hint}</span>}
      </div>
    </Card>
  );
}

const TONES = {
  primary: "bg-primary/10 text-primary",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
} as const;
