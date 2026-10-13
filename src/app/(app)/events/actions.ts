"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action";
import { fullName } from "@/lib/format";
import { kickJobs } from "@/lib/jobs/kick";
import {
  addAttendee,
  bulkMarkAttendance,
  cancelAttendeeAsStaff,
  deleteEvent,
  duplicateEvent,
  markRemainingNoShow,
  removeAttendee,
  saveEvent,
  setEventStatus,
  walkIn,
  type EventSection,
} from "@/lib/events/manage";
import { markAttendance } from "@/lib/events/registration";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const id = z.uuid({ message: "Invalid id" });
const refresh = (eventId?: string) => {
  revalidatePath("/events");
  if (eventId) revalidatePath(`/events/${eventId}`, "layout");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
};

export async function saveEventAction(input: { id?: string | null; section: EventSection; values: unknown }): Promise<ActionResult<{ id: string; slug: string | null }>> {
  const user = await requireUser();
  const section = z.enum(["all", "details", "registration", "notifications"]).safeParse(input.section);
  if (!section.success) return fail("Unknown section");
  if (input.id && !id.safeParse(input.id).success) return fail("Invalid event");
  const res = await saveEvent({ id: input.id ?? null, section: section.data, values: input.values, actorId: user.id });
  if (!res.ok) return fail(res.error, res.fieldErrors);
  refresh(res.event.id);
  return ok({ id: res.event.id, slug: res.event.slug }, input.id ? "Changes saved" : "Event created");
}

export async function duplicateEventAction(eventId: string): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  if (!id.safeParse(eventId).success) return fail("Invalid event");
  const copy = await duplicateEvent(eventId, user.id);
  if (!copy) return fail("Event not found");
  refresh();
  return ok({ id: copy.id }, "Event duplicated as a draft");
}

export async function setEventStatusAction(eventId: string, status: string, notify = true): Promise<ActionResult> {
  await requireUser();
  const s = z.enum(["draft", "scheduled", "completed", "cancelled"]).safeParse(status);
  if (!id.safeParse(eventId).success || !s.success) return fail("Invalid request");
  const event = await setEventStatus(eventId, s.data, { notify });
  if (!event) return fail("Event not found");
  if (s.data === "cancelled") kickJobs();
  refresh(eventId);
  return ok(undefined, { draft: "Moved back to draft", scheduled: "Event is live", completed: "Marked as completed", cancelled: "Event cancelled" }[s.data]);
}

export async function deleteEventAction(eventId: string): Promise<ActionResult> {
  await requireUser();
  if (!id.safeParse(eventId).success) return fail("Invalid event");
  if (!(await deleteEvent(eventId))) return fail("Event not found");
  refresh();
  return ok(undefined, "Event deleted");
}

export async function markAttendanceAction(attendeeId: string, status: string): Promise<ActionResult<{ status: string }>> {
  const user = await requireUser();
  const s = z.enum(["attended", "no_show", "registered"]).safeParse(status);
  if (!id.safeParse(attendeeId).success || !s.success) return fail("Invalid request");
  const att = await markAttendance(attendeeId, s.data, { actorId: user.id });
  if (!att) return fail("Attendee not found");
  revalidatePath("/events", "layout");
  return ok({ status: att.status });
}

export async function bulkMarkAttendanceAction(ids: string[], status: string): Promise<ActionResult<{ changed: number }>> {
  const user = await requireUser();
  const s = z.enum(["attended", "no_show", "registered"]).safeParse(status);
  const list = z.array(id).max(500).safeParse(ids);
  if (!s.success || !list.success || !list.data.length) return fail("Select at least one attendee");
  const changed = await bulkMarkAttendance(list.data, s.data, user.id);
  revalidatePath("/events", "layout");
  return ok({ changed }, `${changed} ${changed === 1 ? "attendee" : "attendees"} updated`);
}

export async function markRemainingNoShowAction(eventId: string): Promise<ActionResult<{ changed: number }>> {
  const user = await requireUser();
  if (!id.safeParse(eventId).success) return fail("Invalid event");
  const changed = await markRemainingNoShow(eventId, user.id);
  revalidatePath("/events", "layout");
  return ok({ changed }, changed ? `${changed} marked as no-show` : "Everyone is already marked");
}

export async function cancelAttendeeAction(attendeeId: string, notify = false): Promise<ActionResult> {
  const user = await requireUser();
  if (!id.safeParse(attendeeId).success) return fail("Invalid attendee");
  const res = await cancelAttendeeAsStaff(attendeeId, user.id, { notify });
  if (!res) return fail("Already cancelled");
  kickJobs();
  revalidatePath("/events", "layout");
  return ok(undefined, "Registration cancelled");
}

export async function removeAttendeeAction(attendeeId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!id.safeParse(attendeeId).success) return fail("Invalid attendee");
  if (!(await removeAttendee(attendeeId, user.id))) return fail("Attendee not found");
  revalidatePath("/events", "layout");
  return ok(undefined, "Attendee removed");
}

export async function addAttendeeAction(input: {
  eventId: string;
  contactId?: string | null;
  newContact?: { name: string; email?: string; phone?: string } | null;
  markAttended?: boolean;
  silent?: boolean;
}): Promise<ActionResult<{ attendeeId: string; created: boolean }>> {
  const user = await requireUser();
  if (!id.safeParse(input.eventId).success) return fail("Invalid event");
  if (input.contactId && !id.safeParse(input.contactId).success) return fail("Invalid contact");
  if (!input.contactId && !input.newContact) return fail("Pick a contact or enter a name");
  const res = await addAttendee({
    eventId: input.eventId,
    contactId: input.contactId,
    newContact: input.newContact,
    markAttended: !!input.markAttended,
    silent: !!input.silent,
    actorId: user.id,
  });
  if (!res.ok) return fail(res.error);
  kickJobs();
  revalidatePath("/events", "layout");
  return ok({ attendeeId: res.attendee.id, created: res.created }, res.created ? "Attendee added" : "Already registered");
}

export type WalkInRow = { id: string; name: string; email: string | null; company: string | null; status: string };

export async function walkInAction(input: { eventId: string; name: string; email?: string }): Promise<ActionResult<WalkInRow>> {
  const user = await requireUser();
  if (!id.safeParse(input.eventId).success) return fail("Invalid event");
  const res = await walkIn({ eventId: input.eventId, name: input.name, email: input.email, actorId: user.id });
  if (!res.ok) return fail(res.error);
  const [c] = await db.select().from(contacts).where(eq(contacts.id, res.attendee.contactId));
  revalidatePath("/events", "layout");
  return ok({ id: res.attendee.id, name: fullName(c), email: c?.email ?? null, company: c?.company ?? null, status: res.attendee.status }, `${fullName(c)} checked in`);
}
