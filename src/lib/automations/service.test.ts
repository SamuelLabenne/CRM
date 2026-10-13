import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test/setup-db";

const { db } = await setupTestDb();
const schema = await import("@/lib/db/schema");
const { automations, automationLogs, automationRuns, emailTemplates, jobs, tags } = schema;
const { upsertContact, ensureTag } = await import("@/lib/contacts");
const { processDueJobs } = await import("@/lib/jobs/runner");
const { RECIPES, createAutomationFromRecipe, createBlankAutomation } = await import("./recipes");
const { validateAutomation } = await import("./meta");
const { enrollContact } = await import("./engine");
const {
  activationIssues,
  duplicateAutomation,
  listLogs,
  listRuns,
  retryRun,
  saveAutomation,
  setAutomationStatus,
} = await import("./service");
type AutomationStep = import("@/lib/types").AutomationStep;

beforeEach(async () => {
  await db.delete(jobs);
  await db.delete(automations);
  await db.delete(schema.contacts);
});

const base = { description: null, allowReentry: false, trigger: { type: "contact_created" as const, config: {} } };

describe("saveAutomation", () => {
  it("creates drafts with incomplete steps but refuses to activate them", async () => {
    const steps: AutomationStep[] = [{ id: "a", type: "send_email", templateId: "" }];
    const draft = await saveAutomation({ ...base, name: "Draft", status: "draft", steps });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.automation.status).toBe("draft");

    const activate = await saveAutomation({ ...base, id: draft.automation.id, name: "Draft", status: "active", steps });
    expect(activate.ok).toBe(false);
    if (activate.ok) return;
    expect(activate.error).toMatch(/Choose an email template/);
    expect(activate.issues[0]).toMatchObject({ field: "step", stepId: "a" });
    const [row] = await db.select().from(automations).where(eq(automations.id, draft.automation.id));
    expect(row.status).toBe("draft"); // nothing was changed
  });

  it("activates a valid automation and prunes trigger config that doesn't belong to the trigger type", async () => {
    const tag = await ensureTag("Prune");
    const res = await saveAutomation({
      ...base,
      name: "Ok",
      status: "active",
      trigger: { type: "tag_added", config: { tagId: tag.id, eventId: "stale", stage: "stale" } },
      steps: [{ id: "a", type: "add_tag", tagId: tag.id }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.automation.trigger).toEqual({ type: "tag_added", config: { tagId: tag.id } });
  });

  it("detects references to deleted templates, tags and stages", async () => {
    const [tpl] = await db.insert(emailTemplates).values({ name: "T", subject: "S", contentHtml: "<p>x</p>" }).returning();
    const tag = await ensureTag("Soon gone");
    const steps: AutomationStep[] = [
      { id: "a", type: "send_email", templateId: tpl.id },
      { id: "b", type: "add_tag", tagId: tag.id },
      { id: "c", type: "set_stage", stage: "customer" },
    ];
    expect(await activationIssues({ name: "x", trigger: base.trigger, steps })).toEqual([]);
    await db.delete(emailTemplates).where(eq(emailTemplates.id, tpl.id));
    await db.delete(tags).where(eq(tags.id, tag.id));
    const issues = await activationIssues({
      name: "x",
      trigger: base.trigger,
      steps: [...steps.slice(0, 2), { id: "c", type: "set_stage", stage: "no-such-stage" }],
    });
    expect(issues.map((i) => i.stepId).sort()).toEqual(["a", "b", "c"]);
  });

  it("de-duplicates step ids", async () => {
    const res = await saveAutomation({
      ...base,
      name: "Dupes",
      status: "draft",
      steps: [
        { id: "same", type: "wait", amount: 1, unit: "days" },
        { id: "same", type: "wait", amount: 2, unit: "days" },
      ],
    });
    expect(res.ok && new Set(res.automation.steps.map((s) => s.id)).size).toBe(2);
  });
});

describe("setAutomationStatus & duplicate", () => {
  it("validates before activating and allows pausing", async () => {
    const bad = await createBlankAutomation();
    const refused = await setAutomationStatus(bad.id, "active");
    expect(refused.ok).toBe(false);

    const recipe = await createAutomationFromRecipe("welcome-series");
    const active = await setAutomationStatus(recipe.id, "active");
    expect(active.ok && active.automation.status).toBe("active");
    const paused = await setAutomationStatus(recipe.id, "paused");
    expect(paused.ok && paused.automation.status).toBe("paused");
    expect((await setAutomationStatus("00000000-0000-4000-8000-000000000000", "active")).ok).toBe(false);
  });

  it("duplicates as a draft with fresh step ids", async () => {
    const recipe = await createAutomationFromRecipe("welcome-series");
    const copy = await duplicateAutomation(recipe.id);
    expect(copy).toMatchObject({ name: "Welcome series (copy)", status: "draft" });
    expect(copy!.steps).toHaveLength(recipe.steps.length);
    const original = new Set(recipe.steps.map((s) => s.id));
    expect(copy!.steps.every((s) => !original.has(s.id))).toBe(true);
    expect(copy!.steps.map((s) => s.type)).toEqual(recipe.steps.map((s) => s.type));
  });
});

describe("recipes", () => {
  it("every recipe creates a valid draft automation plus its email templates", async () => {
    for (const recipe of RECIPES) {
      const before = await db.select().from(emailTemplates);
      const automation = await createAutomationFromRecipe(recipe.id);
      expect(automation.status).toBe("draft");
      expect(automation.name).toBe(recipe.name);
      expect(automation.allowReentry).toBe(recipe.allowReentry);
      expect(automation.steps.length).toBeGreaterThan(0);
      expect(validateAutomation(automation)).toEqual([]);
      expect(await activationIssues(automation)).toEqual([]);
      const after = await db.select().from(emailTemplates);
      expect(after.length - before.length).toBe(recipe.templates.length);
      // every send_email step points at a template created for this recipe
      const created = after.filter((t) => !before.some((b) => b.id === t.id));
      expect(created.every((t) => t.category === "follow_up")).toBe(true);
      for (const s of automation.steps) if (s.type === "send_email") expect(created.some((t) => t.id === s.templateId)).toBe(true);
    }
  });

  it("matches the documented flows", async () => {
    const reminders = await createAutomationFromRecipe("event-reminders");
    expect(reminders.trigger.type).toBe("event_registered");
    expect(reminders.steps.map((s) => s.type)).toEqual(["wait_until_event", "send_email", "wait_until_event", "condition", "send_email"]);
    expect(reminders.steps[0]).toMatchObject({ anchor: "start", offsetMinutes: -1440 });
    expect(reminders.steps[2]).toMatchObject({ anchor: "end", offsetMinutes: 120 });
    expect(reminders.steps[3]).toMatchObject({ attendance: ["attended"] });

    const noShow = await createAutomationFromRecipe("no-show-recovery");
    expect(noShow.trigger.type).toBe("event_no_show");
    expect(noShow.steps.map((s) => s.type)).toEqual(["send_email", "wait", "create_task"]);
    expect(noShow.steps[1]).toMatchObject({ amount: 2, unit: "days" });

    const abandoned = await createAutomationFromRecipe("abandoned-registration");
    expect(abandoned.trigger.type).toBe("lead_potential");
    expect(abandoned.steps[0]).toMatchObject({ type: "wait", amount: 1, unit: "hours" });
    expect(abandoned.steps[1]).toMatchObject({ type: "condition", filter: { filters: [{ field: "lead_status", operator: "is", value: "potential" }] } });

    const meeting = await createAutomationFromRecipe("meeting-no-show");
    expect(meeting.trigger).toEqual({ type: "meeting_outcome", config: { outcome: "no_show" } });

    const hot = await createAutomationFromRecipe("hot-lead-alert");
    expect(hot.trigger.type).toBe("email_clicked");
    const tagStep = hot.steps.find((s) => s.type === "add_tag");
    const [hotTag] = await db.select().from(tags).where(eq(tags.name, "Hot lead"));
    expect(tagStep).toMatchObject({ tagId: hotTag.id });
    // creating it twice re-uses the tag
    await createAutomationFromRecipe("hot-lead-alert");
    expect(await db.select().from(tags).where(eq(tags.name, "Hot lead"))).toHaveLength(1);
  });

  it("rejects unknown recipes", async () => {
    await expect(createAutomationFromRecipe("nope")).rejects.toThrow(/Unknown recipe/);
  });

  it("an activated recipe actually runs: welcome series emails a new contact, then waits", async () => {
    const recipe = await createAutomationFromRecipe("welcome-series");
    await setAutomationStatus(recipe.id, "active");
    const { contact } = await upsertContact({ email: "welcome@example.com", firstName: "Wendy" }, { source: "manual" });
    await processDueJobs({ maxBatches: 10 });
    const msgs = await db.select().from(schema.messages).where(eq(schema.messages.contactId, contact.id));
    const automationMails = msgs.filter((m) => m.kind === "automation");
    expect(automationMails).toHaveLength(1);
    expect(automationMails[0].subject).toBe("Welcome to Relay, Wendy!");
    expect(automationMails[0].automationId).toBe(recipe.id);
    const [run] = await db.select().from(automationRuns).where(eq(automationRuns.automationId, recipe.id));
    expect(run.status).toBe("waiting");
    expect(run.currentStep).toBe(2);
  });
});

describe("runs & logs listing, retry", () => {
  it("lists runs with pagination/filters and logs; retry re-queues a failed run", async () => {
    const a = await createBlankAutomation();
    const [auto] = await db
      .update(automations)
      .set({ status: "active", trigger: { type: "manual", config: {} }, steps: [{ id: "x", type: "set_stage", stage: "customer" }] })
      .where(eq(automations.id, a.id))
      .returning();
    const contactsMade = [];
    for (let i = 0; i < 3; i++) contactsMade.push((await upsertContact({ email: `list${i}@example.com`, firstName: `L${i}` }, { source: "manual" })).contact);
    for (const c of contactsMade) await enrollContact(auto, c.id, {}, { source: "manual" });
    await processDueJobs({ maxBatches: 10 });
    expect((await listRuns(auto.id, { limit: 2, offset: 0 })).rows).toHaveLength(2);
    const all = await listRuns(auto.id, { limit: 10, offset: 0 });
    expect(all.total).toBe(3);
    expect((await listRuns(auto.id, { status: "completed", limit: 10, offset: 0 })).total).toBe(3);
    expect((await listRuns(auto.id, { status: "in_progress", limit: 10, offset: 0 })).total).toBe(0);
    const logs = await listLogs(auto.id, { limit: 100, offset: 0 });
    expect(logs.total).toBe(await db.$count(automationLogs, eq(automationLogs.automationId, auto.id)));
    expect(logs.rows[0].contact.id).toBeTruthy();

    // make the step fail, retry after fixing it
    await db.update(automations).set({ steps: [{ id: "x", type: "set_stage", stage: "nonexistent" }] }).where(eq(automations.id, auto.id));
    const extra = (await upsertContact({ email: "failme@example.com" }, { source: "manual" })).contact;
    await enrollContact(auto, extra.id, {}, { source: "manual" });
    await processDueJobs({ maxBatches: 10 });
    const [failed] = (await listRuns(auto.id, { status: "failed", limit: 10, offset: 0 })).rows;
    expect(failed.run.lastError).toMatch(/Unknown pipeline stage/);
    expect(await retryRun(all.rows[0].run.id)).toBe(false); // only failed runs
    await db.update(automations).set({ steps: [{ id: "x", type: "set_stage", stage: "customer" }] }).where(eq(automations.id, auto.id));
    expect(await retryRun(failed.run.id)).toBe(true);
    await processDueJobs({ maxBatches: 10 });
    const [after] = await db.select().from(automationRuns).where(eq(automationRuns.id, failed.run.id));
    expect(after.status).toBe("completed");
    expect(after.lastError).toBeNull();
  });
});
