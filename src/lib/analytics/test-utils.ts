// Shared fixtures for the analytics tests. Import AFTER `setupTestDb()` (see dashboard.test.ts).
import { db } from "@/lib/db";
import {
  activities,
  bookingPages,
  broadcasts,
  campaigns,
  contacts,
  emailEvents,
  emailTemplates,
  eventAttendees,
  events,
  jobs,
  leadCaptures,
  messages,
  pageViews,
  tasks,
  users,
} from "@/lib/db/schema";
import { DEFAULT_EVENT_NOTIFICATIONS, type AttendeeStatus, type MeetingOutcome } from "@/lib/types";

export const NOW = new Date("2026-10-13T06:00:00Z");
export const TZ = "UTC";
export const d = (iso: string) => new Date(iso.length <= 10 ? `${iso}T03:00:00Z` : iso);

export async function mkUser(name: string, role: "owner" | "admin" | "member" = "member", email = `${name.toLowerCase()}@test.local`) {
  const [u] = await db.insert(users).values({ name, email, passwordHash: "x", role }).returning();
  return u;
}

export async function mkContact(firstName: string, createdAt: Date, extra: Partial<typeof contacts.$inferInsert> = {}) {
  const [c] = await db
    .insert(contacts)
    .values({ firstName, lastName: "Test", email: `${firstName.toLowerCase()}@example.com`, createdAt, ...extra })
    .returning();
  return c;
}

export async function mkEvent(input: Partial<typeof events.$inferInsert> & { title: string; startsAt: Date; endsAt?: Date }) {
  const [e] = await db
    .insert(events)
    .values({
      notifications: DEFAULT_EVENT_NOTIFICATIONS,
      endsAt: new Date(input.startsAt.getTime() + 3600e3),
      ...input,
    })
    .returning();
  return e;
}

export async function mkAttendee(input: {
  eventId: string;
  contactId: string;
  status: AttendeeStatus;
  registeredAt: Date;
  source?: "manual" | "public" | "import" | "booking" | "api";
  outcome?: MeetingOutcome | null;
  dealValue?: number | null;
  objection?: string | null;
}) {
  const [a] = await db
    .insert(eventAttendees)
    .values({ source: "manual", ...input })
    .returning();
  return a;
}

/**
 * A small world with known numbers (now = 2026-10-13T06:00Z, timezone UTC). See the expectations in
 * dashboard.test.ts / reports.test.ts for the derivations.
 */
export async function seedWorld() {
  const owner = await mkUser("Sam", "owner");
  const host2 = await mkUser("Alex", "member");

  const [campA] = await db
    .insert(campaigns)
    .values({ name: "Spring Webinars", status: "active", budget: 1000, color: "#6366f1", utmCampaign: "spring", startDate: "2026-10-05", endDate: "2026-10-20" })
    .returning();
  const [campB] = await db.insert(campaigns).values({ name: "Cold outreach", status: "active", color: "#f97316" }).returning();
  const [campC] = await db.insert(campaigns).values({ name: "Old stuff", status: "archived" }).returning();

  const [page] = await db
    .insert(bookingPages)
    .values({ slug: "intro", title: "Intro call", hostIds: [owner.id], notifications: DEFAULT_EVENT_NOTIFICATIONS })
    .returning();

  const c1 = await mkContact("Ada", d("2026-10-01"), { source: "registration", utm: { source: "google", medium: "cpc", campaign: "spring" } });
  const c2 = await mkContact("Bob", d("2026-10-05"), { source: "booking", utm: { source: "newsletter", campaign: "spring" } });
  const c3 = await mkContact("Cy", d("2026-09-20"), { source: "import" });
  const c4 = await mkContact("Di", d("2026-09-01"), { source: "manual" });

  // Group events
  const e0 = await mkEvent({ title: "Old Webinar", type: "webinar", status: "completed", startsAt: d("2026-09-05T01:00:00Z"), campaignId: campA.id, hostId: owner.id });
  const e1 = await mkEvent({ title: "Spring Webinar", type: "webinar", status: "scheduled", startsAt: d("2026-10-08T01:00:00Z"), campaignId: campA.id, hostId: owner.id, color: "#10b981" });
  const e2 = await mkEvent({ title: "Autumn Workshop", type: "workshop", status: "scheduled", startsAt: d("2026-10-15T01:00:00Z"), endsAt: d("2026-10-15T03:00:00Z"), campaignId: campA.id, hostId: owner.id, capacity: 10, locationType: "in_person", location: "Perth HQ" });
  const e3 = await mkEvent({ title: "Draft meetup", type: "meetup", status: "draft", startsAt: d("2026-10-20T01:00:00Z"), hostId: host2.id });
  const e4 = await mkEvent({ title: "Cancelled class", type: "class", status: "cancelled", startsAt: d("2026-10-18T01:00:00Z"), hostId: host2.id });

  // Meetings
  const m1 = await mkEvent({ title: "Intro call with Ada Test", kind: "meeting", type: "meeting", startsAt: d("2026-10-09T02:00:00Z"), endsAt: d("2026-10-09T02:30:00Z"), hostId: owner.id, bookingPageId: page.id });
  const m2 = await mkEvent({ title: "Intro call with Cy Test", kind: "meeting", type: "meeting", startsAt: d("2026-10-07T02:00:00Z"), endsAt: d("2026-10-07T02:30:00Z"), hostId: owner.id, bookingPageId: page.id });
  const m3 = await mkEvent({ title: "Intro call with Bob Test", kind: "meeting", type: "meeting", startsAt: d("2026-10-10T02:00:00Z"), endsAt: d("2026-10-10T02:30:00Z"), hostId: host2.id, bookingPageId: page.id });
  const m4 = await mkEvent({ title: "Intro call with Cy Test (2)", kind: "meeting", type: "meeting", startsAt: d("2026-10-14T02:00:00Z"), endsAt: d("2026-10-14T02:30:00Z"), hostId: host2.id, bookingPageId: page.id });
  const m5 = await mkEvent({ title: "Cancelled call", kind: "meeting", type: "meeting", status: "cancelled", startsAt: d("2026-10-08T05:00:00Z"), endsAt: d("2026-10-08T05:30:00Z"), hostId: host2.id });

  // Attendees
  await mkAttendee({ eventId: e0.id, contactId: c4.id, status: "attended", registeredAt: d("2026-09-03"), source: "public" });
  await mkAttendee({ eventId: e0.id, contactId: c3.id, status: "no_show", registeredAt: d("2026-09-03"), source: "public" });
  await mkAttendee({ eventId: e1.id, contactId: c1.id, status: "attended", registeredAt: d("2026-10-02"), source: "public" });
  await mkAttendee({ eventId: e1.id, contactId: c2.id, status: "no_show", registeredAt: d("2026-10-03"), source: "public" });
  await mkAttendee({ eventId: e1.id, contactId: c3.id, status: "registered", registeredAt: d("2026-10-04"), source: "manual" });
  await mkAttendee({ eventId: e1.id, contactId: c4.id, status: "cancelled", registeredAt: d("2026-09-02"), source: "public" });
  await mkAttendee({ eventId: e2.id, contactId: c1.id, status: "registered", registeredAt: d("2026-10-06"), source: "public" });
  await mkAttendee({ eventId: e2.id, contactId: c2.id, status: "waitlisted", registeredAt: d("2026-10-07"), source: "public" });
  await mkAttendee({ eventId: m1.id, contactId: c1.id, status: "attended", registeredAt: d("2026-10-02"), source: "booking", outcome: "won", dealValue: 5000, objection: "no_objection" });
  await mkAttendee({ eventId: m2.id, contactId: c3.id, status: "attended", registeredAt: d("2026-10-01"), source: "booking", outcome: "lost", objection: "money" });
  await mkAttendee({ eventId: m3.id, contactId: c2.id, status: "registered", registeredAt: d("2026-10-05"), source: "booking" });
  await mkAttendee({ eventId: m4.id, contactId: c3.id, status: "registered", registeredAt: d("2026-10-11"), source: "booking" });
  await mkAttendee({ eventId: m5.id, contactId: c4.id, status: "cancelled", registeredAt: d("2026-10-02"), source: "booking", outcome: "cancelled" });

  // Funnel inputs
  const views: [string, string][] = [
    [e1.id, "h1"], [e1.id, "h1"], [e1.id, "h2"], [e1.id, "h3"], [e1.id, "h4"], [e1.id, "h5"],
    [e2.id, "h1"], [e2.id, "h2"], [e2.id, "h3"],
  ];
  for (const [targetId, visitorHash] of views) {
    await db.insert(pageViews).values({ kind: "event", targetId, visitorHash, createdAt: d("2026-10-03") });
  }
  for (const [contact, kind, target, when] of [
    [c1, "registration", e1.id, "2026-10-02"],
    [c2, "registration", e1.id, "2026-10-03"],
    [c3, "registration", e1.id, "2026-10-04"],
    [c1, "booking", page.id, "2026-10-02"],
    [c2, "booking", page.id, "2026-10-05"],
    [c3, "booking", page.id, "2026-10-11"],
    [c4, "registration", e0.id, "2026-09-02"], // previous period
  ] as const) {
    await db.insert(leadCaptures).values({ contactId: contact.id, kind, targetId: target, createdAt: d(when) });
  }

  // Email
  const [t1] = await db.insert(emailTemplates).values({ name: "Welcome", subject: "Hi", category: "marketing" }).returning();
  const [t2] = await db.insert(emailTemplates).values({ name: "Follow-up", subject: "Thanks", category: "follow_up" }).returning();
  const [b1] = await db
    .insert(broadcasts)
    .values({ name: "October news", subject: "News", status: "sent", sentAt: d("2026-10-03"), recipientCount: 5, campaignId: campA.id })
    .returning();
  const [b2] = await db
    .insert(broadcasts)
    .values({ name: "Upcoming send", subject: "Soon", status: "scheduled", scheduledAt: d("2026-10-16T01:00:00Z"), campaignId: campA.id })
    .returning();
  const mk = (over: Partial<typeof messages.$inferInsert>) =>
    db
      .insert(messages)
      .values({ toEmail: "x@example.com", fromEmail: "hello@example.com", subject: "s", html: "<p>x</p>", status: "simulated", kind: "notification", ...over })
      .returning();
  const [m_1] = await mk({ createdAt: d("2026-10-02"), openedAt: d("2026-10-02"), templateId: t1.id });
  await mk({ createdAt: d("2026-10-03"), status: "sent", kind: "broadcast", broadcastId: b1.id, openedAt: d("2026-10-03"), clickedAt: d("2026-10-03") });
  const [m_3] = await mk({ createdAt: d("2026-10-04"), kind: "automation", templateId: t2.id });
  await mk({ createdAt: d("2026-10-12"), status: "failed", templateId: t1.id, error: "boom" });
  await mk({ createdAt: d("2026-10-05"), kind: "test" });
  await mk({ createdAt: d("2026-09-10") });
  const [m_7] = await mk({ createdAt: d("2026-10-03"), kind: "broadcast", broadcastId: b1.id });
  await db.insert(emailEvents).values({ messageId: m_7.id, type: "unsubscribe" });
  void m_1;
  void m_3;

  // Tasks, jobs, activities
  const taskBase = { createdById: owner.id };
  await db.insert(tasks).values([
    { ...taskBase, title: "Overdue (mine)", dueAt: d("2026-10-10T01:00:00Z"), assigneeId: owner.id, contactId: c1.id },
    { ...taskBase, title: "Overdue (other)", dueAt: d("2026-10-10T01:00:00Z"), assigneeId: host2.id },
    { ...taskBase, title: "Overdue (unassigned)", dueAt: d("2026-10-11T01:00:00Z") },
    { ...taskBase, title: "Future", dueAt: d("2026-10-17T01:00:00Z"), assigneeId: owner.id },
    { ...taskBase, title: "Done", dueAt: d("2026-10-09T01:00:00Z"), assigneeId: owner.id, completedAt: d("2026-10-09T05:00:00Z") },
  ]);
  await db.insert(jobs).values([
    { type: "x", status: "failed", createdAt: d("2026-10-11") },
    { type: "x", status: "pending" },
  ]);
  await db.insert(activities).values([
    { contactId: c1.id, type: "event_registered", title: "Registered for “Spring Webinar”", createdAt: d("2026-10-02") },
    { contactId: c2.id, type: "note", title: "Called back", createdAt: d("2026-10-12T02:00:00Z") },
    { contactId: null, type: "automation", title: "System thing", createdAt: d("2026-10-05") },
  ]);

  return { owner, host2, campA, campB, campC, page, c1, c2, c3, c4, e0, e1, e2, e3, e4, m1, m2, m3, m4, m5, b1, b2, t1, t2 };
}
