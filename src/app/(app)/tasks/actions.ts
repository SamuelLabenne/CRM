"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { contacts, tasks, users } from "@/lib/db/schema";
import { isAdmin, requireUser } from "@/lib/auth";
import { fail, ok, zodFail } from "@/lib/action";
import { getWorkspace } from "@/lib/settings";
import { completeTask, createTask, deleteTask, reopenTask, updateTask, zonedToUtc } from "@/lib/tasks";

const uuid = z.uuid();
const taskSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(200),
  description: z.string().trim().max(5000).nullish(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
    .nullish()
    .or(z.literal("")),
  dueTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use a valid time")
    .nullish()
    .or(z.literal("")),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  contactId: uuid.nullish(),
  assigneeId: uuid.nullish(),
});
export type TaskInput = z.input<typeof taskSchema>;

function revalidateTasks(contactId?: string | null) {
  revalidatePath("/tasks");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  if (contactId) revalidatePath(`/contacts/${contactId}`);
}

async function parseTask(input: unknown) {
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { error: zodFail(parsed.error) } as const;
  const d = parsed.data;
  if (d.contactId) {
    const [c] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, d.contactId));
    if (!c) return { error: fail("Contact not found", { contactId: ["Contact not found"] }) } as const;
  }
  if (d.assigneeId) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, d.assigneeId));
    if (!u) return { error: fail("Assignee not found") } as const;
  }
  if (d.dueTime && !d.dueDate) return { error: fail("Pick a due date for the time", { dueDate: ["Pick a date"] }) } as const;
  const tz = (await getWorkspace()).timezone;
  const dueAt = d.dueDate ? zonedToUtc(d.dueDate, d.dueTime || null, tz) : null;
  return { data: { ...d, dueAt } } as const;
}

export async function createTaskAction(input: TaskInput) {
  const user = await requireUser();
  const p = await parseTask(input);
  if ("error" in p) return p.error;
  const d = p.data;
  const task = await createTask(
    {
      title: d.title,
      description: d.description,
      dueAt: d.dueAt,
      priority: d.priority,
      contactId: d.contactId ?? null,
      assigneeId: d.assigneeId ?? null,
    },
    { actorId: user.id },
  );
  revalidateTasks(task.contactId);
  return ok({ id: task.id }, "Task created");
}

export async function updateTaskAction(taskId: string, input: TaskInput) {
  const user = await requireUser();
  if (!uuid.safeParse(taskId).success) return fail("Task not found");
  const p = await parseTask(input);
  if ("error" in p) return p.error;
  const d = p.data;
  const [before] = await db.select({ contactId: tasks.contactId }).from(tasks).where(eq(tasks.id, taskId));
  const task = await updateTask(
    taskId,
    {
      title: d.title,
      description: d.description ?? null,
      dueAt: d.dueAt,
      priority: d.priority,
      contactId: d.contactId ?? null,
      assigneeId: d.assigneeId ?? null,
    },
    { actorId: user.id },
  );
  if (!task) return fail("Task not found");
  revalidateTasks(before?.contactId);
  revalidateTasks(task.contactId);
  return ok(undefined, "Task saved");
}

export async function setTaskCompletedAction(taskId: string, completed: boolean) {
  const user = await requireUser();
  if (!uuid.safeParse(taskId).success) return fail("Task not found");
  const task = completed ? await completeTask(taskId, { actorId: user.id }) : await reopenTask(taskId);
  if (!task) return fail("Task not found");
  revalidateTasks(task.contactId);
  return ok(undefined, completed ? "Task completed" : "Task reopened");
}

export async function deleteTaskAction(taskId: string) {
  const user = await requireUser();
  if (!uuid.safeParse(taskId).success) return fail("Task not found");
  const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!t) return fail("Task not found");
  if (t.createdById !== user.id && t.assigneeId !== user.id && !isAdmin(user)) return fail("You can only delete your own tasks");
  await deleteTask(taskId);
  revalidateTasks(t.contactId);
  return ok(undefined, "Task deleted");
}
