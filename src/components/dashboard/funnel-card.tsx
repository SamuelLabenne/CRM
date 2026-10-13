import { Filter } from "lucide-react";
import type { FunnelStep } from "@/lib/analytics/dashboard";
import { formatNumber, formatPercent } from "@/lib/format";
import { ratio } from "@/lib/analytics/metrics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const SHADES = ["bg-chart-1", "bg-chart-1/80", "bg-chart-1/60", "bg-chart-1/40"];

/** Page views → potential leads → registrations & bookings → attended. */
export function FunnelCard({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  const empty = steps.every((s) => s.value === 0);
  const overall = ratio(steps[2]?.value, steps[0]?.value);
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="size-4 text-muted-foreground" /> Public funnel
        </CardTitle>
        <CardDescription>From landing on a registration or booking page to showing up.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <div key={s.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{s.label}</span>
              <span className="flex items-baseline gap-2">
                {i > 0 && s.rate != null && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                    {formatPercent(s.rate, 0)}
                  </span>
                )}
                <span className="font-semibold tabular-nums">{formatNumber(s.value)}</span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all", SHADES[i] ?? SHADES[3])}
                style={{ width: `${s.value === 0 ? 0 : Math.max(3, (s.value / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
        <p className="border-t pt-3 text-xs text-muted-foreground">
          {empty
            ? "No public page activity in this period yet. Share a registration or booking link to start filling the funnel."
            : overall != null
              ? `${formatPercent(overall)} of unique visitors registered or booked. Counts include sign-ups from public and booking pages only.`
              : "Counts include sign-ups from public and booking pages only."}
        </p>
      </CardContent>
    </Card>
  );
}
