import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, createTestUser } from "@/test/setup-db";

const { db } = await setupTestDb();
const { activities, contacts, notifications, tasks } = await import("@/lib/db/schema");
const { upsertContact } = await import("@/lib/contacts");
const { completeTask, createTask, deleteTask, reopenTask, taskBucket, updateTask, utcToZoned, zonedToUtc, DATE_ONLY_TIME } = await import("./tasks");

const TZ = "Australia/Perth"; // UTC+8, no DST

describe("task time helpers", () => {
  it("converts local date/time in the workspace timezone to UTC and back", () => {
    const d = zonedToUtc("2026-03-05", "09:30", TZ);
    expect(d.toISOString()).toBe("2026-03-05T01:30:00.000Z");
    expect(utcToZoned(d, TZ)).toEqual({ date: "2026-03-05", time: "09:30", hasTime: true });
  });

  it("treats a missing time as an end-of-day, date-only task", () => {
    const d = zonedToUtc("2026-03-05", null, TZ);
    expect(utcToZoned(d, TZ)).toEqual({ date: "2026-03-05", time: DATE_ONLY_TIME, hasTime: false });
  });

  it("buckets tasks relative to now in the workspace timezone", () => {
    const now = new Date("2026-03-05T06:00:00Z"); // 14:00 on 5 Mar in Perth
    const at = (date: string, time: string | null) => zonedToUtc(date, time, TZ);
    expect(taskBucket({ dueAt: null, completedAt: null }, now, TZ)).toBe("no_date");
    expect(taskBucket({ dueAt: at("2026-03-05", "09:00"), completedAt: null }, now, TZ)).toBe("overdue");
    expect(taskBucket({ dueAt: at("2026-03-05", "17:00"), completedAt: null }, now, TZ)).toBe("today");
    expect(taskBucket({ dueAt: at("2026-03-05", null), completedAt: null }, now, TZ)).toBe("today");
    expect(taskBucket({ dueAt: at("2026-03-04", null), completedAt: null }, now, TZ)).toBe("overdue");
    expect(taskBucket({ dueAt: at("2026-03-06", "08:00"), completedAt: null }, now, TZ)).toBe("upcoming");
    expect(taskBucket({ dueAt: at("2026-03-01", null), completedAt: new Date() }, now, TZ)).toBe("completed");
  });
});

describe("task lifecycle", () => {
  it("logs task_created / task_completed on the contact timeline and notifies other assignees", async () => {
    const actor = await createTestUser({ name: "Actor" });
    const other = await createTestUser({ name: "Other" });
    const { contact } = await upsertContact({ email: "task@t.io", firstName: "Tess" }, { source: "manual" });

    const task = await createTask(
      { title: "Call Tess", dueAt: new Date(Date.now() + 864e5), priority: "high", contactId: contact.id, assigneeId: other.id },
      { actorId: actor.id },
    );
    expect(task).toMatchObject({ title: "Call Tess", priority: "high", createdById: actor.id, assigneeId: other.id });
    let acts = await db.select().from(activities).where(eq(activities.contactId, contact.id));
    expect(acts.find((a) => a.type === "task_created")).toMatchObject({ title: "Task created: Call Tess", actorId: actor.id, meta: expect.objectContaining({ taskId: task.id }) });
    expect(await db.select().from(notifications).where(eq(notifications.userId, other.id))).toHaveLength(1);

    const done = await completeTask(task.id, { actorId: actor.id });
    expect(done?.completedAt).toBeTruthy();
    await completeTask(task.id, { actorId: actor.id }); // idempotent – no second activity
    acts = await db.select().from(activities).where(eq(activities.contactId, contact.id));
    expect(acts.filter((a) => a.type === "task_completed")).toHaveLength(1);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(c.lastActivityAt).toBeTruthy();

    expect((await reopenTask(task.id))?.completedAt).toBeNull();
  });

  it("updates, deletes and works without a contact", async () => {
    const t = await createTask({ title: "  Standalone  ", description: " notes " });
    expect(t).toMatchObject({ title: "Standalone", description: "notes", contactId: null, priority: "normal" });
    const u = await updateTask(t.id, { title: "Renamed", dueAt: new Date("2030-01-01T00:00:00Z"), priority: "low", description: "" });
    expect(u).toMatchObject({ title: "Renamed", priority: "low", description: null });
    expect(await updateTask("00000000-0000-0000-0000-000000000000", { title: "x" })).toBeNull();
    expect(await completeTask(t.id)).toBeTruthy(); // no contact → no activity, no error
    expect(await deleteTask(t.id)).toBe(true);
    expect(await db.select().from(tasks).where(eq(tasks.id, t.id))).toHaveLength(0);
    expect(await deleteTask(t.id)).toBe(false);
  });
});
