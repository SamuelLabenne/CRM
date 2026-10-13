import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "@/test/setup-db";

const { db } = await setupTestDb();
const { automations, bookingPages, broadcasts, emailTemplates } = await import("@/lib/db/schema");
const { SYSTEM_TEMPLATES } = await import("./system-templates");
const {
  TemplateError,
  deleteTemplate,
  describeUsage,
  duplicateTemplate,
  getTemplateUsage,
  resetSystemTemplate,
  saveTemplate,
  systemTemplateInfo,
} = await import("./templates");
const { DEFAULT_EVENT_NOTIFICATIONS } = await import("@/lib/types");

async function systemTemplate(key: keyof typeof SYSTEM_TEMPLATES) {
  const [t] = await db.select().from(emailTemplates).where(eq(emailTemplates.systemKey, key));
  return t;
}

describe("templates", () => {
  it("creates, updates and duplicates custom templates", async () => {
    const t = await saveTemplate(
      { name: "Newsletter", subject: "News", preheader: " ", category: "marketing", contentHtml: "<p>Hi</p>", contentJson: { type: "doc" } },
      null,
    );
    expect(t.preheader).toBeNull();
    const updated = await saveTemplate({ id: t.id, name: "Newsletter v2", subject: "News 2", category: "follow_up", contentHtml: "<p>Hello</p>", contentJson: null }, null);
    expect(updated).toMatchObject({ name: "Newsletter v2", category: "follow_up", contentHtml: "<p>Hello</p>", contentJson: null });
    const copy = await duplicateTemplate(t.id, null);
    expect(copy.id).not.toBe(t.id);
    expect(copy.name).toBe("Newsletter v2 (copy)");
    expect(copy.systemKey).toBeNull();
    await deleteTemplate(copy.id);
    expect(await db.select().from(emailTemplates).where(eq(emailTemplates.id, copy.id))).toHaveLength(0);
  });

  it("lets system templates be edited but not renamed, deleted or turned into another category", async () => {
    const sys = await systemTemplate("event_confirmation");
    const edited = await saveTemplate(
      { id: sys.id, name: "Hacked name", subject: "Custom subject", category: "marketing", contentHtml: "<p>Custom</p>", contentJson: null },
      null,
    );
    expect(edited.name).toBe(sys.name);
    expect(edited.category).toBe(sys.category);
    expect(edited.subject).toBe("Custom subject");
    expect(edited.systemKey).toBe("event_confirmation");
    await expect(deleteTemplate(sys.id)).rejects.toBeInstanceOf(TemplateError);
    // Duplicates of system templates are plain custom templates.
    const copy = await duplicateTemplate(sys.id, null);
    expect(copy.systemKey).toBeNull();
    expect(copy.category).toBe("other");
  });

  it("resets a system template to its default and refuses custom templates", async () => {
    const sys = await systemTemplate("event_reminder");
    await saveTemplate({ id: sys.id, name: sys.name, subject: "Changed", preheader: "pre", category: "notification", contentHtml: "<p>Changed</p>", contentJson: { type: "doc" } }, null);
    const reset = await resetSystemTemplate(sys.id);
    expect(reset.subject).toBe(SYSTEM_TEMPLATES.event_reminder.subject);
    expect(reset.preheader).toBe(SYSTEM_TEMPLATES.event_reminder.preheader ?? null);
    expect(reset.contentHtml).toBe(SYSTEM_TEMPLATES.event_reminder.html);
    expect(reset.contentJson).toBeNull();
    expect(reset.systemKey).toBe("event_reminder");

    const custom = await saveTemplate({ name: "Mine", subject: "", category: "marketing", contentHtml: "", contentJson: null }, null);
    await expect(resetSystemTemplate(custom.id)).rejects.toBeInstanceOf(TemplateError);
    await expect(resetSystemTemplate("00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(TemplateError);
  });

  it("knows what each built-in template is for", () => {
    expect(systemTemplateInfo("event_confirmation")).toMatch(/registers/i);
    expect(systemTemplateInfo(null)).toBeNull();
    expect(systemTemplateInfo("nope")).toBeNull();
  });

  it("reports template usage across broadcasts, automations, events and booking pages", async () => {
    const t = await saveTemplate({ name: "Used", subject: "x", category: "marketing", contentHtml: "<p>x</p>", contentJson: null }, null);
    await db.insert(broadcasts).values({ name: "B", subject: "s", templateId: t.id });
    await db.insert(automations).values({
      name: "A",
      trigger: { type: "contact_created", config: {} },
      steps: [
        { id: "s1", type: "send_email", templateId: t.id },
        { id: "s2", type: "send_email", templateId: t.id },
      ],
    });
    await db.insert(bookingPages).values({
      slug: "intro",
      title: "Intro",
      notifications: { ...DEFAULT_EVENT_NOTIFICATIONS, confirmation: { enabled: true, templateId: t.id } },
    });
    const usage = await getTemplateUsage();
    expect(usage.get(t.id)).toEqual({ broadcasts: 1, automations: 1, events: 0, bookingPages: 1 });
    expect(describeUsage(usage.get(t.id))).toBe("1 automation · 1 booking page · 1 broadcast");
    expect(describeUsage(undefined)).toBeNull();
  });
});
