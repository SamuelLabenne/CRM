import Link from "next/link";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { CheckSquare } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TaskRow } from "@/components/tasks/task-row";
import type { TaskBucketKey, TaskDTO } from "@/components/tasks/types";
import { tasks } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getWorkspace } from "@/lib/settings";
import { loadReferenceData } from "@/lib/contacts/form-data";
import { cn } from "@/lib/utils";
import { queryTasks, toTaskDTO } from "./data";

export const metadata = { title: "Tasks" };

const SECTIONS: { key: TaskBucketKey; title: string; tone?: string }[] = [
  { key: "overdue", title: "Overdue", tone: "text-destructive" },
  { key: "today", title: "Today" },
  { key: "upcoming", title: "Upcoming" },
  { key: "no_date", title: "No date" },
  { key: "completed", title: "Completed" },
];

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const user = await requireUser();
  const sp = await searchParams;
  const scope = sp.scope === "all" ? "all" : "mine";
  const [workspace, ref] = await Promise.all([getWorkspace(), loadReferenceData()]);
  const tz = workspace.timezone;
  const mine = scope === "mine" ? eq(tasks.assigneeId, user.id) : undefined;

  const [open, done] = await Promise.all([
    queryTasks(and(isNull(tasks.completedAt), mine)),
    queryTasks(and(isNotNull(tasks.completedAt), mine), { limit: 25, completed: true }),
  ]);
  const now = new Date();
  const all: TaskDTO[] = [...open, ...done].map((r) => toTaskDTO(r, tz, now));
  const byBucket = (k: TaskBucketKey) => all.filter((t) => t.bucket === k);
  const users = ref.users.map((u) => ({ id: u.id, name: u.name }));
  const overdueCount = byBucket("overdue").length;
  const todayCount = byBucket("today").length;

  return (
    <>
      <PageHeader
        title="Tasks"
        description={
          open.length === 0
            ? "Nothing on your plate."
            : `${open.length} open${overdueCount ? ` · ${overdueCount} overdue` : ""}${todayCount ? ` · ${todayCount} due today` : ""}`
        }
        actions={
          <>
            <div className="inline-flex rounded-lg bg-muted p-0.5 text-sm" role="tablist" aria-label="Task scope">
              {(
                [
                  ["mine", "Mine"],
                  ["all", "Everyone"],
                ] as const
              ).map(([key, label]) => (
                <Link
                  key={key}
                  role="tab"
                  aria-selected={scope === key}
                  href={key === "mine" ? "/tasks" : "/tasks?scope=all"}
                  className={cn("rounded-md px-3 py-1 font-medium transition-colors", scope === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {label}
                </Link>
              ))}
            </div>
            <NewTaskButton users={users} currentUserId={user.id} timezone={tz} />
          </>
        }
      />
      <PageBody>
        {all.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title={scope === "mine" ? "You're all caught up" : "No tasks yet"}
            description="Create follow-ups for yourself or your team, optionally linked to a contact. Completed tasks are logged on the contact's journey."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <NewTaskButton users={users} currentUserId={user.id} timezone={tz} size="default" />
                {scope === "mine" && (
                  <Button variant="outline" asChild>
                    <Link href="/tasks?scope=all">See everyone&apos;s tasks</Link>
                  </Button>
                )}
              </div>
            }
          />
        ) : (
          <div className="grid gap-6">
            {SECTIONS.map(({ key, title, tone }) => {
              const list = byBucket(key);
              if (!list.length) return null;
              return (
                <section key={key} aria-labelledby={`tasks-${key}`}>
                  <h2 id={`tasks-${key}`} className={cn("mb-2 flex items-center gap-2 text-sm font-semibold", tone)}>
                    {title}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{list.length}</span>
                  </h2>
                  <div className="overflow-hidden rounded-xl border bg-card">
                    {list.map((t) => (
                      <TaskRow key={t.id} task={t} users={users} currentUserId={user.id} timezone={tz} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </PageBody>
    </>
  );
}
