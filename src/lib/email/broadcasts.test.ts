import { describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { setupTestDb, createTestUser } from "@/test/setup-db";

const { db } = await setupTestDb();
const { broadcasts, contactTags, contacts, emailEvents, eventAttendees, events, jobs, messages, notifications, tags } = await import("@/lib/db/schema");
const { upsertContact } = await import("@/lib/contacts");
const { processDueJobs } = await import("@/lib/jobs/runner");
const { DEFAULT_EVENT_NOTIFICATIONS } = await import("@/lib/types");
const {
  BroadcastError,
  cancelBroadcast,
  deleteBroadcast,
  duplicateBroadcast,
  getBroadcastListMetrics,
  getBroadcastStats,
  getBroadcastTopLinks,
  listBroadcastRecipients,
  queueBroadcast,
  runBroadcastSend,
  saveBroadcast,
} = await import("./broadcasts");

let counter = 0;
async function makeContact(opts: { email?: string | null; status?: "subscribed" | "unsubscribed" | "bounced" | "complained"; firstName?: string } = {}) {
  counter++;
  const email = opts.email === undefined ? `person${counter}@bc.test` : opts.email;
  const { contact } = await upsertContact({ email, firstName: opts.firstName ?? `Person${counter}`, lastName: "Test" }, { source: "manual" });
  if (opts.status && opts.status !== "subscribed") {
    await db.update(contacts).set({ emailStatus: opts.status, unsubscribedAt: opts.status === "unsubscribed" ? new Date() : null }).where(eq(contacts.id, contact.id));
  }
  if (email === null) {
    await db.update(contacts).set({ email: null }).where(eq(contacts.id, contact.id));
  }
  return contact;
}

async function makeTag(name: string) {
  const [t] = await db.insert(tags).values({ name }).returning();
  return t;
}
async function tagContacts(tagId: string, ids: string[]) {
  await db.insert(contactTags).values(ids.map((contactId) => ({ contactId, tagId })));
}

async function draft(audience: import("@/lib/types").Audience, patch: Partial<{ name: string; subject: string; html: string }> = {}) {
  const user = await createTestUser();
  return saveBroadcast(
    {
      name: patch.name ?? "Spring news",
      subject: patch.subject ?? "Hello {{contact.first_name}}",
      preheader: "Big news inside",
      contentHtml: patch.html ?? `<p>Hi {{contact.first_name | "friend"}}, <a href="https://example.com/offer">see the offer</a>.</p>`,
      contentJson: null,
      audience,
    },
    user.id,
  );
}

const sentTo = async (broadcastId: string) =>
  db.select().from(messages).where(eq(messages.broadcastId, broadcastId));

describe("broadcast sending", () => {
  it("sends to subscribed contacts only (unsubscribed, bounced, complained and email-less are excluded)", async () => {
    const tag = await makeTag("audience-1");
    const ok1 = await makeContact({ firstName: "Ada" });
    const ok2 = await makeContact();
    const unsub = await makeContact({ status: "unsubscribed" });
    const bounced = await makeContact({ status: "bounced" });
    const complained = await makeContact({ status: "complained" });
    const noEmail = await makeContact({ email: null });
    await tagContacts(tag.id, [ok1.id, ok2.id, unsub.id, bounced.id, complained.id, noEmail.id]);

    const b = await draft({ type: "tags", tagIds: [tag.id], match: "any" });
    const queued = await queueBroadcast(b.id);
    expect(queued.status).toBe("sending");
    await processDueJobs();

    const msgs = await sentTo(b.id);
    expect(msgs.map((m) => m.contactId).sort()).toEqual([ok1.id, ok2.id].sort());
    const ada = msgs.find((m) => m.contactId === ok1.id)!;
    expect(ada.kind).toBe("broadcast");
    expect(ada.status).toBe("simulated");
    expect(ada.subject).toBe("Hello Ada");
    expect(ada.html).toContain("Unsubscribe"); // marketing footer
    expect(ada.html).toContain("Big news inside"); // preheader

    const [done] = await db.select().from(broadcasts).where(eq(broadcasts.id, b.id));
    expect(done.status).toBe("sent");
    expect(done.recipientCount).toBe(2);
    expect(done.sentAt).toBeTruthy();
    const bell = await db.select().from(notifications).where(eq(notifications.userId, b.createdById!));
    expect(bell.some((n) => n.type === "broadcast_sent")).toBe(true);
  });

  it("resolves tag audiences with any / all matching", async () => {
    const t1 = await makeTag("t-any-1");
    const t2 = await makeTag("t-any-2");
    const both = await makeContact();
    const only1 = await makeContact();
    const only2 = await makeContact();
    const none = await makeContact();
    await tagContacts(t1.id, [both.id, only1.id]);
    await tagContacts(t2.id, [both.id, only2.id]);

    const any = await draft({ type: "tags", tagIds: [t1.id, t2.id], match: "any" });
    await queueBroadcast(any.id);
    const all = await draft({ type: "tags", tagIds: [t1.id, t2.id], match: "all" });
    await queueBroadcast(all.id);
    await processDueJobs();

    expect((await sentTo(any.id)).map((m) => m.contactId).sort()).toEqual([both.id, only1.id, only2.id].sort());
    expect((await sentTo(all.id)).map((m) => m.contactId)).toEqual([both.id]);
    expect((await sentTo(any.id)).some((m) => m.contactId === none.id)).toBe(false);
  });

  it("fills event merge tags for event audiences", async () => {
    const host = await createTestUser();
    const start = new Date(Date.now() + 5 * 864e5);
    const [event] = await db
      .insert(events)
      .values({ title: "Growth Workshop", startsAt: start, endsAt: new Date(start.getTime() + 3600e3), notifications: DEFAULT_EVENT_NOTIFICATIONS, hostId: host.id })
      .returning();
    const attended = await makeContact();
    const cancelled = await makeContact();
    await db.insert(eventAttendees).values([
      { eventId: event.id, contactId: attended.id, status: "attended" },
      { eventId: event.id, contactId: cancelled.id, status: "cancelled" },
    ]);
    const b = await draft(
      { type: "event", eventId: event.id, statuses: ["attended"] },
      { subject: "Thanks for joining {{event.title}}", html: `<p><a href="{{attendee.manage_url}}">Manage</a></p>` },
    );
    await queueBroadcast(b.id);
    await processDueJobs();
    const msgs = await sentTo(b.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].contactId).toBe(attended.id);
    expect(msgs[0].subject).toBe("Thanks for joining Growth Workshop");
    expect(msgs[0].eventId).toBe(event.id);
    expect(msgs[0].html).toContain("%2Fm%2F"); // attendee manage link (click-tracked, url-encoded)
  });

  it("is resumable: batches, re-enqueues itself and never double-sends", async () => {
    const tag = await makeTag("resumable");
    const people = [];
    for (let i = 0; i < 5; i++) people.push(await makeContact());
    await tagContacts(tag.id, people.map((p) => p.id));
    const b = await draft({ type: "tags", tagIds: [tag.id], match: "any" });
    await queueBroadcast(b.id);
    // The queued job exists but we drive the handler by hand with tiny batches.
    const first = await runBroadcastSend(b.id, { batchSize: 2, maxBatches: 1 });
    expect(first).toMatchObject({ sent: 2, finished: false });
    expect(await sentTo(b.id)).toHaveLength(2);
    const [mid] = await db.select().from(broadcasts).where(eq(broadcasts.id, b.id));
    expect(mid.status).toBe("sending");
    expect(mid.recipientCount).toBe(2);
    const followUp = (await db.select().from(jobs)).filter((j) => j.dedupeKey?.startsWith(`broadcast:${b.id}:after:`));
    expect(followUp).toHaveLength(1);
    const cursor = (followUp[0].payload as { afterId: string }).afterId;

    // Simulate a crash/retry of the first run: nothing is sent twice.
    const retry = await runBroadcastSend(b.id, { batchSize: 2, maxBatches: 1 });
    expect(retry.sent).toBe(2);
    expect(new Set((await sentTo(b.id)).map((m) => m.contactId)).size).toBe(4);

    const rest = await runBroadcastSend(b.id, { afterId: cursor, batchSize: 2 });
    expect(rest.finished).toBe(true);
    const msgs = await sentTo(b.id);
    expect(msgs).toHaveLength(5);
    expect(new Set(msgs.map((m) => m.contactId)).size).toBe(5);
    const [done] = await db.select().from(broadcasts).where(eq(broadcasts.id, b.id));
    expect(done).toMatchObject({ status: "sent", recipientCount: 5 });

    // Running a finished broadcast again is a no-op.
    expect((await runBroadcastSend(b.id)).noop).toBe("sent");
    expect(await sentTo(b.id)).toHaveLength(5);
  });

  it("completes through the job queue when more than one batch is needed", async () => {
    const tag = await makeTag("multi-batch");
    const people = [];
    for (let i = 0; i < 7; i++) people.push(await makeContact());
    await tagContacts(tag.id, people.map((p) => p.id));
    const b = await draft({ type: "tags", tagIds: [tag.id], match: "any" });
    await queueBroadcast(b.id);
    // Make the first run stop after one tiny batch by using the budget option directly.
    await runBroadcastSend(b.id, { batchSize: 3, maxBatches: 1 });
    await processDueJobs(); // runs the re-enqueued continuation + the original job
    const msgs = await sentTo(b.id);
    expect(new Set(msgs.map((m) => m.contactId)).size).toBe(7);
    expect(msgs).toHaveLength(7);
    const [done] = await db.select().from(broadcasts).where(eq(broadcasts.id, b.id));
    expect(done.status).toBe("sent");
    expect(done.recipientCount).toBe(7);
  });

  it("skips contacts that already have a message for the broadcast", async () => {
    const tag = await makeTag("already-sent");
    const a = await makeContact();
    const c = await makeContact();
    await tagContacts(tag.id, [a.id, c.id]);
    const b = await draft({ type: "tags", tagIds: [tag.id], match: "any" });
    await queueBroadcast(b.id);
    await db.insert(messages).values({
      contactId: a.id,
      toEmail: a.email!,
      fromEmail: "x@y.z",
      subject: "already",
      html: "<p>x</p>",
      kind: "broadcast",
      broadcastId: b.id,
      status: "sent",
    });
    await processDueJobs();
    const msgs = await sentTo(b.id);
    expect(msgs).toHaveLength(2);
    expect(msgs.filter((m) => m.contactId === a.id)).toHaveLength(1);
  });
});

describe("scheduling & lifecycle", () => {
  it("schedules with a delayed job, can be cancelled, and returns to editable", async () => {
    const tag = await makeTag("sched");
    const a = await makeContact();
    await tagContacts(tag.id, [a.id]);
    const b = await draft({ type: "tags", tagIds: [tag.id], match: "any" });

    await expect(queueBroadcast(b.id, { scheduledAt: new Date(Date.now() - 1000) })).rejects.toBeInstanceOf(BroadcastError);

    const at = new Date(Date.now() + 3 * 3600e3);
    const scheduled = await queueBroadcast(b.id, { scheduledAt: at });
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.scheduledAt?.getTime()).toBe(at.getTime());
    const job = (await db.select().from(jobs)).find((j) => j.dedupeKey === `broadcast:${b.id}:${at.getTime()}`);
    expect(job?.status).toBe("pending");
    expect(job?.runAt.getTime()).toBe(at.getTime());

    // Not due yet: processing does nothing.
    await processDueJobs();
    expect(await sentTo(b.id)).toHaveLength(0);
    // Editing a scheduled broadcast is refused.
    await expect(saveBroadcast({ id: b.id, name: "x", subject: "s", contentHtml: "<p>x</p>", audience: { type: "all" } }, null)).rejects.toBeInstanceOf(BroadcastError);

    const cancelled = await cancelBroadcast(b.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.scheduledAt).toBeNull();
    const [jobAfter] = await db.select().from(jobs).where(eq(jobs.id, job!.id));
    expect(jobAfter.status).toBe("cancelled");
    await expect(cancelBroadcast(b.id)).rejects.toBeInstanceOf(BroadcastError);

    // A cancelled broadcast can be edited (back to draft) and scheduled again.
    const edited = await saveBroadcast({ id: b.id, name: "Renamed", subject: "s", contentHtml: "<p>x</p>", audience: b.audience }, null);
    expect(edited.status).toBe("draft");
    const again = await queueBroadcast(b.id, { scheduledAt: new Date(Date.now() + 7200e3) });
    expect(again.status).toBe("scheduled");
  });

  it("a scheduled broadcast sends when its job comes due (and ignores stale jobs)", async () => {
    const tag = await makeTag("sched-due");
    const a = await makeContact();
    await tagContacts(tag.id, [a.id]);
    const b = await draft({ type: "tags", tagIds: [tag.id], match: "any" });
    await queueBroadcast(b.id, { scheduledAt: new Date(Date.now() + 3 * 3600e3) });
    // Stale/early run: nothing happens.
    expect((await runBroadcastSend(b.id)).noop).toBe("not due");
    // Time passes: scheduledAt is now in the past.
    await db.update(broadcasts).set({ scheduledAt: new Date(Date.now() - 1000) }).where(eq(broadcasts.id, b.id));
    const res = await runBroadcastSend(b.id);
    expect(res.finished).toBe(true);
    expect(await sentTo(b.id)).toHaveLength(1);
    const [done] = await db.select().from(broadcasts).where(eq(broadcasts.id, b.id));
    expect(done.status).toBe("sent");
  });

  it("stopping a send in progress prevents further batches", async () => {
    const tag = await makeTag("stop");
    const people = [];
    for (let i = 0; i < 4; i++) people.push(await makeContact());
    await tagContacts(tag.id, people.map((p) => p.id));
    const b = await draft({ type: "tags", tagIds: [tag.id], match: "any" });
    await queueBroadcast(b.id);
    await runBroadcastSend(b.id, { batchSize: 2, maxBatches: 1 });
    const stopped = await cancelBroadcast(b.id);
    expect(stopped.status).toBe("cancelled");
    expect(stopped.recipientCount).toBe(2);
    await processDueJobs();
    expect(await sentTo(b.id)).toHaveLength(2);
    expect((await runBroadcastSend(b.id)).noop).toBe("cancelled");
  });

  it("validates before sending", async () => {
    const empty = await draft({ type: "contacts", contactIds: [] });
    await expect(queueBroadcast(empty.id)).rejects.toThrow(/No eligible recipients/);
    const a = await makeContact();
    const noSubject = await draft({ type: "contacts", contactIds: [a.id] }, { subject: "" });
    await expect(queueBroadcast(noSubject.id)).rejects.toThrow(/subject/i);
    const noBody = await draft({ type: "contacts", contactIds: [a.id] }, { html: "<p></p>" });
    await expect(queueBroadcast(noBody.id)).rejects.toThrow(/empty/i);
    const unsub = await makeContact({ status: "unsubscribed" });
    const onlyUnsub = await draft({ type: "contacts", contactIds: [unsub.id] });
    await expect(queueBroadcast(onlyUnsub.id)).rejects.toBeInstanceOf(BroadcastError);
    const ok = await draft({ type: "contacts", contactIds: [a.id] });
    await queueBroadcast(ok.id);
    await expect(queueBroadcast(ok.id)).rejects.toThrow(/already/i);
  });

  it("duplicates and deletes", async () => {
    const a = await makeContact();
    const b = await draft({ type: "contacts", contactIds: [a.id] }, { name: "Original" });
    const copy = await duplicateBroadcast(b.id, null);
    expect(copy.name).toBe("Original (copy)");
    expect(copy.status).toBe("draft");
    expect(copy.audience).toEqual(b.audience);
    await deleteBroadcast(copy.id);
    expect(await db.select().from(broadcasts).where(eq(broadcasts.id, copy.id))).toHaveLength(0);
    await queueBroadcast(b.id);
    await processDueJobs();
    await expect(deleteBroadcast(b.id)).rejects.toBeInstanceOf(BroadcastError);
  });
});

describe("broadcast reporting", () => {
  it("computes KPIs, recipients and top links", async () => {
    const tag = await makeTag("report");
    const people = [];
    for (let i = 0; i < 4; i++) people.push(await makeContact());
    await tagContacts(tag.id, people.map((p) => p.id));
    const b = await draft({ type: "tags", tagIds: [tag.id], match: "any" });
    await queueBroadcast(b.id);
    await processDueJobs();
    const msgs = await sentTo(b.id);
    expect(msgs).toHaveLength(4);

    const [m1, m2, m3, m4] = msgs;
    await db.update(messages).set({ openedAt: new Date(), openCount: 2 }).where(inArray(messages.id, [m1.id, m2.id]));
    await db.update(messages).set({ clickedAt: new Date(), clickCount: 3, openedAt: new Date(), openCount: 1 }).where(eq(messages.id, m1.id));
    await db.update(messages).set({ status: "failed", error: "Mailbox full" }).where(eq(messages.id, m4.id));
    await db.insert(emailEvents).values([
      { messageId: m1.id, type: "click", url: "https://example.com/offer" },
      { messageId: m1.id, type: "click", url: "https://example.com/offer" },
      { messageId: m1.id, type: "click", url: "https://example.com/blog" },
      { messageId: m2.id, type: "click", url: "https://example.com/offer" },
      { messageId: m2.id, type: "open", url: null },
    ]);
    // m3's contact unsubscribes after the send.
    await db.update(contacts).set({ emailStatus: "unsubscribed", unsubscribedAt: new Date(Date.now() + 1000) }).where(eq(contacts.id, m3.contactId!));

    const stats = await getBroadcastStats(b.id);
    expect(stats).toMatchObject({ total: 4, delivered: 3, opened: 2, clicked: 1, failed: 1, queued: 0, unsubscribed: 1 });

    const links = await getBroadcastTopLinks(b.id);
    expect(links[0]).toEqual({ url: "https://example.com/offer", clicks: 3, uniqueClicks: 2 });
    expect(links[1]).toEqual({ url: "https://example.com/blog", clicks: 1, uniqueClicks: 1 });

    const all = await listBroadcastRecipients(b.id, { pageSize: 3 });
    expect(all.total).toBe(4);
    expect(all.rows).toHaveLength(3);
    expect(all.pages).toBe(2);
    expect((await listBroadcastRecipients(b.id, { filter: "failed" })).rows.map((r) => r.id)).toEqual([m4.id]);
    expect((await listBroadcastRecipients(b.id, { filter: "opened" })).total).toBe(2);
    expect((await listBroadcastRecipients(b.id, { filter: "clicked" })).total).toBe(1);

    const metrics = await getBroadcastListMetrics([b.id]);
    expect(metrics.get(b.id)).toEqual({ total: 4, delivered: 3, opened: 2, clicked: 1 });
    expect(await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, m3.contactId!), eq(contacts.emailStatus, "unsubscribed")))).toHaveLength(1);
  });
});
