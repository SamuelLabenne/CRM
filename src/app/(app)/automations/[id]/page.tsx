import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Activity, ListChecks } from "lucide-react";
import { z } from "zod";
import { db } from "@/lib/db";
import { automations } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { AUTOMATION_STATUS, MappedStatus } from "@/components/app/status-badge";
import { EmptyState } from "@/components/app/empty-state";
import { AutomationBuilder } from "@/components/automations/builder";
import { DeleteAutomationButton } from "@/components/automations/delete-button";
import { EnrollDialog } from "@/components/automations/enroll-dialog";
import { RouteTabs } from "@/components/automations/status";
import { LogsTab } from "@/components/automations/logs-tab";
import { RunsTab } from "@/components/automations/runs-tab";
import { loadBuilderLookups } from "@/lib/automations/lookups";
import { TRIGGER_META, describeTrigger, toNameLookups } from "@/lib/automations/meta";
import { getAutomationStats } from "@/lib/automations/service";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/automations/[id]">) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return { title: "Automation" };
  const [a] = await db.select({ name: automations.name }).from(automations).where(eq(automations.id, id));
  return { title: a?.name ?? "Automation" };
}

const TABS = ["builder", "runs", "logs"] as const;

export default async function AutomationPage({ params, searchParams }: PageProps<"/automations/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? "builder";

  const [automation] = await db.select().from(automations).where(eq(automations.id, id));
  if (!automation) notFound();

  const [stats, lookups] = await Promise.all([getAutomationStats([id]).then((m) => m.get(id)!), loadBuilderLookups(automation)]);
  const names = toNameLookups(lookups);
  const eventlessTrigger = TRIGGER_META[automation.trigger.type].event !== "yes";
  const stepsNeedEvent = automation.steps.some((s) => s.type === "wait_until_event" || (s.type === "condition" && s.attendance?.length));

  const base = `/automations/${id}`;
  const statItems = [
    { label: "Enrolled", value: stats.total },
    { label: "Active", value: stats.active, accent: stats.active > 0 ? "text-blue-600 dark:text-blue-300" : undefined },
    { label: "Completed", value: stats.completed, accent: stats.completed > 0 ? "text-emerald-600 dark:text-emerald-300" : undefined },
    { label: "Exited", value: stats.exited },
    { label: "Failed", value: stats.failed, accent: stats.failed > 0 ? "text-destructive" : undefined },
  ];

  return (
    <>
      <PageHeader
        title={automation.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <MappedStatus map={AUTOMATION_STATUS} value={automation.status} />
            <span>{describeTrigger(automation.trigger, names)}</span>
          </span>
        }
        back={{ href: "/automations", label: "Automations" }}
        actions={
          <>
            <EnrollDialog
              automationId={id}
              status={automation.status}
              views={lookups.views}
              events={lookups.events.filter((e) => e.kind === "event")}
              timezone={lookups.timezone}
              needsEvent={eventlessTrigger && stepsNeedEvent}
            />
            <DeleteAutomationButton id={id} name={automation.name} runs={stats.total} />
          </>
        }
      >
        <dl className="flex flex-wrap gap-x-8 gap-y-2" aria-label="Automation statistics">
          {statItems.map((s) => (
            <div key={s.label} className="flex items-baseline gap-1.5">
              <dd className={cn("text-lg font-semibold tabular-nums", s.accent)}>{s.value}</dd>
              <dt className="text-sm text-muted-foreground">{s.label}</dt>
            </div>
          ))}
        </dl>
        <RouteTabs
          className="-mb-4 -ml-3"
          active={tab}
          tabs={[
            { key: "builder", label: "Builder", href: base },
            { key: "runs", label: "Runs", href: `${base}?tab=runs`, count: stats.total },
            { key: "logs", label: "Logs", href: `${base}?tab=logs` },
          ]}
        />
      </PageHeader>
      <PageBody>
        {tab === "builder" && (
          <AutomationBuilder
            key={automation.updatedAt.toISOString()}
            automation={{
              id: automation.id,
              name: automation.name,
              description: automation.description,
              status: automation.status,
              trigger: automation.trigger,
              steps: automation.steps,
              allowReentry: automation.allowReentry,
            }}
            lookups={lookups}
            inFlightRuns={stats.active}
          />
        )}
        {tab === "runs" &&
          (stats.total === 0 ? (
            <EmptyState
              icon={Activity}
              title="No runs yet"
              description={
                automation.status === "active"
                  ? "Contacts who match the trigger will show up here as soon as they're enrolled."
                  : "Activate the automation to start enrolling contacts – or enroll some manually."
              }
            />
          ) : (
            <RunsTab automation={automation} searchParams={sp} timezone={lookups.timezone} names={names} />
          ))}
        {tab === "logs" &&
          (stats.total === 0 ? (
            <EmptyState icon={ListChecks} title="Nothing logged yet" description="Every enrolment, step and error is recorded here once contacts start going through the automation." />
          ) : (
            <LogsTab automation={automation} searchParams={sp} timezone={lookups.timezone} />
          ))}
        {tab !== "builder" && (
          <p className="text-xs text-muted-foreground">
            <Link href={base} className="text-primary hover:underline">
              Back to the builder
            </Link>
          </p>
        )}
      </PageBody>
    </>
  );
}
