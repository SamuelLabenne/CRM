import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { publicContact, upsertContact } from "@/lib/contacts";
import { EventFullError, registerForEvent } from "@/lib/events/registration";
import { kickJobs } from "@/lib/jobs/kick";
import { ApiError, jsonOk, parseBody, withApiKey } from "../../../_lib/http";

const body = z.object({
  email: z.string().trim().toLowerCase().email("email is required and must be a valid email address."),
  firstName: z.string().trim().max(100).nullish(),
  lastName: z.string().trim().max(100).nullish(),
  phone: z.string().trim().max(40).nullish(),
  answers: z.record(z.string().max(100), z.union([z.string().max(5000), z.array(z.string().max(500)).max(50), z.number(), z.boolean(), z.null()])).optional(),
});

/** POST /api/v1/events/{id}/registrations – register a person (contact is created or matched by email). */
export const POST = withApiKey(async (req, ctx: RouteContext<"/api/v1/events/[id]/registrations">) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Event not found.");
  const input = await parseBody(req, body);
  const [event] = await db.select().from(events).where(eq(events.id, id));
  if (!event || event.kind !== "event") throw new ApiError(404, "not_found", "Event not found.");
  if (event.status !== "scheduled") throw new ApiError(422, "event_not_open", `This event is ${event.status}, so it can't take registrations.`);
  if (!event.registrationOpen) throw new ApiError(422, "registration_closed", "Registration is closed for this event.");

  const { contact } = await upsertContact(
    { email: input.email, firstName: input.firstName, lastName: input.lastName, phone: input.phone },
    { source: "api" },
  );
  try {
    const res = await registerForEvent({ eventId: event.id, contactId: contact.id, source: "api", answers: input.answers });
    kickJobs();
    return jsonOk(
      {
        data: {
          registrationId: res.attendee.id,
          eventId: event.id,
          status: res.attendee.status,
          waitlisted: res.waitlisted,
          alreadyRegistered: !res.created,
          contact: publicContact(contact),
        },
      },
      res.created ? 201 : 200,
    );
  } catch (err) {
    if (err instanceof EventFullError) throw new ApiError(409, "event_full", "This event is full.");
    throw err;
  }
});
