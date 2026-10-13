"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { eventAttendees, events, tasks } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { fail, ok, zodFail, type ActionResult } from "@/lib/action";
import { logActivity } from "@/lib/activity";
import { cancelRegistration, markAttendance, setMeetingOutcome } from "@/lib/events/registration";
import { MEETING_OBJECTIONS } from "@/lib/types";

async function loadMeeting(attendeeId: string) {
  const [row] = await db
    .select({ attendee: eventAttendees, event: events })
    .from(eventAttendees)
    .innerJoin(events, eq(events.id, eventAttendees.eventId))
    .where(eq(eventAttendees.id, attendeeId));
  return row && row.event.kind === "meeting" ? row : null;
}

function refresh() {
  revalidatePath("/meetings");
  revalidatePath("/dashboard");
}

const outcomeSchema = z.object({
  attendeeId: z.string().uuid(),
  outcome: z.enum(["won", "lost", "follow_up", "not_qualified", "no_show"]),
  objection: z.enum(MEETING_OBJECTIONS).nullable().optional(),
  notes: z.string().trim().max(4000).optional(),
  dealValue: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  followUp: z
    .object({
      title: z.string().trim().min(1, "Give the follow-up task a title").max(200),
      /** yyyy-MM-dd */
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a due date").nullable().optional(),
    })
    .nullable()
    .optional(),
});

export async function logOutcomeAction(input: z.input<typeof outcomeSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = outcomeSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const v = parsed.data;
  const row = await loadMeeting(v.attendeeId);
  if (!row) return fail("Meeting not found.");
  await setMeetingOutcome(
    v.attendeeId,
    {
      outcome: v.outcome,
      objection: v.outcome === "won" ? null : (v.objection ?? null),
      notes: v.notes || null,
      dealValue: v.dealValue ?? null,
    },
    { actorId: user.id },
  );
  if (v.outcome === "follow_up" && v.followUp) {
    const dueAt = v.followUp.dueDate ? new Date(`${v.followUp.dueDate}T09:00:00`) : null;
    await db.insert(tasks).values({
      title: v.followUp.title,
      description: v.notes || null,
      dueAt,
      contactId: row.attendee.contactId,
      eventId: row.event.id,
      assigneeId: row.event.hostId ?? user.id,
      createdById: user.id,
      priority: "normal",
    });
    await logActivity({
      contactId: row.attendee.contactId,
      type: "task_created",
      title: `Follow-up task: ${v.followUp.title}`,
      actorId: user.id,
      eventId: row.event.id,
    });
    revalidatePath("/tasks");
  }
  refresh();
  revalidatePath(`/contacts/${row.attendee.contactId}`);
  return ok(undefined, "Outcome saved");
}

const idSchema = z.string().uuid();

export async function markNoShowAction(attendeeId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!idSchema.safeParse(attendeeId).success) return fail("Invalid meeting.");
  if (!(await loadMeeting(attendeeId))) return fail("Meeting not found.");
  await setMeetingOutcome(attendeeId, { outcome: "no_show" }, { actorId: user.id });
  refresh();
  return ok(undefined, "Marked as no-show");
}

export async function markAttendedAction(attendeeId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!idSchema.safeParse(attendeeId).success) return fail("Invalid meeting.");
  if (!(await loadMeeting(attendeeId))) return fail("Meeting not found.");
  await markAttendance(attendeeId, "attended", { actorId: user.id });
  refresh();
  return ok(undefined, "Marked as attended");
}

export async function cancelMeetingAction(input: { attendeeId: string; reason?: string; notify?: boolean }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z.object({ attendeeId: idSchema, reason: z.string().trim().max(1000).optional(), notify: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!(await loadMeeting(parsed.data.attendeeId))) return fail("Meeting not found.");
  const res = await cancelRegistration(parsed.data.attendeeId, {
    by: "staff",
    actorId: user.id,
    reason: parsed.data.reason || null,
    notify: parsed.data.notify ?? true,
  });
  if (!res) return fail("This meeting is already cancelled.");
  refresh();
  return ok(undefined, "Meeting cancelled");
}

export async function createLeadTaskAction(input: { contactId: string; title: string; dueDate?: string | null }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({
      contactId: idSchema,
      title: z.string().trim().min(1, "Give the task a title").max(200),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  await db.insert(tasks).values({
    title: parsed.data.title,
    contactId: parsed.data.contactId,
    dueAt: parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T09:00:00`) : null,
    assigneeId: user.id,
    createdById: user.id,
  });
  await logActivity({ contactId: parsed.data.contactId, type: "task_created", title: `Task: ${parsed.data.title}`, actorId: user.id });
  revalidatePath("/tasks");
  revalidatePath("/meetings");
  return ok(undefined, "Task created");
}
