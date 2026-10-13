// Server-side render smoke test: every trigger type, step editor and the builder shell render
// without throwing (catches undefined icons, bad props, missing lookups…).
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }),
  redirect: () => {
    throw new Error("redirect");
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
// The server actions pull in the database; the render tests never call them.
vi.mock("@/app/(app)/automations/actions", () => ({
  saveAutomationAction: vi.fn(),
  setAutomationStatusAction: vi.fn(),
  deleteAutomationAction: vi.fn(),
  duplicateAutomationAction: vi.fn(),
  enrollContactsAction: vi.fn(),
  countViewContactsAction: vi.fn(),
  cancelRunAction: vi.fn(),
  retryRunAction: vi.fn(),
}));
vi.mock("@/app/(app)/actions", () => ({ searchContactsAction: vi.fn() }));

const { AutomationBuilder } = await import("./builder");
const { StepEditor } = await import("./step-editor");
const { TriggerCard } = await import("./trigger-card");
const { EnrollDialog } = await import("./enroll-dialog");
const { StatusToggle, AutomationCardMenu } = await import("./automation-card-controls");
const { RunActions } = await import("./run-actions");
const { DeleteAutomationButton } = await import("./delete-button");
const { FilterRows } = await import("./filter-rows");
const { STEP_TYPES, TRIGGER_TYPES, newStep } = await import("@/lib/automations/meta");
type BuilderLookups = import("@/lib/automations/meta").BuilderLookups;
type AutomationStep = import("@/lib/types").AutomationStep;

const lookups: BuilderLookups = {
  timezone: "Australia/Perth",
  tags: [{ id: "t1", name: "VIP", color: "#f00" }],
  stages: [{ key: "new", label: "New lead", color: "#999", category: "active" }],
  events: [{ id: "e1", title: "Spring Webinar", startsAt: new Date().toISOString(), kind: "event" }],
  campaigns: [{ id: "c1", name: "Autumn" }],
  bookingPages: [{ id: "p1", title: "Intro call" }],
  templates: [{ id: "tpl1", name: "Welcome", subject: "Hi", system: false }],
  users: [{ id: "u1", name: "Sam" }],
  customFields: [{ key: "plan", label: "Plan" }],
  views: [{ id: "v1", name: "Customers" }],
};

describe("automation UI render smoke tests", () => {
  it("renders the trigger card for every trigger type", () => {
    for (const type of TRIGGER_TYPES) {
      const html = renderToString(h(TriggerCard, { trigger: { type, config: {} }, onChange() {}, lookups }));
      expect(html).toContain("Trigger");
    }
  });

  it("renders a step editor for every step type (with and without issues)", () => {
    for (const type of STEP_TYPES) {
      for (const issues of [[], ["Something is missing"]]) {
        const html = renderToString(
          h(StepEditor, { step: newStep(type), onChange() {}, lookups, trigger: { type: "event_registered", config: {} }, issues }),
        );
        expect(html.length).toBeGreaterThan(50);
      }
    }
    // event steps on a trigger without an event show the warning
    const html = renderToString(
      h(StepEditor, { step: newStep("wait_until_event"), onChange() {}, lookups, trigger: { type: "contact_created", config: {} }, issues: [] }),
    );
    expect(html).toContain("has no event");
  });

  it("renders the builder with steps of every type", () => {
    const steps: AutomationStep[] = STEP_TYPES.map((t) => newStep(t));
    const html = renderToString(
      h(AutomationBuilder, {
        automation: {
          id: "00000000-0000-4000-8000-000000000000",
          name: "Everything",
          description: "All the steps",
          status: "draft",
          trigger: { type: "event_registered", config: { eventId: "e1" } },
          steps,
          allowReentry: true,
        },
        lookups,
        inFlightRuns: 2,
      }),
    );
    expect(html).toContain("Everything");
    expect(html).toContain("Drag to reorder step 1");
    expect(html).toContain("End of automation");
    expect(html).toContain("currently inside this automation");
    const empty = renderToString(
      h(AutomationBuilder, {
        automation: { id: "00000000-0000-4000-8000-000000000000", name: "", description: null, status: "draft", trigger: { type: "manual", config: {} }, steps: [], allowReentry: false },
        lookups,
        inFlightRuns: 0,
      }),
    );
    expect(empty).toContain("Add your first step");
  });

  it("renders the list controls, run actions, enrol dialog trigger and filter rows", () => {
    expect(renderToString(h(StatusToggle, { id: "a", name: "A", status: "active" }))).toContain("switch");
    expect(renderToString(h(AutomationCardMenu, { id: "a", name: "A", runs: 3 }))).toContain("Actions for A");
    for (const status of ["active", "waiting", "failed", "completed"] as const) {
      renderToString(h(RunActions, { runId: "r", status, contactName: "Ada" }));
    }
    expect(renderToString(h(DeleteAutomationButton, { id: "a", name: "A", runs: 0 }))).toContain("Delete");
    expect(
      renderToString(h(EnrollDialog, { automationId: "a", status: "active", views: lookups.views, events: lookups.events, timezone: "UTC", needsEvent: true })),
    ).toContain("Enroll contacts");
    expect(
      renderToString(
        h(FilterRows, {
          value: {
            match: "any",
            filters: [
              { field: "tag", operator: "has", value: "t1" },
              { field: "stage", operator: "is", value: "new" },
              { field: "lead_status", operator: "is", value: "potential" },
              { field: "custom:plan", operator: "contains", value: "pro" },
              { field: "company", operator: "is_empty" },
            ],
          },
          onChange() {},
          lookups,
        }),
      ),
    ).toContain("Add condition");
  });
});
