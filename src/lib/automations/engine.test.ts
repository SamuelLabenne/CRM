import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { setupTestDb, createTestUser } from "@/test/setup-db";

const { db } = await setupTestDb();
const schema = await import("@/lib/db/schema");
const { automations, automationRuns, automationLogs, bookingPages, campaigns, contacts, emailTemplates, eventAttendees, events, jobs, messages, notifications, tags, tasks, activities } = schema;
const { upsertContact, ensureTag, changeStage, addTagToContact } = await import("@/lib/contacts");
const { emitTrigger } = await import("./triggers");
const { processDueJobs } = await import("@/lib/jobs/runner");
const { registerForEvent, markAttendance, cancelRegistration, setMeetingOutcome } = await import("@/lib/events/registration");
const { MAX_ENROLLMENTS_PER_HOUR, STEP_RETRY_DELAYS_MS, enrollContact, processRun, triggerMatches } = await import("./engine");
const { deleteAutomation, cancelAutomationJobs, setAutomationStatus, enrollContacts, getAutomationStats } = await import("./service");
const { cancelRun } = await import("./engine");
const { DEFAULT_EVENT_NOTIFICATIONS } = await import("@/lib/types");
type AutomationStep = import("@/lib/types").AutomationStep;
type AutomationTrigger = import("@/lib/types").AutomationTrigger;

const DAY = 864e5;
let seq = 0;

/** Process every due job (including follow-up jobs queued while processing). */
async function drain(max = 100) {
  for (let i = 0; i < max; i++) {
    const r = await processDueJobs({ maxBatches: 8 });
    const [due] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), sql`${jobs.runAt} <= ${new Date().toISOString()}::timestamptz`));
    if (!due.n && !r.processed) return;
    if (!due.n) return;
  }
  throw new Error("jobs never settled");
}

async function mkContact(overrides: Partial<{ email: string; firstName: string; lastName: string; stage: string }> = {}) {
  seq++;
  const { contact } = await upsertContact(
    { email: overrides.email ?? `c${seq}-${Math.random().toString(36).slice(2, 6)}@example.com`, firstName: overrides.firstName ?? "Ada", lastName: overrides.lastName, stage: overrides.stage },
    { source: "manual" },
  );
  return contact;
}

async function mkAutomation(opts: {
  trigger: AutomationTrigger;
  steps: AutomationStep[];
  status?: "draft" | "active" | "paused";
  allowReentry?: boolean;
  name?: string;
}) {
  const [a] = await db
    .insert(automations)
    .values({
      name: opts.name ?? `Automation ${++seq}`,
      status: opts.status ?? "active",
      trigger: opts.trigger,
      steps: opts.steps,
      allowReentry: opts.allowReentry ?? false,
    })
    .returning();
  return a;
}

async function mkTemplate(subject = "Hello {{contact.first_name}}", name = "Test template") {
  const [t] = await db.insert(emailTemplates).values({ name, subject, contentHtml: "<p>Hi {{contact.first_name | \"there\"}}</p>", category: "follow_up" }).returning();
  return t;
}

async function mkEvent(opts: { startsInMs?: number; durationMs?: number; campaignId?: string | null; bookingPageId?: string | null; kind?: "event" | "meeting"; title?: string } = {}) {
  const host = await createTestUser();
  const start = new Date(Date.now() + (opts.startsInMs ?? 3 * DAY));
  const [e] = await db
    .insert(events)
    .values({
      title: opts.title ?? "Workshop",
      kind: opts.kind ?? "event",
      startsAt: start,
      endsAt: new Date(start.getTime() + (opts.durationMs ?? 3600e3)),
      notifications: { ...DEFAULT_EVENT_NOTIFICATIONS, reminders: [], followUps: [], confirmation: { enabled: false }, notifyHost: false },
      campaignId: opts.campaignId ?? null,
      bookingPageId: opts.bookingPageId ?? null,
      hostId: host.id,
    })
    .returning();
  return e;
}

async function runsOf(automationId: string) {
  return db.select().from(automationRuns).where(eq(automationRuns.automationId, automationId)).orderBy(asc(automationRuns.startedAt));
}
async function logsOf(runId: string) {
  return db.select().from(automationLogs).where(eq(automationLogs.runId, runId)).orderBy(asc(automationLogs.createdAt));
}
async function stepJobs(runId: string, status?: "pending" | "done" | "cancelled" | "failed") {
  const rows = await db.select().from(jobs).where(eq(jobs.type, "automation.step"));
  return rows.filter((j) => (j.payload as { runId?: string }).runId === runId && (!status || j.status === status));
}
async function tagsOf(contactId: string) {
  const rows = await db.select({ name: tags.name }).from(schema.contactTags).innerJoin(tags, eq(tags.id, schema.contactTags.tagId)).where(eq(schema.contactTags.contactId, contactId));
  return rows.map((r) => r.name);
}
async function emailsFor(contactId: string) {
  return db.select().from(messages).where(and(eq(messages.contactId, contactId), eq(messages.kind, "automation")));
}

beforeEach(async () => {
  await db.delete(jobs);
  await db.delete(automations);
  await db.delete(contacts);
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe("trigger matching", () => {
  it("enrols on contact_created (end to end through the job queue) and runs to completion", async () => {
    const tag = await ensureTag("Welcomed");
    const a = await mkAutomation({ trigger: { type: "contact_created", config: {} }, steps: [{ id: "s1", type: "add_tag", tagId: tag.id }] });
    const c = await mkContact();
    // emitTrigger only queues a job – nothing happens until the runner processes it
    expect(await runsOf(a.id)).toHaveLength(0);
    await drain();
    const [run] = await runsOf(a.id);
    expect(run.contactId).toBe(c.id);
    expect(run.status).toBe("completed");
    expect(run.currentStep).toBe(1);
    expect(await tagsOf(c.id)).toContain("Welcomed");
  });

  it("matches tagId for tag_added", async () => {
    const vip = await ensureTag("VIP");
    const other = await ensureTag("Other");
    const any = await mkAutomation({ trigger: { type: "tag_added", config: {} }, steps: [] });
    const onlyVip = await mkAutomation({ trigger: { type: "tag_added", config: { tagId: vip.id } }, steps: [] });
    const c = await mkContact();
    await db.delete(jobs); // ignore contact_created
    await addTagToContact(c.id, other.id);
    await drain();
    expect(await runsOf(any.id)).toHaveLength(1);
    expect(await runsOf(onlyVip.id)).toHaveLength(0);
    const c2 = await mkContact();
    await db.delete(jobs);
    await addTagToContact(c2.id, vip.id);
    await drain();
    expect((await runsOf(onlyVip.id)).map((r) => r.contactId)).toEqual([c2.id]);
  });

  it("matches stage for stage_changed", async () => {
    const a = await mkAutomation({ trigger: { type: "stage_changed", config: { stage: "customer" } }, steps: [] });
    const c = await mkContact();
    await changeStage(c.id, "contacted");
    await drain();
    expect(await runsOf(a.id)).toHaveLength(0);
    await changeStage(c.id, "customer");
    await drain();
    expect(await runsOf(a.id)).toHaveLength(1);
  });

  it("matches eventId and campaignId (through the event's campaign) for event_registered", async () => {
    const [campaign] = await db.insert(campaigns).values({ name: "Autumn" }).returning();
    const [otherCampaign] = await db.insert(campaigns).values({ name: "Winter" }).returning();
    const inCampaign = await mkEvent({ campaignId: campaign.id, title: "In campaign" });
    const outside = await mkEvent({ title: "Outside" });
    const anyEvent = await mkAutomation({ trigger: { type: "event_registered", config: {} }, steps: [], allowReentry: true });
    const byEvent = await mkAutomation({ trigger: { type: "event_registered", config: { eventId: outside.id } }, steps: [] });
    const byCampaign = await mkAutomation({ trigger: { type: "event_registered", config: { campaignId: campaign.id } }, steps: [] });
    const byOtherCampaign = await mkAutomation({ trigger: { type: "event_registered", config: { campaignId: otherCampaign.id } }, steps: [] });
    const c = await mkContact();
    await db.delete(jobs);

    await registerForEvent({ eventId: inCampaign.id, contactId: c.id, source: "manual" });
    await drain();
    expect(await runsOf(anyEvent.id)).toHaveLength(1);
    expect(await runsOf(byCampaign.id)).toHaveLength(1);
    expect(await runsOf(byEvent.id)).toHaveLength(0);
    expect(await runsOf(byOtherCampaign.id)).toHaveLength(0);

    await registerForEvent({ eventId: outside.id, contactId: c.id, source: "manual" });
    await drain();
    expect(await runsOf(anyEvent.id)).toHaveLength(2);
    expect(await runsOf(byEvent.id)).toHaveLength(1);
    expect(await runsOf(byCampaign.id)).toHaveLength(1);
    const [run] = await runsOf(byEvent.id);
    expect(run.context.eventId).toBe(outside.id);
    expect(run.context.attendeeId).toBeTruthy();
  });

  it("matches bookingPageId and outcome for meeting triggers", async () => {
    const [pageA] = await db.insert(bookingPages).values({ slug: "intro", title: "Intro", notifications: DEFAULT_EVENT_NOTIFICATIONS }).returning();
    const [pageB] = await db.insert(bookingPages).values({ slug: "demo", title: "Demo", notifications: DEFAULT_EVENT_NOTIFICATIONS }).returning();
    const booked = await mkAutomation({ trigger: { type: "meeting_booked", config: { bookingPageId: pageA.id } }, steps: [] });
    const bookedB = await mkAutomation({ trigger: { type: "meeting_booked", config: { bookingPageId: pageB.id } }, steps: [] });
    const noShow = await mkAutomation({ trigger: { type: "meeting_outcome", config: { outcome: "no_show", bookingPageId: pageA.id } }, steps: [] });
    const won = await mkAutomation({ trigger: { type: "meeting_outcome", config: { outcome: "won" } }, steps: [] });
    const meeting = await mkEvent({ kind: "meeting", bookingPageId: pageA.id, title: "Intro with Ada" });
    const c = await mkContact();
    await db.delete(jobs);
    const { attendee } = await registerForEvent({ eventId: meeting.id, contactId: c.id, source: "booking" });
    await drain();
    expect(await runsOf(booked.id)).toHaveLength(1);
    expect(await runsOf(bookedB.id)).toHaveLength(0);
    // meeting_outcome context has no bookingPageId – it is resolved from the meeting itself
    await setMeetingOutcome(attendee.id, { outcome: "no_show" });
    await drain();
    expect(await runsOf(noShow.id)).toHaveLength(1);
    expect(await runsOf(won.id)).toHaveLength(0);
  });

  it("ignores draft and paused automations", async () => {
    const draft = await mkAutomation({ trigger: { type: "contact_created", config: {} }, steps: [], status: "draft" });
    const paused = await mkAutomation({ trigger: { type: "contact_created", config: {} }, steps: [], status: "paused" });
    const active = await mkAutomation({ trigger: { type: "contact_created", config: {} }, steps: [] });
    await mkContact();
    await drain();
    expect(await runsOf(draft.id)).toHaveLength(0);
    expect(await runsOf(paused.id)).toHaveLength(0);
    expect(await runsOf(active.id)).toHaveLength(1);
  });

  it("does not match a different trigger type", async () => {
    const a = await mkAutomation({ trigger: { type: "event_attended", config: {} }, steps: [] });
    const c = await mkContact();
    await drain();
    expect(await runsOf(a.id)).toHaveLength(0);
    await emitTrigger("event_attended", c.id, { eventId: undefined });
    await drain();
    expect(await runsOf(a.id)).toHaveLength(1);
  });

  it("triggerMatches is strict about every configured filter", () => {
    const t: AutomationTrigger = { type: "meeting_outcome", config: { outcome: "won", bookingPageId: "p1", campaignId: "c1" } };
    expect(triggerMatches(t, "meeting_outcome", { outcome: "won" }, { bookingPageId: "p1", campaignId: "c1" })).toBe(true);
    expect(triggerMatches(t, "meeting_outcome", { outcome: "lost" }, { bookingPageId: "p1", campaignId: "c1" })).toBe(false);
    expect(triggerMatches(t, "meeting_outcome", { outcome: "won" }, { bookingPageId: "p2", campaignId: "c1" })).toBe(false);
    expect(triggerMatches(t, "meeting_outcome", { outcome: "won" }, { bookingPageId: "p1", campaignId: null })).toBe(false);
    expect(triggerMatches(t, "meeting_booked", { outcome: "won" }, { bookingPageId: "p1", campaignId: "c1" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("re-entry rules", () => {
  it("without allowReentry: no second run while one is waiting, nor after completion", async () => {
    const a = await mkAutomation({
      trigger: { type: "contact_created", config: {} },
      steps: [{ id: "w", type: "wait", amount: 1, unit: "days" }],
    });
    const c = await mkContact();
    await drain();
    let runs = await runsOf(a.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("waiting");

    await emitTrigger("contact_created", c.id);
    await drain();
    expect(await runsOf(a.id)).toHaveLength(1); // still waiting → skipped

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 2 * DAY));
    await drain();
    runs = await runsOf(a.id);
    expect(runs[0].status).toBe("completed");

    await emitTrigger("contact_created", c.id);
    await drain();
    expect(await runsOf(a.id)).toHaveLength(1); // completed → still no re-entry
  });

  it("with allowReentry a contact can enter again (while waiting and after completion)", async () => {
    const a = await mkAutomation({
      trigger: { type: "contact_created", config: {} },
      steps: [{ id: "w", type: "wait", amount: 1, unit: "days" }],
      allowReentry: true,
    });
    const c = await mkContact();
    await drain();
    await emitTrigger("contact_created", c.id);
    await drain();
    const runs = await runsOf(a.id);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.status === "waiting")).toBe(true);
  });

  it("an exited or failed run also blocks re-enrolment when re-entry is off, a cancelled one doesn't", async () => {
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [{ id: "c", type: "condition", filter: { match: "all", filters: [{ field: "stage", operator: "is", value: "customer" }] } }],
    });
    const c = await mkContact();
    const first = await enrollContact(a, c.id, {}, { source: "manual" });
    expect(first.enrolled).toBe(true);
    await drain();
    expect((await runsOf(a.id))[0].status).toBe("exited");
    expect(await enrollContact(a, c.id, {}, { source: "manual" })).toEqual({ enrolled: false, reason: "already_enrolled" });

    const b = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "w", type: "wait", amount: 1, unit: "days" }] });
    const c2 = await mkContact();
    const res = await enrollContact(b, c2.id, {}, { source: "manual" });
    expect(res.enrolled).toBe(true);
    await drain();
    expect(await enrollContact(b, c2.id, {}, { source: "manual" })).toEqual({ enrolled: false, reason: "already_active" });
    await cancelRun((res as { runId: string }).runId);
    expect((await enrollContact(b, c2.id, {}, { source: "manual" })).enrolled).toBe(true);
  });

  it("never enrols into an inactive automation or for a missing contact", async () => {
    const paused = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [], status: "paused" });
    const c = await mkContact();
    expect(await enrollContact(paused, c.id, {}, { source: "manual" })).toEqual({ enrolled: false, reason: "not_active" });
    const active = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [] });
    expect(await enrollContact(active, "00000000-0000-4000-8000-000000000000", {}, { source: "manual" })).toEqual({
      enrolled: false,
      reason: "contact_not_found",
    });
  });

  it("guards against self-triggering loops (re-entry on + remove/add the same tag)", async () => {
    const tag = await ensureTag("Loop");
    const a = await mkAutomation({
      trigger: { type: "tag_added", config: { tagId: tag.id } },
      steps: [
        { id: "r", type: "remove_tag", tagId: tag.id },
        { id: "a", type: "add_tag", tagId: tag.id },
      ],
      allowReentry: true,
    });
    const c = await mkContact();
    await db.delete(jobs);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await addTagToContact(c.id, tag.id);
    await drain(500);
    const runs = await runsOf(a.id);
    expect(runs.length).toBe(MAX_ENROLLMENTS_PER_HOUR);
    expect(runs.every((r) => r.status === "completed")).toBe(true);
    const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.status, "pending"));
    expect(pending.n).toBe(0);
  });

  it("without re-entry the same self-trigger runs once", async () => {
    const tag = await ensureTag("Once");
    const a = await mkAutomation({
      trigger: { type: "tag_added", config: { tagId: tag.id } },
      steps: [
        { id: "r", type: "remove_tag", tagId: tag.id },
        { id: "a", type: "add_tag", tagId: tag.id },
      ],
    });
    const c = await mkContact();
    await db.delete(jobs);
    await addTagToContact(c.id, tag.id);
    await drain(100);
    expect(await runsOf(a.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("wait steps", () => {
  it("wait creates a future automation.step job with a dedupe key and parks the run", async () => {
    const tag = await ensureTag("After wait");
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [
        { id: "w", type: "wait", amount: 2, unit: "days" },
        { id: "t", type: "add_tag", tagId: tag.id },
      ],
    });
    const c = await mkContact();
    const before = Date.now();
    const res = await enrollContact(a, c.id, {}, { source: "manual" });
    if (!res.enrolled) throw new Error("not enrolled");
    await drain();
    const [run] = await runsOf(a.id);
    expect(run.status).toBe("waiting");
    expect(run.currentStep).toBe(1);
    expect(run.nextRunAt!.getTime()).toBeGreaterThanOrEqual(before + 2 * DAY - 1000);
    expect(run.nextRunAt!.getTime()).toBeLessThanOrEqual(Date.now() + 2 * DAY + 1000);
    const pending = await stepJobs(run.id, "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].dedupeKey).toBe(`automation:${run.id}:1`);
    expect(pending[0].runAt.getTime()).toBe(run.nextRunAt!.getTime());
    expect(await tagsOf(c.id)).not.toContain("After wait");

    // two days later the run continues
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 2 * DAY + 60_000));
    await drain();
    const [after] = await runsOf(a.id);
    expect(after.status).toBe("completed");
    expect(after.nextRunAt).toBeNull();
    expect(await tagsOf(c.id)).toContain("After wait");
    const logs = await logsOf(run.id);
    expect(logs.map((l) => l.stepType)).toEqual(expect.arrayContaining(["enrolled", "wait", "add_tag", "end"]));
  });

  it("supports minutes, hours and days and ignores a stale/duplicate job", async () => {
    const tag = await ensureTag("Duplicate guard");
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [
        { id: "w", type: "wait", amount: 90, unit: "minutes" },
        { id: "t", type: "add_tag", tagId: tag.id },
      ],
    });
    const c = await mkContact();
    await enrollContact(a, c.id, {}, { source: "manual" });
    await drain();
    const [run] = await runsOf(a.id);
    expect(run.nextRunAt!.getTime() - Date.now()).toBeGreaterThan(80 * 60_000);
    expect(run.nextRunAt!.getTime() - Date.now()).toBeLessThan(91 * 60_000);
    // A stale job for step 0 must not do anything
    await processRun(run.id, { stepIndex: 0 });
    expect((await runsOf(a.id))[0].currentStep).toBe(1);
    // Running the right job early (before it is due) via processRun with the right index would advance –
    // jobs are only run when due, so the tag is still missing here.
    await drain();
    expect(await tagsOf(c.id)).not.toContain("Duplicate guard");
  });

  it("wait_until_event in the future schedules at the anchor + offset", async () => {
    const e = await mkEvent({ startsInMs: 3 * DAY });
    const tpl = await mkTemplate("Reminder: {{event.title}}");
    const a = await mkAutomation({
      trigger: { type: "event_registered", config: { eventId: e.id } },
      steps: [
        { id: "w", type: "wait_until_event", anchor: "start", offsetMinutes: -24 * 60 },
        { id: "m", type: "send_email", templateId: tpl.id },
        { id: "w2", type: "wait_until_event", anchor: "end", offsetMinutes: 120 },
      ],
    });
    const c = await mkContact();
    await db.delete(jobs);
    await registerForEvent({ eventId: e.id, contactId: c.id, source: "manual" });
    await drain();
    const [run] = await runsOf(a.id);
    expect(run.status).toBe("waiting");
    expect(run.currentStep).toBe(1);
    const expected = e.startsAt.getTime() - DAY;
    expect(run.nextRunAt!.getTime()).toBe(expected);
    const [job] = await stepJobs(run.id, "pending");
    expect(job.runAt.getTime()).toBe(expected);
    expect(await emailsFor(c.id)).toHaveLength(0);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(expected + 60_000));
    await drain();
    const mails = await emailsFor(c.id);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("Reminder: Workshop");
    expect(mails[0].automationId).toBe(a.id);
    expect(mails[0].eventId).toBe(e.id);
    // now waiting for event end + 2h
    const [mid] = await runsOf(a.id);
    expect(mid.status).toBe("waiting");
    expect(mid.currentStep).toBe(3);
    expect(mid.nextRunAt!.getTime()).toBe(e.endsAt.getTime() + 120 * 60_000);
    vi.setSystemTime(new Date(e.endsAt.getTime() + 121 * 60_000));
    await drain();
    expect((await runsOf(a.id))[0].status).toBe("completed");
  });

  it("wait_until_event whose moment is already past continues immediately", async () => {
    const e = await mkEvent({ startsInMs: -3 * 3600e3 });
    const tag = await ensureTag("Past event");
    const a = await mkAutomation({
      trigger: { type: "event_registered", config: {} },
      steps: [
        { id: "w", type: "wait_until_event", anchor: "start", offsetMinutes: -60 },
        { id: "t", type: "add_tag", tagId: tag.id },
      ],
    });
    const c = await mkContact();
    await db.delete(jobs);
    await registerForEvent({ eventId: e.id, contactId: c.id, source: "manual" });
    await drain();
    const [run] = await runsOf(a.id);
    expect(run.status).toBe("completed");
    expect(await tagsOf(c.id)).toContain("Past event");
    expect((await logsOf(run.id)).find((l) => l.stepType === "wait_until_event")?.message).toMatch(/already passed/);
  });

  it("fails the run when wait_until_event has no event in its context", async () => {
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [{ id: "w", type: "wait_until_event", anchor: "start", offsetMinutes: 0 }],
    });
    const c = await mkContact();
    await enrollContact(a, c.id, {}, { source: "manual" });
    await drain();
    const [run] = await runsOf(a.id);
    expect(run.status).toBe("failed");
    expect(run.lastError).toMatch(/needs an event/);
  });

  it("exits instead of sending a reminder when the registration (or event) was cancelled while waiting", async () => {
    const e = await mkEvent({ startsInMs: 3 * DAY });
    const tpl = await mkTemplate();
    const a = await mkAutomation({
      trigger: { type: "event_registered", config: {} },
      steps: [
        { id: "w", type: "wait_until_event", anchor: "start", offsetMinutes: -60 },
        { id: "m", type: "send_email", templateId: tpl.id },
      ],
    });
    const c = await mkContact();
    await db.delete(jobs);
    const { attendee } = await registerForEvent({ eventId: e.id, contactId: c.id, source: "manual" });
    await drain();
    await cancelRegistration(attendee.id, { by: "staff", notify: false });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(e.startsAt.getTime()));
    await drain();
    const [run] = await runsOf(a.id);
    expect(run.status).toBe("exited");
    expect(await emailsFor(c.id)).toHaveLength(0);
    expect((await logsOf(run.id)).some((l) => l.status === "exited" && /cancelled/.test(l.message ?? ""))).toBe(true);
  });

  it("waits again when the event was moved later while the run was waiting", async () => {
    const e = await mkEvent({ startsInMs: 3 * DAY });
    const tpl = await mkTemplate();
    const a = await mkAutomation({
      trigger: { type: "event_registered", config: {} },
      steps: [
        { id: "w", type: "wait_until_event", anchor: "start", offsetMinutes: -60 },
        { id: "m", type: "send_email", templateId: tpl.id },
      ],
    });
    const c = await mkContact();
    await db.delete(jobs);
    await registerForEvent({ eventId: e.id, contactId: c.id, source: "manual" });
    await drain();
    const moved = new Date(e.startsAt.getTime() + 2 * DAY);
    await db.update(events).set({ startsAt: moved, endsAt: new Date(moved.getTime() + 3600e3) }).where(eq(events.id, e.id));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(e.startsAt.getTime() - 60 * 60_000 + 1000));
    await drain();
    let [run] = await runsOf(a.id);
    expect(run.status).toBe("waiting");
    expect(run.nextRunAt!.getTime()).toBe(moved.getTime() - 3600e3);
    expect(await emailsFor(c.id)).toHaveLength(0);
    vi.setSystemTime(new Date(moved.getTime()));
    await drain();
    [run] = await runsOf(a.id);
    expect(run.status).toBe("completed");
    expect(await emailsFor(c.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("condition steps", () => {
  it("exits the run when the contact does not match (later steps are not executed)", async () => {
    const tag = await ensureTag("Should not be added");
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [
        { id: "c", type: "condition", filter: { match: "all", filters: [{ field: "stage", operator: "is", value: "customer" }] } },
        { id: "t", type: "add_tag", tagId: tag.id },
      ],
    });
    const c = await mkContact({ stage: "new" });
    await enrollContact(a, c.id, {}, { source: "manual" });
    await drain();
    const [run] = await runsOf(a.id);
    expect(run.status).toBe("exited");
    expect(run.completedAt).toBeTruthy();
    expect(await tagsOf(c.id)).not.toContain("Should not be added");
    const logs = await logsOf(run.id);
    expect(logs.at(-1)).toMatchObject({ status: "exited", stepType: "condition" });
    expect(await stepJobs(run.id, "pending")).toHaveLength(0);
  });

  it("continues when the contact matches (tag has / lead status / any-match)", async () => {
    const vip = await ensureTag("VIP club");
    const done = await ensureTag("Matched");
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [
        {
          id: "c",
          type: "condition",
          filter: {
            match: "any",
            filters: [
              { field: "tag", operator: "has", value: vip.id },
              { field: "lead_status", operator: "is", value: "booked" },
            ],
          },
        },
        { id: "t", type: "add_tag", tagId: done.id },
      ],
    });
    const yes = await mkContact();
    await addTagToContact(yes.id, vip.id);
    const no = await mkContact();
    await enrollContact(a, yes.id, {}, { source: "manual" });
    await enrollContact(a, no.id, {}, { source: "manual" });
    await drain();
    expect(await tagsOf(yes.id)).toContain("Matched");
    expect(await tagsOf(no.id)).not.toContain("Matched");
    const runs = await runsOf(a.id);
    expect(runs.find((r) => r.contactId === yes.id)!.status).toBe("completed");
    expect(runs.find((r) => r.contactId === no.id)!.status).toBe("exited");
  });

  it("checks attendance statuses of the context attendee", async () => {
    const e = await mkEvent({ startsInMs: -2 * 3600e3 });
    const done = await ensureTag("Thanks sent");
    const a = await mkAutomation({
      trigger: { type: "event_registered", config: {} },
      steps: [
        { id: "w", type: "wait", amount: 1, unit: "hours" },
        { id: "c", type: "condition", filter: { match: "all", filters: [] }, attendance: ["attended"] },
        { id: "t", type: "add_tag", tagId: done.id },
      ],
    });
    const attended = await mkContact();
    const missed = await mkContact();
    await db.delete(jobs);
    const ra = await registerForEvent({ eventId: e.id, contactId: attended.id, source: "manual" });
    const rb = await registerForEvent({ eventId: e.id, contactId: missed.id, source: "manual" });
    await drain();
    await markAttendance(ra.attendee.id, "attended");
    await markAttendance(rb.attendee.id, "no_show");
    await db.delete(jobs).where(eq(jobs.type, "automation.trigger"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 2 * 3600e3));
    await drain();
    const runs = await runsOf(a.id);
    expect(runs.find((r) => r.contactId === attended.id)!.status).toBe("completed");
    const missedRun = runs.find((r) => r.contactId === missed.id)!;
    expect(missedRun.status).toBe("exited");
    expect(await tagsOf(attended.id)).toContain("Thanks sent");
    expect(await tagsOf(missed.id)).not.toContain("Thanks sent");
    expect((await logsOf(missedRun.id)).at(-1)?.message).toMatch(/no show/);
  });

  it("looks up the registration by event + contact when the context has no attendeeId", async () => {
    const e = await mkEvent({ startsInMs: -3600e3 });
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [{ id: "c", type: "condition", filter: { match: "all", filters: [] }, attendance: ["registered", "confirmed"] }],
    });
    const c = await mkContact();
    await db.delete(jobs);
    await registerForEvent({ eventId: e.id, contactId: c.id, source: "manual" });
    await enrollContact(a, c.id, { eventId: e.id }, { source: "manual" });
    await drain();
    expect((await runsOf(a.id))[0].status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------

describe("action steps", () => {
  it("send_email produces an automation message (simulated) with merge tags and the automation id", async () => {
    const tpl = await mkTemplate("Welcome, {{contact.first_name}}!", "Welcome");
    const a = await mkAutomation({ trigger: { type: "contact_created", config: {} }, steps: [{ id: "e", type: "send_email", templateId: tpl.id }] });
    const c = await mkContact({ firstName: "Grace" });
    await drain();
    const mails = await emailsFor(c.id);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ subject: "Welcome, Grace!", status: "simulated", automationId: a.id, templateId: tpl.id, kind: "automation" });
    const [run] = await runsOf(a.id);
    expect(run.status).toBe("completed");
    expect((await logsOf(run.id)).find((l) => l.stepType === "send_email")).toMatchObject({ status: "ok", stepIndex: 0 });
  });

  it("send_email is skipped (logged, run continues) for unsubscribed contacts and contacts without an email", async () => {
    const tpl = await mkTemplate();
    const tag = await ensureTag("After skipped email");
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [
        { id: "e", type: "send_email", templateId: tpl.id },
        { id: "t", type: "add_tag", tagId: tag.id },
      ],
    });
    const unsub = await mkContact();
    await db.update(contacts).set({ emailStatus: "unsubscribed" }).where(eq(contacts.id, unsub.id));
    const { contact: phoneOnly } = await upsertContact({ phone: "+61400111222", firstName: "Phone" }, { source: "manual" });
    await enrollContact(a, unsub.id, {}, { source: "manual" });
    await enrollContact(a, phoneOnly.id, {}, { source: "manual" });
    await drain();
    expect(await emailsFor(unsub.id)).toHaveLength(0);
    expect(await emailsFor(phoneOnly.id)).toHaveLength(0);
    const runs = await runsOf(a.id);
    expect(runs.every((r) => r.status === "completed")).toBe(true);
    expect((await logsOf(runs[0].id)).find((l) => l.stepType === "send_email")?.status).toBe("skipped");
    expect(await tagsOf(unsub.id)).toContain("After skipped email");
  });

  it("add_tag and remove_tag", async () => {
    const add = await ensureTag("Added by automation");
    const remove = await ensureTag("Removed by automation");
    const a = await mkAutomation({
      trigger: { type: "contact_created", config: {} },
      steps: [
        { id: "a", type: "add_tag", tagId: add.id },
        { id: "r", type: "remove_tag", tagId: remove.id },
      ],
    });
    const c = await mkContact();
    await db.delete(jobs);
    await addTagToContact(c.id, remove.id);
    await db.delete(jobs);
    await emitTrigger("contact_created", c.id);
    await drain();
    expect(await tagsOf(c.id)).toEqual(["Added by automation"]);
    expect((await runsOf(a.id))[0].status).toBe("completed");
    const timeline = await db.select().from(activities).where(eq(activities.contactId, c.id));
    expect(timeline.some((x) => x.type === "tag_added" && x.title.includes("Added by automation"))).toBe(true);
    expect(timeline.some((x) => x.type === "automation" && x.title.includes("Entered automation"))).toBe(true);
  });

  it("set_stage uses changeStage (timeline activity) and fails the run for unknown stages", async () => {
    const good = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "s", type: "set_stage", stage: "customer" }] });
    const bad = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "s", type: "set_stage", stage: "nope" }] });
    const c = await mkContact();
    await enrollContact(good, c.id, {}, { source: "manual" });
    await enrollContact(bad, c.id, {}, { source: "manual" });
    await drain();
    const [row] = await db.select().from(contacts).where(eq(contacts.id, c.id));
    expect(row.stage).toBe("customer");
    const [goodRun] = await runsOf(good.id);
    expect(goodRun.status).toBe("completed");
    const [badRun] = await runsOf(bad.id);
    expect(badRun.status).toBe("failed");
    expect(badRun.lastError).toMatch(/Unknown pipeline stage/);
    const acts = await db.select().from(activities).where(and(eq(activities.contactId, c.id), eq(activities.type, "stage_changed")));
    expect(acts).toHaveLength(1);
  });

  it("create_task assigns the contact owner by default and merges tags into the title", async () => {
    const owner = await createTestUser({ name: "Owner Olive" });
    const other = await createTestUser({ name: "Other Oscar" });
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [
        { id: "t1", type: "create_task", title: "Call {{contact.full_name}}", dueInDays: 2 },
        { id: "t2", type: "create_task", title: "Check in", dueInDays: 0, assigneeId: other.id },
      ],
    });
    const c = await mkContact({ firstName: "Linus", lastName: "Torvalds" });
    await db.update(contacts).set({ ownerId: owner.id }).where(eq(contacts.id, c.id));
    const before = Date.now();
    await enrollContact(a, c.id, {}, { source: "manual" });
    await drain();
    const rows = await db.select().from(tasks).where(eq(tasks.contactId, c.id)).orderBy(asc(tasks.createdAt));
    expect(rows.map((t) => t.title).sort()).toEqual(["Call Linus Torvalds", "Check in"]);
    const call = rows.find((t) => t.title.startsWith("Call"))!;
    expect(call.assigneeId).toBe(owner.id);
    expect(call.dueAt!.getTime()).toBeGreaterThanOrEqual(before + 2 * DAY - 1000);
    expect(rows.find((t) => t.title === "Check in")!.assigneeId).toBe(other.id);
    const bell = await db.select().from(notifications).where(eq(notifications.userId, owner.id));
    expect(bell.some((n) => n.title.startsWith("New task"))).toBe(true);
  });

  it("notify_team notifies the chosen users, or admins by default", async () => {
    const admin = await createTestUser({ role: "admin", name: "Admin Ann" });
    const member = await createTestUser({ role: "member", name: "Member Max" });
    const specific = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [{ id: "n", type: "notify_team", message: "{{contact.first_name}} is hot", userIds: [member.id] }],
    });
    const byDefault = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [{ id: "n", type: "notify_team", message: "Default alert" }],
    });
    const c = await mkContact({ firstName: "Hedy" });
    await enrollContact(specific, c.id, {}, { source: "manual" });
    await enrollContact(byDefault, c.id, {}, { source: "manual" });
    await drain();
    const memberBell = await db.select().from(notifications).where(eq(notifications.userId, member.id));
    expect(memberBell.map((n) => n.title)).toEqual(["Hedy is hot"]);
    expect(memberBell[0].href).toBe(`/contacts/${c.id}`);
    const adminBell = await db.select().from(notifications).where(eq(notifications.userId, admin.id));
    expect(adminBell.some((n) => n.title === "Default alert")).toBe(true);
    expect(memberBell.some((n) => n.title === "Default alert")).toBe(false);
  });

  it("webhook POSTs the contact + run details as JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const a = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "h", type: "webhook", url: "https://hooks.example.com/relay" }] });
    const c = await mkContact({ firstName: "Alan" });
    await enrollContact(a, c.id, { eventId: undefined }, { source: "manual" });
    await drain();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://hooks.example.com/relay");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ event: "automation.webhook", automation: { id: a.id }, contact: { id: c.id, firstName: "Alan" } });
    const [run] = await runsOf(a.id);
    expect(run.status).toBe("completed");
  });

  it("webhook: a 4xx response fails the run immediately; a 5xx is retried with backoff and fails after the last attempt", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const a = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "h", type: "webhook", url: "https://hooks.example.com/x" }] });
    const c = await mkContact();
    await enrollContact(a, c.id, {}, { source: "manual" });
    await drain();
    const [run] = await runsOf(a.id);
    expect(run.status).toBe("failed");
    expect(run.lastError).toBe("Webhook responded 404");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 5xx → retried
    const failing = vi.fn(async () => new Response("boom", { status: 503 }));
    vi.stubGlobal("fetch", failing);
    const b = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "h", type: "webhook", url: "https://hooks.example.com/y" }] });
    const c2 = await mkContact();
    await enrollContact(b, c2.id, {}, { source: "manual" });
    await drain();
    let [r2] = await runsOf(b.id);
    expect(r2.status).toBe("waiting"); // waiting for the retry
    expect(failing).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < STEP_RETRY_DELAYS_MS.length; i++) {
      vi.setSystemTime(new Date(Date.now() + STEP_RETRY_DELAYS_MS[i] + 1000));
      await drain();
    }
    [r2] = await runsOf(b.id);
    expect(failing).toHaveBeenCalledTimes(1 + STEP_RETRY_DELAYS_MS.length);
    expect(r2.status).toBe("failed");
    expect(r2.lastError).toBe("Webhook responded 503");
    expect((await logsOf(r2.id)).filter((l) => l.status === "error").length).toBe(STEP_RETRY_DELAYS_MS.length + 1);

    // recovers when the endpoint comes back during the retries
    const flaky = vi.fn().mockResolvedValueOnce(new Response("", { status: 502 })).mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", flaky);
    const d = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "h", type: "webhook", url: "https://hooks.example.com/z" }] });
    const c3 = await mkContact();
    await enrollContact(d, c3.id, {}, { source: "manual" });
    await drain();
    vi.setSystemTime(new Date(Date.now() + STEP_RETRY_DELAYS_MS[0] + 1000));
    await drain();
    expect((await runsOf(d.id))[0].status).toBe("completed");
  });

  it("webhook network errors are retried, invalid URLs fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));
    const a = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "h", type: "webhook", url: "https://down.example.com" }] });
    const bad = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "h", type: "webhook", url: "not a url" }] });
    const c = await mkContact();
    await enrollContact(a, c.id, {}, { source: "manual" });
    await enrollContact(bad, c.id, {}, { source: "manual" });
    await drain();
    expect((await runsOf(a.id))[0].status).toBe("waiting");
    expect((await runsOf(a.id))[0].lastError).toMatch(/ECONNREFUSED/);
    expect((await runsOf(bad.id))[0]).toMatchObject({ status: "failed", lastError: "Webhook URL is not valid" });
  });
});

// ---------------------------------------------------------------------------

describe("errors", () => {
  it("a step error marks the run failed, logs it, keeps earlier steps' effects and stops", async () => {
    const tag = await ensureTag("Before failure");
    const after = await ensureTag("After failure");
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [
        { id: "t1", type: "add_tag", tagId: tag.id },
        { id: "e", type: "send_email", templateId: "00000000-0000-4000-8000-000000000000" },
        { id: "t2", type: "add_tag", tagId: after.id },
      ],
    });
    const c = await mkContact();
    await enrollContact(a, c.id, {}, { source: "manual" });
    await drain();
    const [run] = await runsOf(a.id);
    expect(run.status).toBe("failed");
    expect(run.currentStep).toBe(1);
    expect(run.lastError).toMatch(/template not found/i);
    expect(run.completedAt).toBeTruthy();
    expect(await tagsOf(c.id)).toEqual(["Before failure"]);
    const logs = await logsOf(run.id);
    expect(logs.at(-1)).toMatchObject({ status: "error", stepIndex: 1, stepType: "send_email" });
    const [doneJobs] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.status, "failed"));
    expect(doneJobs.n).toBe(0); // the job itself succeeded; the run records the failure
  });

  it("add_tag with a deleted tag fails the run", async () => {
    const tag = await ensureTag("Soon deleted");
    const a = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "t", type: "add_tag", tagId: tag.id }] });
    await db.delete(tags).where(eq(tags.id, tag.id));
    const c = await mkContact();
    await enrollContact(a, c.id, {}, { source: "manual" });
    await drain();
    expect((await runsOf(a.id))[0]).toMatchObject({ status: "failed", lastError: "Tag not found – it may have been deleted" });
  });
});

// ---------------------------------------------------------------------------

describe("pausing, cancelling and deleting", () => {
  it("a paused automation does not advance its runs; resuming continues them", async () => {
    const tag = await ensureTag("After pause");
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [
        { id: "w", type: "wait", amount: 1, unit: "hours" },
        { id: "t", type: "add_tag", tagId: tag.id },
      ],
    });
    const c = await mkContact();
    await enrollContact(a, c.id, {}, { source: "manual" });
    await drain();
    await db.update(automations).set({ status: "paused" }).where(eq(automations.id, a.id));

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 2 * 3600e3));
    await drain();
    let [run] = await runsOf(a.id);
    expect(run.status).toBe("waiting");
    expect(run.currentStep).toBe(1);
    expect(await tagsOf(c.id)).not.toContain("After pause");
    // …but a re-check job exists about an hour later
    const pending = await stepJobs(run.id, "pending");
    expect(pending).toHaveLength(1);
    expect((pending[0].payload as { paused?: boolean }).paused).toBe(true);
    expect(pending[0].runAt.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);

    // still paused an hour later → keeps re-checking
    vi.setSystemTime(new Date(Date.now() + 61 * 60_000));
    await drain();
    expect(await tagsOf(c.id)).not.toContain("After pause");
    expect(await stepJobs(run.id, "pending")).toHaveLength(1);

    // resuming runs the parked step right away (without waiting for the hourly re-check)
    const res = await setAutomationStatus(a.id, "active");
    expect(res.ok).toBe(true);
    await drain();
    [run] = await runsOf(a.id);
    expect(run.status).toBe("completed");
    expect(await tagsOf(c.id)).toContain("After pause");
  });

  it("cancelling a run cancels its pending jobs", async () => {
    const a = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "w", type: "wait", amount: 3, unit: "days" }] });
    const c = await mkContact();
    await enrollContact(a, c.id, {}, { source: "manual" });
    await drain();
    const [run] = await runsOf(a.id);
    expect(await stepJobs(run.id, "pending")).toHaveLength(1);
    expect(await cancelRun(run.id)).toBe(true);
    expect(await stepJobs(run.id, "pending")).toHaveLength(0);
    expect(await stepJobs(run.id, "cancelled")).toHaveLength(1);
    const [after] = await runsOf(a.id);
    expect(after.status).toBe("cancelled");
    expect(after.nextRunAt).toBeNull();
    expect(await cancelRun(run.id)).toBe(false); // already finished
  });

  it("deleting an automation cancels pending step jobs and removes runs and logs; sent emails stay", async () => {
    const tpl = await mkTemplate();
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [
        { id: "e", type: "send_email", templateId: tpl.id },
        { id: "w", type: "wait", amount: 3, unit: "days" },
      ],
    });
    const [c1, c2] = [await mkContact(), await mkContact()];
    await enrollContact(a, c1.id, {}, { source: "manual" });
    await enrollContact(a, c2.id, {}, { source: "manual" });
    await drain();
    const runs = await runsOf(a.id);
    expect(runs).toHaveLength(2);
    const pendingIds = (await Promise.all(runs.map((r) => stepJobs(r.id, "pending")))).flat().map((j) => j.id);
    expect(pendingIds).toHaveLength(2);
    await deleteAutomation(a.id);
    expect(await db.select().from(automations).where(eq(automations.id, a.id))).toHaveLength(0);
    expect(await db.select().from(automationRuns).where(eq(automationRuns.automationId, a.id))).toHaveLength(0);
    expect(await db.select().from(automationLogs).where(eq(automationLogs.automationId, a.id))).toHaveLength(0);
    const left = await db.select().from(jobs).where(eq(jobs.type, "automation.step"));
    expect(left.filter((j) => j.status === "pending")).toHaveLength(0);
    expect(left.filter((j) => pendingIds.includes(j.id)).every((j) => j.status === "cancelled")).toBe(true);
    expect((await emailsFor(c1.id))[0].automationId).toBeNull(); // history kept, link cleared
  });

  it("cancelAutomationJobs only touches the given automation", async () => {
    const a = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "w", type: "wait", amount: 1, unit: "days" }] });
    const b = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "w", type: "wait", amount: 1, unit: "days" }] });
    const c = await mkContact();
    await enrollContact(a, c.id, {}, { source: "manual" });
    await enrollContact(b, c.id, {}, { source: "manual" });
    await drain();
    await cancelAutomationJobs(a.id);
    const [runA] = await runsOf(a.id);
    const [runB] = await runsOf(b.id);
    expect(await stepJobs(runA.id, "pending")).toHaveLength(0);
    expect(await stepJobs(runB.id, "pending")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("manual enrolment & stats", () => {
  it("enrolls picked contacts and smart-view members, reports skips, and only works for active automations", async () => {
    const [view] = await db
      .insert(schema.savedViews)
      .values({ name: "Customers", filters: { match: "all", filters: [{ field: "stage", operator: "is", value: "customer" }] } })
      .returning();
    const a = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "w", type: "wait", amount: 1, unit: "days" }] });
    const picked = await mkContact();
    const customer1 = await mkContact({ stage: "customer" });
    const customer2 = await mkContact({ stage: "customer" });
    const summary = await enrollContacts({ automationId: a.id, contactIds: [picked.id, customer1.id], viewId: view.id });
    expect(summary).toMatchObject({ total: 3, enrolled: 3, truncated: false });
    expect(summary.skipped).toEqual({});
    await drain();
    expect((await runsOf(a.id)).map((r) => r.contactId).sort()).toEqual([picked.id, customer1.id, customer2.id].sort());

    const again = await enrollContacts({ automationId: a.id, contactIds: [picked.id] });
    expect(again).toMatchObject({ total: 1, enrolled: 0, skipped: { already_active: 1 } });

    await db.update(automations).set({ status: "paused" }).where(eq(automations.id, a.id));
    await expect(enrollContacts({ automationId: a.id, contactIds: [picked.id] })).rejects.toThrow(/Activate/);
  });

  it("uses the chosen event as run context (attendee looked up per contact)", async () => {
    const e = await mkEvent({ startsInMs: 2 * DAY });
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [{ id: "w", type: "wait_until_event", anchor: "start", offsetMinutes: -60 }],
    });
    const c = await mkContact();
    await db.delete(jobs);
    const { attendee } = await registerForEvent({ eventId: e.id, contactId: c.id, source: "manual" });
    await enrollContacts({ automationId: a.id, contactIds: [c.id], eventId: e.id });
    await drain();
    const [run] = await runsOf(a.id);
    expect(run.context).toMatchObject({ eventId: e.id, attendeeId: attendee.id });
    expect(run.status).toBe("waiting");
    expect(run.nextRunAt!.getTime()).toBe(e.startsAt.getTime() - 3600e3);
  });

  it("computes stats per automation", async () => {
    const a = await mkAutomation({
      trigger: { type: "manual", config: {} },
      steps: [{ id: "c", type: "condition", filter: { match: "all", filters: [{ field: "stage", operator: "is", value: "customer" }] } }],
    });
    const w = await mkAutomation({ trigger: { type: "manual", config: {} }, steps: [{ id: "w", type: "wait", amount: 1, unit: "days" }] });
    const yes = await mkContact({ stage: "customer" });
    const no = await mkContact();
    await enrollContact(a, yes.id, {}, { source: "manual" });
    await enrollContact(a, no.id, {}, { source: "manual" });
    await enrollContact(w, yes.id, {}, { source: "manual" });
    await drain();
    const stats = await getAutomationStats([a.id, w.id]);
    expect(stats.get(a.id)).toEqual({ total: 2, active: 0, completed: 1, exited: 1, failed: 0, cancelled: 0 });
    expect(stats.get(w.id)).toEqual({ total: 1, active: 1, completed: 0, exited: 0, failed: 0, cancelled: 0 });
  });
});

// ---------------------------------------------------------------------------

describe("full recipe-like flow", () => {
  it("event reminder & follow-up: reminder 1 day before, thanks after the event for attendees only", async () => {
    const e = await mkEvent({ startsInMs: 3 * DAY });
    const reminder = await mkTemplate("Tomorrow: {{event.title}}", "Reminder");
    const thanks = await mkTemplate("Thanks for attending {{event.title}}", "Thanks");
    const a = await mkAutomation({
      trigger: { type: "event_registered", config: { eventId: e.id } },
      allowReentry: true,
      steps: [
        { id: "1", type: "wait_until_event", anchor: "start", offsetMinutes: -1440 },
        { id: "2", type: "send_email", templateId: reminder.id },
        { id: "3", type: "wait_until_event", anchor: "end", offsetMinutes: 120 },
        { id: "4", type: "condition", filter: { match: "all", filters: [] }, attendance: ["attended"] },
        { id: "5", type: "send_email", templateId: thanks.id },
      ],
    });
    const showed = await mkContact();
    const ghost = await mkContact();
    await db.delete(jobs);
    const r1 = await registerForEvent({ eventId: e.id, contactId: showed.id, source: "manual" });
    const r2 = await registerForEvent({ eventId: e.id, contactId: ghost.id, source: "manual" });
    await drain();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(e.startsAt.getTime() - DAY + 60_000));
    await drain();
    expect(await emailsFor(showed.id)).toHaveLength(1);
    expect(await emailsFor(ghost.id)).toHaveLength(1);
    await markAttendance(r1.attendee.id, "attended");
    await markAttendance(r2.attendee.id, "no_show");
    await db.delete(jobs).where(eq(jobs.type, "automation.trigger"));
    vi.setSystemTime(new Date(e.endsAt.getTime() + 121 * 60_000));
    await drain();
    expect((await emailsFor(showed.id)).map((m) => m.subject).sort()).toEqual(["Thanks for attending Workshop", "Tomorrow: Workshop"]);
    expect((await emailsFor(ghost.id)).map((m) => m.subject)).toEqual(["Tomorrow: Workshop"]);
    const runs = await runsOf(a.id);
    expect(runs.find((r) => r.contactId === showed.id)!.status).toBe("completed");
    expect(runs.find((r) => r.contactId === ghost.id)!.status).toBe("exited");
  });
});

// Sanity: the helper schema import is used (keeps lint quiet about unused vars in some editors)
void eventAttendees;
