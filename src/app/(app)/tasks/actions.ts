"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { contacts, tasks, users } from "@/lib/db/schema";
import { isAdmin, requireUser } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
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

type Parsed =
  | { ok: false; result: ActionResult<never> }
  | { ok: true; data: z.output<typeof taskSchema> & { dueAt: Date | null } };

async function parseTask(input: unknown): Promise<Parsed> {
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, result: zodFail(parsed.error) };
  const d = parsed.data;
  if (d.contactId) {
    const [c] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, d.contactId));
    if (!c) return { ok: false, result: fail("Contact not found", { contactId: ["Contact not found"] }) };
  }
  if (d.assigneeId) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, d.assigneeId));
    if (!u) return { ok: false, result: fail("Assignee not found") };
  }
  if (d.dueTime && !d.dueDate) return { ok: false, result: fail("Pick a due date for the time", { dueDate: ["Pick a date"] }) };
  const tz = (await getWorkspace()).timezone;
  const dueAt = d.dueDate ? zonedToUtc(d.dueDate, d.dueTime || null, tz) : null;
  return { ok: true, data: { ...d, dueAt } };
}

export async function createTaskAction(input: TaskInput): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const p = await parseTask(input);
  if (!p.ok) return p.result;
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

export async function updateTaskAction(taskId: string, input: TaskInput): Promise<ActionResult> {
  const user = await requireUser();
  if (!uuid.safeParse(taskId).success) return fail("Task not found");
  const p = await parseTask(input);
  if (!p.ok) return p.result;
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

export async function setTaskCompletedAction(taskId: string, completed: boolean): Promise<ActionResult> {
  const user = await requireUser();
  if (!uuid.safeParse(taskId).success) return fail("Task not found");
  const task = completed ? await completeTask(taskId, { actorId: user.id }) : await reopenTask(taskId);
  if (!task) return fail("Task not found");
  revalidateTasks(task.contactId);
  return ok(undefined, completed ? "Task completed" : "Task reopened");
}

export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!uuid.safeParse(taskId).success) return fail("Task not found");
  const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!t) return fail("Task not found");
  if (t.createdById !== user.id && t.assigneeId !== user.id && !isAdmin(user)) return fail("You can only delete your own tasks");
  await deleteTask(taskId);
  revalidateTasks(t.contactId);
  return ok(undefined, "Task deleted");
}
