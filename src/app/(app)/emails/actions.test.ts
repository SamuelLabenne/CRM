import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, createTestUser } from "@/test/setup-db";

// Server actions call requireUser(); swap in a fixed test user.
const auth = vi.hoisted(() => ({ user: null as unknown as { id: string; email: string; name: string } }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => auth.user,
  requireAdmin: async () => auth.user,
  getCurrentUser: async () => auth.user,
  isAdmin: () => true,
}));

const { db } = await setupTestDb();
auth.user = await createTestUser({ email: "owner@relay.test", name: "Owner" });

const { broadcasts, emailTemplates, jobs, messages } = await import("@/lib/db/schema");
const { upsertContact } = await import("@/lib/contacts");
const { processDueJobs } = await import("@/lib/jobs/runner");
const actions = await import("./actions");
const shared = await import("@/components/email/actions");
const { describeAudiences, previewAudience } = await import("@/lib/email/audience-summary");
const { getMessageDetail, listMessages } = await import("@/lib/email/outbox");

const audience = { type: "all" } as const;
const base = {
  name: "Launch",
  subject: "Hello {{contact.first_name | \"there\"}}",
  preheader: null,
  contentHtml: "<p>Hi!</p>",
  contentJson: null,
  audience,
};

describe("template actions", () => {
  it("validates, creates, updates, duplicates, resets and deletes", async () => {
    const bad = await actions.saveTemplateAction({ name: "  ", contentHtml: "" });
    expect(bad.ok).toBe(false);

    const created = await actions.saveTemplateAction({ name: "Promo", subject: "Sale", category: "marketing", contentHtml: "<p>x</p>", contentJson: null });
    expect(created.ok && created.data?.id).toBeTruthy();
    const id = created.ok ? created.data!.id : "";
    const updated = await actions.saveTemplateAction({ id, name: "Promo 2", subject: "Sale 2", category: "marketing", contentHtml: "<p>y</p>", contentJson: null });
    expect(updated.ok).toBe(true);
    expect((await db.select().from(emailTemplates).where(eq(emailTemplates.id, id)))[0].name).toBe("Promo 2");

    const dup = await actions.duplicateTemplateAction(id);
    expect(dup.ok).toBe(true);
    expect((await actions.deleteTemplateAction(dup.ok ? dup.data!.id : "")).ok).toBe(true);

    const [sys] = await db.select().from(emailTemplates).where(eq(emailTemplates.systemKey, "event_confirmation"));
    expect((await actions.deleteTemplateAction(sys.id)).ok).toBe(false);
    await actions.saveTemplateAction({ id: sys.id, name: sys.name, subject: "Edited", category: "notification", contentHtml: "<p>edited</p>", contentJson: null });
    const reset = await actions.resetTemplateAction(sys.id);
    expect(reset.ok && reset.data?.subject).toContain("You're registered");
    expect((await actions.resetTemplateAction(id)).ok).toBe(false);
    expect((await actions.deleteTemplateAction("not-an-id")).ok).toBe(false);
  });
});

describe("broadcast actions", () => {
  it("saves a draft, then sends it now", async () => {
    await upsertContact({ email: "a@actions.test", firstName: "Ada" }, { source: "manual" });
    const saved = await actions.saveBroadcastAction(base);
    expect(saved.ok).toBe(true);
    const id = saved.ok ? saved.data!.id : "";

    const sent = await actions.sendBroadcastAction({ broadcast: { ...base, id }, schedule: null });
    expect(sent.ok && sent.data?.status).toBe("sending");
    await processDueJobs();
    const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
    expect(b.status).toBe("sent");
    const msgs = await db.select().from(messages).where(eq(messages.broadcastId, id));
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.some((m) => m.subject === "Hello Ada")).toBe(true);

    // A sent broadcast can't be edited or sent again, but can be duplicated.
    expect((await actions.saveBroadcastAction({ ...base, id })).ok).toBe(false);
    expect((await actions.sendBroadcastAction({ broadcast: { ...base, id }, schedule: null })).ok).toBe(false);
    const copy = await actions.duplicateBroadcastAction(id);
    expect(copy.ok).toBe(true);
    expect((await actions.deleteBroadcastAction(copy.ok ? copy.data!.id : "")).ok).toBe(true);
    expect((await actions.deleteBroadcastAction(id)).ok).toBe(false);
  });

  it("schedules in the workspace timezone, rejects bad times, and cancels", async () => {
    const bad = await actions.sendBroadcastAction({ broadcast: base, schedule: "soon" });
    expect(bad.ok).toBe(false);
    const past = await actions.sendBroadcastAction({ broadcast: base, schedule: "2020-01-01T09:00" });
    expect(past.ok).toBe(false);

    const res = await actions.sendBroadcastAction({ broadcast: { ...base, name: "Scheduled one" }, schedule: "2099-06-01T09:30" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data!.status).toBe("scheduled");
    // Default workspace timezone is Australia/Perth (UTC+8): 09:30 local = 01:30Z.
    expect(res.data!.scheduledAt).toBe("2099-06-01T01:30:00.000Z");
    const pending = (await db.select().from(jobs)).filter((j) => j.dedupeKey?.startsWith(`broadcast:${res.data!.id}:`));
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("pending");

    expect((await actions.cancelBroadcastAction(res.data!.id)).ok).toBe(true);
    const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, res.data!.id));
    expect(b.status).toBe("cancelled");
    expect((await db.select().from(jobs).where(eq(jobs.id, pending[0].id)))[0].status).toBe("cancelled");
    expect((await actions.cancelBroadcastAction(res.data!.id)).ok).toBe(false);
  });

  it("refuses to send without an eligible audience", async () => {
    const res = await actions.sendBroadcastAction({ broadcast: { ...base, name: "Nobody", audience: { type: "contacts", contactIds: [] } }, schedule: null });
    expect(res.ok).toBe(false);
  });
});

describe("shared editor actions and queries", () => {
  it("sends a test email to the current user and previews contexts", async () => {
    const res = await shared.sendTestEmailAction({ subject: "Hi {{contact.first_name}}", html: "<p>Hello {{contact.first_name}}</p>", marketing: true });
    expect(res.ok && res.data?.to).toBe("owner@relay.test");
    const { rows } = await listMessages({ kind: "test", q: "owner@relay.test" });
    expect(rows.length).toBe(1);
    expect(rows[0].subject).toBe("[Test] Hi Ada"); // sample data
    const detail = await getMessageDetail(rows[0].id);
    expect(detail?.message.html).toContain("Unsubscribe");

    expect((await shared.sendTestEmailAction({ subject: "x", html: "  " })).ok).toBe(false);

    const { contact } = await upsertContact({ email: "grace@actions.test", firstName: "Grace" }, { source: "manual" });
    const ctx = await shared.previewContextAction(contact.id);
    expect(ctx.ok && (ctx.data!.contact as Record<string, string>).first_name).toBe("Grace");
    expect(ctx.ok && (ctx.data!.event as Record<string, string>).title).toBeTruthy(); // sample event values remain
    expect((await shared.previewContextAction("nope")).ok).toBe(false);
  });

  it("previews audiences and describes them", async () => {
    const p = await shared.previewAudienceAction({ type: "all" });
    expect(p.ok && p.data!.count).toBeGreaterThan(0);
    expect((await shared.previewAudienceAction({ type: "view", viewId: "bad" })).ok).toBe(false);
    const preview = await previewAudience({ type: "filter", filter: { match: "all", filters: [{ field: "first_name", operator: "is", value: "Grace" }] } });
    expect(preview.count).toBe(1);
    expect(preview.sample[0].name).toBe("Grace");
    const text = await describeAudiences([{ type: "all" }, { type: "contacts", contactIds: ["a", "b"] }, { type: "tags", tagIds: [], match: "any" }]);
    expect(text).toEqual(["All subscribed contacts", "2 selected contacts", "Tagged contacts"]);
    const found = await shared.lookupContactsAction([preview.sample[0].id]);
    expect(found[0].name).toBe("Grace");
  });

  it("filters the outbox", async () => {
    expect((await listMessages({ kind: "broadcast" })).rows.every((m) => m.kind === "broadcast")).toBe(true);
    expect((await listMessages({ status: "failed" })).total).toBe(0);
    expect((await listMessages({ q: "no-such-recipient" })).total).toBe(0);
    expect((await listMessages({ pageSize: 1, page: 2 })).rows).toHaveLength(1);
    expect(await getMessageDetail("not-a-uuid")).toBeNull();
  });
});
