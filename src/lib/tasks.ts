// Tasks (follow-ups / to-dos). Creating and completing a task linked to a contact is written to
// the contact's journey timeline (`task_created` / `task_completed`).
import { TZDate } from "@date-fns/tz";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks, type Task } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { formatInTz } from "@/lib/format";
import { notifyUsers } from "@/lib/notify";

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Tasks that only have a due *date* are stored at this local time and displayed without a time. */
export const DATE_ONLY_TIME = "23:59";

/** "yyyy-MM-dd" + optional "HH:mm" in `tz` → absolute Date. A missing time means end of day (date-only). */
export function zonedToUtc(date: string, time: string | null | undefined, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || DATE_ONLY_TIME).split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, tz).getTime());
}

/** Split an absolute Date into local date/time strings; `hasTime` is false for date-only tasks. */
export function utcToZoned(at: Date, tz: string): { date: string; time: string; hasTime: boolean } {
  const time = formatInTz(at, tz, "HH:mm");
  return { date: formatInTz(at, tz, "yyyy-MM-dd"), time, hasTime: time !== DATE_ONLY_TIME };
}

export type TaskBucket = "overdue" | "today" | "upcoming" | "no_date" | "completed";

/** Which list group a task belongs to (`now` and `tz` make this deterministic and testable). */
export function taskBucket(task: Pick<Task, "dueAt" | "completedAt">, now: Date, tz: string): TaskBucket {
  if (task.completedAt) return "completed";
  if (!task.dueAt) return "no_date";
  if (task.dueAt.getTime() < now.getTime()) return "overdue";
  return formatInTz(task.dueAt, tz, "yyyy-MM-dd") === formatInTz(now, tz, "yyyy-MM-dd") ? "today" : "upcoming";
}

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  dueAt?: Date | null;
  priority?: TaskPriority;
  contactId?: string | null;
  eventId?: string | null;
  assigneeId?: string | null;
};

export async function createTask(input: CreateTaskInput, opts: { actorId?: string | null } = {}): Promise<Task> {
  const [task] = await db
    .insert(tasks)
    .values({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      dueAt: input.dueAt ?? null,
      priority: input.priority ?? "normal",
      contactId: input.contactId ?? null,
      eventId: input.eventId ?? null,
      assigneeId: input.assigneeId ?? null,
      createdById: opts.actorId ?? null,
    })
    .returning();
  if (task.contactId) {
    await logActivity({
      contactId: task.contactId,
      type: "task_created",
      title: `Task created: ${task.title}`,
      body: task.description,
      actorId: opts.actorId ?? null,
      meta: { taskId: task.id, dueAt: task.dueAt?.toISOString() ?? null, priority: task.priority, assigneeId: task.assigneeId },
    });
  }
  if (task.assigneeId && task.assigneeId !== opts.actorId) {
    await notifyUsers({ to: [task.assigneeId], type: "task_assigned", title: `Task assigned: ${task.title}`, href: "/tasks" });
  }
  return task;
}

export type UpdateTaskPatch = Partial<Omit<CreateTaskInput, "eventId">>;

export async function updateTask(id: string, patch: UpdateTaskPatch, opts: { actorId?: string | null } = {}): Promise<Task | null> {
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!existing) return null;
  const set: Partial<Task> = {};
  if (patch.title !== undefined) set.title = patch.title.trim();
  if (patch.description !== undefined) set.description = patch.description?.trim() || null;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt;
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.contactId !== undefined) set.contactId = patch.contactId;
  if (patch.assigneeId !== undefined) set.assigneeId = patch.assigneeId;
  if (!Object.keys(set).length) return existing;
  const [task] = await db.update(tasks).set(set).where(eq(tasks.id, id)).returning();
  if (task.assigneeId && task.assigneeId !== existing.assigneeId && task.assigneeId !== opts.actorId) {
    await notifyUsers({ to: [task.assigneeId], type: "task_assigned", title: `Task assigned: ${task.title}`, href: "/tasks" });
  }
  return task;
}

/** Mark a task done (idempotent). Logs `task_completed` on the linked contact the first time. */
export async function completeTask(id: string, opts: { actorId?: string | null } = {}): Promise<Task | null> {
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!existing) return null;
  if (existing.completedAt) return existing;
  const [task] = await db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, id)).returning();
  if (task.contactId) {
    await logActivity({
      contactId: task.contactId,
      type: "task_completed",
      title: `Task completed: ${task.title}`,
      actorId: opts.actorId ?? null,
      meta: { taskId: task.id },
    });
  }
  return task;
}

/** Undo a completion. */
export async function reopenTask(id: string): Promise<Task | null> {
  const [task] = await db.update(tasks).set({ completedAt: null }).where(eq(tasks.id, id)).returning();
  return task ?? null;
}

export async function deleteTask(id: string): Promise<boolean> {
  const rows = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id });
  return rows.length > 0;
}
