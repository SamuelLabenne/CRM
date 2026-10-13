import { formatInTz } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Calendar-style date tile rendered in a fixed timezone (staff views). */
export function DateBlock({ date, tz, color, className }: { date: Date; tz: string; color?: string | null; className?: string }) {
  return (
    <div
      className={cn("flex size-14 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border bg-card text-center shadow-xs", className)}
      style={color ? { borderTopColor: color, borderTopWidth: 3 } : undefined}
    >
      <span className="text-[10px] leading-none font-semibold tracking-wider text-muted-foreground uppercase">{formatInTz(date, tz, "MMM")}</span>
      <span className="mt-0.5 text-xl leading-none font-bold tabular-nums">{formatInTz(date, tz, "d")}</span>
    </div>
  );
}
