import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** KPI tile. `delta` is a ratio vs previous period (0.12 = +12%). */
export function StatCard({
  label,
  value,
  hint,
  delta,
  icon: Icon,
  invertDelta,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: number | null;
  icon?: LucideIcon;
  /** For metrics where down is good (e.g. no-show rate). */
  invertDelta?: boolean;
  className?: string;
}) {
  const good = delta != null && (invertDelta ? delta < 0 : delta > 0);
  return (
    <Card className={cn("gap-2 p-4", className)}>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="size-4" />}
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {delta != null && Number.isFinite(delta) && (
          <span className={cn("inline-flex items-center font-medium", good ? "text-success" : delta === 0 ? "" : "text-destructive")}>
            {delta > 0 ? <ArrowUpRight className="size-3" /> : delta < 0 ? <ArrowDownRight className="size-3" /> : null}
            {Math.abs(delta * 100).toFixed(0)}%
          </span>
        )}
        {hint}
      </div>
    </Card>
  );
}
