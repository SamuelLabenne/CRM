import Link from "next/link";
import { ArrowRight, Check, Rocket } from "lucide-react";
import type { OnboardingState } from "@/lib/analytics/dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/** Getting-started checklist; completion is computed from real workspace data. */
export function GettingStarted({ state, welcome, firstName }: { state: OnboardingState; welcome: boolean; firstName: string }) {
  const pct = Math.round((state.done / state.total) * 100);
  const next = state.items.find((i) => !i.done);
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <CardHeader className="gap-3 border-b bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Rocket className="size-5" />
          </span>
          <div>
            <CardTitle className="text-base">{welcome ? `Welcome to Relay, ${firstName}!` : "Getting started"}</CardTitle>
            <CardDescription>
              {state.done === state.total
                ? "You're all set up. Nice work."
                : "Six quick steps to your first registrations, bookings and follow-ups."}
            </CardDescription>
          </div>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-64">
          <Progress value={pct} className="flex-1" aria-label="Setup progress" />
          <span className="text-xs font-medium whitespace-nowrap text-muted-foreground tabular-nums">
            {state.done} of {state.total}
          </span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-px bg-border p-0 sm:grid-cols-2 xl:grid-cols-3">
        {state.items.map((item, i) => (
          <div key={item.key} className={cn("flex items-start gap-3 bg-card p-4", item.done && "bg-muted/30")}>
            <span
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                item.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-border text-muted-foreground",
              )}
              aria-label={item.done ? "Done" : `Step ${i + 1}`}
            >
              {item.done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm font-medium", item.done && "text-muted-foreground line-through decoration-muted-foreground/40")}>{item.title}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
              {!item.done && (
                <Button variant={next?.key === item.key ? "default" : "outline"} size="xs" className="mt-2" asChild>
                  <Link href={item.href}>
                    {item.cta} <ArrowRight />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
