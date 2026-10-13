import { capacityUsage } from "@/lib/events/utils";
import { cn } from "@/lib/utils";

/** "12 / 50 registered" with a progress bar (amber when nearly full, red when full or over-booked). */
export function CapacityBar({ taken, capacity, waitlisted = 0, color, className }: { taken: number; capacity: number | null; waitlisted?: number; color?: string | null; className?: string }) {
  const usage = capacityUsage(taken, capacity);
  const barColor = !usage ? undefined : usage.over ? "var(--destructive)" : usage.ratio >= 0.9 ? "var(--chart-3)" : (color ?? "var(--primary)");
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium tabular-nums">
          {taken}
          {capacity != null && <span className="text-muted-foreground"> / {capacity}</span>}
          <span className="font-normal text-muted-foreground"> registered</span>
        </span>
        {usage?.over ? (
          <span className="font-medium text-destructive">Over capacity</span>
        ) : usage?.full ? (
          <span className="font-medium text-destructive">Full{waitlisted ? ` · ${waitlisted} waiting` : ""}</span>
        ) : usage ? (
          <span className="text-muted-foreground">{usage.left} left</span>
        ) : waitlisted ? (
          <span className="text-muted-foreground">{waitlisted} waiting</span>
        ) : null}
      </div>
      {usage && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={taken} aria-valuemax={capacity ?? undefined}>
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(usage.ratio * 100, taken > 0 ? 4 : 0)}%`, background: barColor }} />
        </div>
      )}
    </div>
  );
}
