import { desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, tasks, users, type Task } from "@/lib/db/schema";
import { formatInTz, fullName } from "@/lib/format";
import { taskBucket, utcToZoned } from "@/lib/tasks";
import type { TaskDTO } from "@/components/tasks/types";

type Row = { task: Task; contact: typeof contacts.$inferSelect | null; assignee: { id: string; name: string; color: string } | null };

export function toTaskDTO(row: Row, tz: string, now = new Date()): TaskDTO {
  const { task } = row;
  const z = task.dueAt ? utcToZoned(task.dueAt, tz) : null;
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    dueDate: z?.date ?? "",
    dueTime: z?.hasTime ? z.time : "",
    dueLabel: task.dueAt ? formatInTz(task.dueAt, tz, z?.hasTime ? "EEE d MMM, HH:mm" : "EEE d MMM") : "",
    bucket: taskBucket(task, now, tz),
    completed: Boolean(task.completedAt),
    contact: row.contact ? { id: row.contact.id, name: fullName(row.contact) } : null,
    assignee: row.assignee,
  };
}

/** Tasks with their contact + assignee. `where` is applied as-is. */
export async function queryTasks(where: SQL | undefined, opts: { limit?: number; completed?: boolean } = {}) {
  const rows = await db
    .select({ task: tasks, contact: contacts, assigneeId: users.id, assigneeName: users.name, assigneeColor: users.color })
    .from(tasks)
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(where)
    .orderBy(...(opts.completed ? [desc(tasks.completedAt)] : [sql`${tasks.dueAt} asc nulls last`, desc(tasks.createdAt)]))
    .limit(opts.limit ?? 500);
  return rows.map<Row>((r) => ({
    task: r.task,
    contact: r.contact,
    assignee: r.assigneeId ? { id: r.assigneeId, name: r.assigneeName!, color: r.assigneeColor! } : null,
  }));
}
