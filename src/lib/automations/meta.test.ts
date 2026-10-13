import { describe, expect, it } from "vitest";
import {
  TRIGGER_META,
  TRIGGER_TYPES,
  STEP_META,
  STEP_TYPES,
  describeStep,
  describeTrigger,
  newStep,
  pruneTriggerConfig,
  splitMinutes,
  validateAutomation,
} from "./meta";
import { automationInputSchema } from "./schema";
import type { AutomationStep, AutomationTrigger } from "@/lib/types";

describe("trigger summaries", () => {
  it("describes triggers in plain English", () => {
    expect(describeTrigger({ type: "event_registered", config: {} })).toBe("When a contact registers for any event");
    expect(describeTrigger({ type: "event_registered", config: { eventId: "e1" } }, { events: { e1: "Spring Webinar" } })).toBe(
      "When a contact registers for “Spring Webinar”",
    );
    expect(describeTrigger({ type: "event_attended", config: { campaignId: "c1" } }, { campaigns: { c1: "Autumn" } })).toBe(
      "When a contact attends any event in “Autumn”",
    );
    expect(describeTrigger({ type: "tag_added", config: {} })).toBe("When any tag is added to a contact");
    expect(describeTrigger({ type: "tag_added", config: { tagId: "t" } }, { tags: { t: "VIP" } })).toBe("When a contact is tagged “VIP”");
    expect(describeTrigger({ type: "stage_changed", config: { stage: "customer" } }, { stages: { customer: "Customer" } })).toBe(
      "When a contact moves to “Customer”",
    );
    expect(describeTrigger({ type: "meeting_outcome", config: { outcome: "no_show", bookingPageId: "p" } }, { bookingPages: { p: "Intro call" } })).toBe(
      "When a meeting outcome is logged as “No-show” on “Intro call”",
    );
    expect(describeTrigger({ type: "manual", config: {} })).toBe("When contacts are enrolled manually");
  });

  it("has metadata for every trigger and step type", () => {
    for (const t of TRIGGER_TYPES) {
      expect(TRIGGER_META[t].label).toBeTruthy();
      expect(describeTrigger({ type: t, config: {} })).toMatch(/^When /);
    }
    for (const s of STEP_TYPES) {
      expect(STEP_META[s].label).toBeTruthy();
      expect(describeStep(newStep(s))).toBeTruthy();
    }
  });

  it("prunes config keys that don't belong to the trigger type", () => {
    expect(pruneTriggerConfig("tag_added", { tagId: "t", eventId: "e", stage: "x" })).toEqual({ tagId: "t" });
    expect(pruneTriggerConfig("contact_created", { tagId: "t" })).toEqual({});
    expect(pruneTriggerConfig("meeting_outcome", { outcome: "won", bookingPageId: "", campaignId: "c" })).toEqual({ outcome: "won", campaignId: "c" });
  });
});

describe("step summaries", () => {
  it("describes waits and event waits", () => {
    expect(describeStep({ id: "1", type: "wait", amount: 2, unit: "days" })).toBe("Wait 2 days");
    expect(describeStep({ id: "1", type: "wait", amount: 1, unit: "hours" })).toBe("Wait 1 hour");
    expect(describeStep({ id: "1", type: "wait_until_event", anchor: "start", offsetMinutes: -1440 })).toBe("Wait until 1 day before the event starts");
    expect(describeStep({ id: "1", type: "wait_until_event", anchor: "end", offsetMinutes: 120 })).toBe("Wait until 2 hours after the event ends");
    expect(describeStep({ id: "1", type: "wait_until_event", anchor: "start", offsetMinutes: 0 })).toBe("Wait until the event starts");
  });

  it("describes conditions", () => {
    expect(
      describeStep(
        { id: "1", type: "condition", filter: { match: "all", filters: [{ field: "lead_status", operator: "is", value: "potential" }] } },
        {},
      ),
    ).toBe("Continue only if Lead status is “Potential”");
    expect(describeStep({ id: "1", type: "condition", filter: { match: "all", filters: [] }, attendance: ["attended"] })).toBe(
      "Continue only if attendance is attended",
    );
  });

  it("splits minutes into the largest even unit", () => {
    expect(splitMinutes(1440)).toEqual({ amount: 1, unit: "days" });
    expect(splitMinutes(-120)).toEqual({ amount: 2, unit: "hours" });
    expect(splitMinutes(90)).toEqual({ amount: 90, unit: "minutes" });
  });
});

describe("validateAutomation", () => {
  const trigger: AutomationTrigger = { type: "contact_created", config: {} };
  const valid: AutomationStep[] = [{ id: "a", type: "wait", amount: 1, unit: "days" }];

  it("accepts a complete automation", () => {
    expect(validateAutomation({ name: "Welcome", trigger, steps: valid })).toEqual([]);
  });

  it("requires a name and at least one step", () => {
    const issues = validateAutomation({ name: "  ", trigger, steps: [] });
    expect(issues.map((i) => i.field)).toEqual(["name", "steps"]);
  });

  it("flags incomplete steps, e.g. send_email without a template", () => {
    const steps: AutomationStep[] = [
      { id: "mail", type: "send_email", templateId: "" },
      { id: "tag", type: "add_tag", tagId: "" },
      { id: "stage", type: "set_stage", stage: "" },
      { id: "hook", type: "webhook", url: "ftp://nope" },
      { id: "task", type: "create_task", title: " ", dueInDays: 1 },
      { id: "note", type: "notify_team", message: "" },
      { id: "wait", type: "wait", amount: 0, unit: "days" },
      { id: "cond", type: "condition", filter: { match: "all", filters: [] } },
    ];
    const issues = validateAutomation({ name: "x", trigger, steps });
    const byStep = new Map(issues.filter((i) => i.stepId).map((i) => [i.stepId, i.message]));
    expect([...byStep.keys()].sort()).toEqual(["cond", "hook", "mail", "note", "stage", "tag", "task", "wait"]);
    expect(byStep.get("mail")).toMatch(/template/);
  });

  it("requires every condition row to be complete", () => {
    const incomplete: AutomationStep = {
      id: "c",
      type: "condition",
      filter: { match: "all", filters: [{ field: "stage", operator: "is", value: null }] },
    };
    expect(validateAutomation({ name: "x", trigger, steps: [incomplete] }).map((i) => i.stepId)).toEqual(["c"]);
    const complete: AutomationStep = {
      id: "c",
      type: "condition",
      filter: { match: "all", filters: [{ field: "company", operator: "is_not_empty" }] },
    };
    expect(validateAutomation({ name: "x", trigger, steps: [complete] })).toEqual([]);
  });

  it("rejects event-dependent steps on triggers without an event, but allows event/meeting/manual triggers", () => {
    const wait: AutomationStep = { id: "w", type: "wait_until_event", anchor: "start", offsetMinutes: -60 };
    const attendance: AutomationStep = { id: "c", type: "condition", filter: { match: "all", filters: [] }, attendance: ["attended"] };
    expect(validateAutomation({ name: "x", trigger, steps: [wait, attendance] }).map((i) => i.stepId)).toEqual(["w", "c"]);
    for (const type of ["event_registered", "meeting_booked", "meeting_outcome", "manual", "lead_potential"] as const) {
      expect(validateAutomation({ name: "x", trigger: { type, config: {} }, steps: [wait, attendance] })).toEqual([]);
    }
  });
});

describe("save schema", () => {
  const base = { name: "  Test  ", status: "draft", allowReentry: false, trigger: { type: "event_registered", config: { eventId: "" } }, steps: [] };

  it("is lenient for drafts and normalises empty config values", () => {
    const parsed = automationInputSchema.parse({
      ...base,
      steps: [
        { id: "a", type: "send_email", templateId: "" },
        { id: "b", type: "webhook", url: "" },
      ],
    });
    expect(parsed.name).toBe("Test");
    expect(parsed.trigger.config.eventId).toBeNull();
    expect(parsed.steps).toHaveLength(2);
  });

  it("rejects unknown step types, bad numbers and non-http webhook URLs", () => {
    expect(automationInputSchema.safeParse({ ...base, steps: [{ id: "a", type: "explode" }] }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...base, steps: [{ id: "a", type: "wait", amount: -1, unit: "days" }] }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...base, steps: [{ id: "a", type: "wait", amount: 1, unit: "weeks" }] }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...base, steps: [{ id: "a", type: "webhook", url: "javascript:alert(1)" }] }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...base, name: " " }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...base, trigger: { type: "nope", config: {} } }).success).toBe(false);
  });
});
