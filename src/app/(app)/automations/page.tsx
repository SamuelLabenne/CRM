import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Plus, Workflow } from "lucide-react";
import { db } from "@/lib/db";
import { automations } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { AUTOMATION_STATUS, MappedStatus } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AutomationCardMenu, StatusToggle } from "@/components/automations/automation-card-controls";
import { TRIGGER_ICONS } from "@/components/automations/icons";
import { FilterPills } from "@/components/automations/status";
import { loadTriggerNames } from "@/lib/automations/lookups";
import { describeTrigger } from "@/lib/automations/meta";
import { getAutomationStats } from "@/lib/automations/service";
import { pluralize } from "@/lib/format";

export const metadata = { title: "Automations" };

const FILTERS = ["all", "active", "paused", "draft"] as const;

export default async function AutomationsPage({ searchParams }: PageProps<"/automations">) {
  await requireUser();
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f === sp.status) ?? "all";

  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(automations)
      .where(filter === "all" ? undefined : eq(automations.status, filter))
      .orderBy(desc(automations.updatedAt)),
    db.select({ status: automations.status, n: sql<number>`count(*)::int` }).from(automations).groupBy(automations.status),
  ]);
  const [stats, names] = await Promise.all([getAutomationStats(rows.map((r) => r.id)), loadTriggerNames(rows.map((r) => r.trigger))]);
  const totalAll = counts.reduce((sum, c) => sum + c.n, 0);
  const countOf = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;

  return (
    <>
      <PageHeader
        title="Automations"
        description="Triggered email sequences and actions that run on their own."
        actions={
          <Button asChild>
            <Link href="/automations/new">
              <Plus /> New automation
            </Link>
          </Button>
        }
      />
      <PageBody>
        {totalAll === 0 ? (
          <EmptyState
            icon={Workflow}
            title="No automations yet"
            description="Send reminders, welcome new contacts, follow up after events and alert your team – automatically. Start from a ready-made recipe or build your own."
            action={
              <Button asChild>
                <Link href="/automations/new">
                  <Plus /> Create your first automation
                </Link>
              </Button>
            }
          />
        ) : (
          <>
            <FilterPills
              active={filter}
              items={[
                { key: "all", label: `All (${totalAll})`, href: "/automations" },
                { key: "active", label: `Active (${countOf("active")})`, href: "/automations?status=active" },
                { key: "paused", label: `Paused (${countOf("paused")})`, href: "/automations?status=paused" },
                { key: "draft", label: `Drafts (${countOf("draft")})`, href: "/automations?status=draft" },
              ]}
            />
            {rows.length === 0 ? (
              <EmptyState icon={Workflow} title={`No ${filter} automations`} description="Try another filter." />
            ) : (
              <div className="grid gap-3">
                {rows.map((a) => {
                  const s = stats.get(a.id);
                  const Icon = TRIGGER_ICONS[a.trigger.type] ?? Workflow;
                  return (
                    <Card key={a.id} className="gap-0 p-0 transition-shadow hover:shadow-sm">
                      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
                        <Link href={`/automations/${a.id}`} className="flex min-w-0 flex-1 items-start gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Icon className="size-5" />
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-medium">{a.name}</span>
                              <MappedStatus map={AUTOMATION_STATUS} value={a.status} />
                            </span>
                            <span className="mt-0.5 block text-sm text-muted-foreground">{describeTrigger(a.trigger, names)}</span>
                          </span>
                        </Link>
                        <dl className="grid grid-cols-4 gap-4 text-sm md:w-80 md:shrink-0">
                          <Metric label="Steps" value={a.steps.length} />
                          <Metric label="Enrolled" value={s?.total ?? 0} />
                          <Metric label="Active" value={s?.active ?? 0} />
                          <Metric label="Failed" value={s?.failed ?? 0} danger={(s?.failed ?? 0) > 0} />
                        </dl>
                        <div className="flex items-center justify-between gap-3 border-t pt-3 md:justify-end md:border-t-0 md:pt-0">
                          <span className="text-xs text-muted-foreground md:hidden">{pluralize(a.steps.length, "step")}</span>
                          <div className="flex items-center gap-2">
                            <StatusToggle id={a.id} name={a.name} status={a.status} />
                            <AutomationCardMenu id={a.id} name={a.name} runs={s?.total ?? 0} />
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}

function Metric({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={danger ? "font-semibold text-destructive tabular-nums" : "font-semibold tabular-nums"}>{value}</dd>
    </div>
  );
}
