import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingPages, contacts, eventAttendees, events, leadCaptures, users } from "@/lib/db/schema";
import { fullName } from "@/lib/format";
import type { Answers, AttendeeStatus, FormQuestion, MeetingOutcome, Utm } from "@/lib/types";

export type MeetingTab = "upcoming" | "past" | "needs_outcome" | "cancelled" | "potential";
export const MEETING_TABS: { value: MeetingTab; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "needs_outcome", label: "Needs outcome" },
  { value: "cancelled", label: "Cancelled" },
  { value: "potential", label: "Potential leads" },
];

export type MeetingFilters = {
  hostId?: string | null;
  pageId?: string | null;
  /** Meeting start between from (inclusive) and to (exclusive). */
  from?: Date | null;
  to?: Date | null;
  q?: string | null;
};

export type MeetingRow = {
  attendeeId: string;
  eventId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string | null;
  status: AttendeeStatus;
  eventStatus: string;
  outcome: MeetingOutcome | null;
  objection: string | null;
  outcomeNotes: string | null;
  dealValue: number | null;
  answers: Answers;
  manageToken: string;
  registeredAt: Date;
  contact: { id: string; name: string; email: string | null; phone: string | null };
  host: { id: string; name: string; color: string } | null;
  page: { id: string; title: string; color: string; questions: FormQuestion[] } | null;
};

function tabCondition(tab: Exclude<MeetingTab, "potential">, now: Date): SQL | undefined {
  const live = and(ne(eventAttendees.status, "cancelled"), ne(events.status, "cancelled"));
  switch (tab) {
    case "upcoming":
      return and(live, gte(events.endsAt, now));
    case "past":
      return and(live, lt(events.endsAt, now));
    case "needs_outcome":
      return and(live, lt(events.endsAt, now), isNull(eventAttendees.outcome));
    case "cancelled":
      return or(eq(eventAttendees.status, "cancelled"), eq(events.status, "cancelled"));
  }
}

function filterConditions(f: MeetingFilters): (SQL | undefined)[] {
  const q = f.q?.trim();
  return [
    f.hostId ? eq(events.hostId, f.hostId) : undefined,
    f.pageId ? eq(events.bookingPageId, f.pageId) : undefined,
    f.from ? gte(events.startsAt, f.from) : undefined,
    f.to ? lt(events.startsAt, f.to) : undefined,
    q
      ? or(
          ilike(contacts.email, `%${q}%`),
          ilike(contacts.firstName, `%${q}%`),
          ilike(contacts.lastName, `%${q}%`),
          ilike(contacts.phone, `%${q}%`),
          ilike(events.title, `%${q}%`),
        )
      : undefined,
  ];
}

const selectRow = {
  attendee: eventAttendees,
  event: events,
  contact: { id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phone: contacts.phone },
  host: { id: users.id, name: users.name, color: users.color },
  page: { id: bookingPages.id, title: bookingPages.title, color: bookingPages.color, questions: bookingPages.questions },
};

/** Meetings (kind = "meeting") for a tab, with contact, host and booking page. */
export async function listMeetings(
  tab: Exclude<MeetingTab, "potential">,
  filters: MeetingFilters = {},
  opts: { limit?: number; offset?: number; now?: Date } = {},
): Promise<{ rows: MeetingRow[]; total: number }> {
  const now = opts.now ?? new Date();
  const where = and(eq(events.kind, "meeting"), tabCondition(tab, now), ...filterConditions(filters));
  const base = db
    .select(selectRow)
    .from(eventAttendees)
    .innerJoin(events, eq(events.id, eventAttendees.eventId))
    .innerJoin(contacts, eq(contacts.id, eventAttendees.contactId))
    .leftJoin(users, eq(users.id, events.hostId))
    .leftJoin(bookingPages, eq(bookingPages.id, events.bookingPageId))
    .where(where);
  const order = tab === "upcoming" || tab === "needs_outcome" ? asc(events.startsAt) : desc(events.startsAt);
  const [rows, [totalRow]] = await Promise.all([
    base.orderBy(order).limit(opts.limit ?? 25).offset(opts.offset ?? 0),
    db
      .select({ n: count() })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .innerJoin(contacts, eq(contacts.id, eventAttendees.contactId))
      .where(where),
  ]);
  return {
    total: Number(totalRow?.n ?? 0),
    rows: rows.map((r) => ({
      attendeeId: r.attendee.id,
      eventId: r.event.id,
      title: r.event.title,
      startsAt: r.event.startsAt,
      endsAt: r.event.endsAt,
      timezone: r.event.timezone,
      status: r.attendee.status,
      eventStatus: r.event.status,
      outcome: r.attendee.outcome,
      objection: r.attendee.objection,
      outcomeNotes: r.attendee.outcomeNotes,
      dealValue: r.attendee.dealValue,
      answers: r.attendee.answers,
      manageToken: r.attendee.manageToken,
      registeredAt: r.attendee.registeredAt,
      contact: { id: r.contact.id, name: fullName(r.contact), email: r.contact.email, phone: r.contact.phone },
      host: r.host?.id ? r.host : null,
      page: r.page?.id ? r.page : null,
    })),
  };
}

/** Badge counts for the tabs (respecting host / page filters, not the date range). */
export async function countMeetingTabs(filters: MeetingFilters = {}, now: Date = new Date()): Promise<Record<MeetingTab, number>> {
  const f = { ...filters, from: null, to: null };
  const tabs = ["upcoming", "past", "needs_outcome", "cancelled"] as const;
  const [counts, [potential]] = await Promise.all([
    Promise.all(
      tabs.map(async (t) => {
        const [row] = await db
          .select({ n: count() })
          .from(eventAttendees)
          .innerJoin(events, eq(events.id, eventAttendees.eventId))
          .innerJoin(contacts, eq(contacts.id, eventAttendees.contactId))
          .where(and(eq(events.kind, "meeting"), tabCondition(t, now), ...filterConditions(f)));
        return Number(row?.n ?? 0);
      }),
    ),
    db
      .select({ n: count() })
      .from(leadCaptures)
      .where(inArray(leadCaptures.status, ["partial", "qualified", "disqualified"])),
  ]);
  return {
    upcoming: counts[0],
    past: counts[1],
    needs_outcome: counts[2],
    cancelled: counts[3],
    potential: Number(potential?.n ?? 0),
  };
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export type KpiInput = { status: AttendeeStatus; outcome: MeetingOutcome | null; dealValue: number | null };

/** Show-up rate, closing rate and won value for a set of meetings that already took place. */
export function computeMeetingKpis(rows: KpiInput[]) {
  const attended = rows.filter((r) => r.status === "attended").length;
  const noShow = rows.filter((r) => r.status === "no_show").length;
  const withOutcome = rows.filter((r) => r.outcome && r.outcome !== "cancelled");
  const won = withOutcome.filter((r) => r.outcome === "won");
  return {
    attended,
    noShow,
    showUpRate: attended + noShow > 0 ? attended / (attended + noShow) : null,
    withOutcome: withOutcome.length,
    won: won.length,
    closingRate: withOutcome.length > 0 ? won.length / withOutcome.length : null,
    wonValue: won.reduce((sum, r) => sum + (r.dealValue ?? 0), 0),
  };
}

export type MeetingKpis = ReturnType<typeof computeMeetingKpis> & { booked: number; bookedCancelled: number; pendingOutcomes: number };

export async function loadMeetingKpis(days: number, filters: Pick<MeetingFilters, "hostId" | "pageId"> = {}, now: Date = new Date()): Promise<MeetingKpis> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const scope = [eq(events.kind, "meeting"), ...filterConditions({ hostId: filters.hostId, pageId: filters.pageId })];
  const [bookedRows, heldRows, [pending]] = await Promise.all([
    db
      .select({ status: eventAttendees.status })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(and(...scope, gte(eventAttendees.registeredAt, since))),
    db
      .select({ status: eventAttendees.status, outcome: eventAttendees.outcome, dealValue: eventAttendees.dealValue })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(and(...scope, gte(events.startsAt, since), lt(events.startsAt, now), ne(eventAttendees.status, "cancelled"), ne(events.status, "cancelled"))),
    db
      .select({ n: count() })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(and(...scope, tabCondition("needs_outcome", now))),
  ]);
  return {
    ...computeMeetingKpis(heldRows),
    booked: bookedRows.length,
    bookedCancelled: bookedRows.filter((r) => r.status === "cancelled").length,
    pendingOutcomes: Number(pending?.n ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Potential leads (iClosed "appointment setting")
// ---------------------------------------------------------------------------

export type PotentialLead = {
  id: string;
  kind: "registration" | "booking";
  status: "partial" | "qualified" | "disqualified";
  createdAt: Date;
  updatedAt: Date;
  answers: Answers;
  utm: Utm;
  questions: FormQuestion[];
  target: { id: string; title: string; href: string } | null;
  contact: { id: string; name: string; email: string | null; phone: string | null };
};

/** Lead captures of bookings & registrations that never completed. */
export async function listPotentialLeads(
  opts: { limit?: number; offset?: number; status?: PotentialLead["status"] | null; pageId?: string | null; q?: string | null } = {},
): Promise<{ rows: PotentialLead[]; total: number }> {
  const q = opts.q?.trim();
  const where = and(
    inArray(leadCaptures.status, opts.status ? [opts.status] : ["partial", "qualified", "disqualified"]),
    opts.pageId ? eq(leadCaptures.targetId, opts.pageId) : undefined,
    q ? or(ilike(contacts.email, `%${q}%`), ilike(contacts.firstName, `%${q}%`), ilike(contacts.lastName, `%${q}%`), ilike(contacts.phone, `%${q}%`)) : undefined,
  );
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        capture: leadCaptures,
        contact: { id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phone: contacts.phone },
        page: { id: bookingPages.id, title: bookingPages.title, questions: bookingPages.questions },
        event: { id: events.id, title: events.title, questions: events.registrationQuestions },
      })
      .from(leadCaptures)
      .innerJoin(contacts, eq(contacts.id, leadCaptures.contactId))
      .leftJoin(bookingPages, and(eq(leadCaptures.kind, "booking"), eq(bookingPages.id, leadCaptures.targetId)))
      .leftJoin(events, and(eq(leadCaptures.kind, "registration"), eq(events.id, leadCaptures.targetId)))
      .where(where)
      .orderBy(desc(leadCaptures.createdAt))
      .limit(opts.limit ?? 25)
      .offset(opts.offset ?? 0),
    db.select({ n: count() }).from(leadCaptures).innerJoin(contacts, eq(contacts.id, leadCaptures.contactId)).where(where),
  ]);
  return {
    total: Number(totalRow?.n ?? 0),
    rows: rows.map((r) => {
      const isBooking = r.capture.kind === "booking";
      const target = isBooking
        ? r.page?.id
          ? { id: r.page.id, title: r.page.title, href: `/scheduling/${r.page.id}` }
          : null
        : r.event?.id
          ? { id: r.event.id, title: r.event.title, href: `/events/${r.event.id}` }
          : null;
      return {
        id: r.capture.id,
        kind: r.capture.kind,
        status: r.capture.status as PotentialLead["status"],
        createdAt: r.capture.createdAt,
        updatedAt: r.capture.updatedAt,
        answers: r.capture.answers,
        utm: r.capture.utm,
        questions: (isBooking ? r.page?.questions : r.event?.questions) ?? [],
        target,
        contact: { id: r.contact.id, name: fullName(r.contact), email: r.contact.email, phone: r.contact.phone },
      };
    }),
  };
}
