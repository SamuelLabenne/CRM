import { desc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, customFieldDefs, emailTemplates, events, savedViews, tags } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import { formatDate } from "@/lib/format";
import type { AudienceOptions } from "@/components/email/audience-builder";

export type TemplateOption = {
  id: string;
  name: string;
  systemKey: string | null;
  subject: string;
  preheader: string;
  contentJson: Record<string, unknown> | null;
  contentHtml: string;
};

/** Everything the audience builder and template picker need, loaded once on the server. */
export async function getComposeOptions(userId: string): Promise<AudienceOptions & { templates: TemplateOption[] }> {
  const [workspace, stages] = await Promise.all([getSetting("workspace"), getSetting("stages")]);
  const [views, tagRows, eventRows, campaignRows, fields, templateRows] = await Promise.all([
    db
      .select({ id: savedViews.id, name: savedViews.name })
      .from(savedViews)
      .where(or(eq(savedViews.visibility, "shared"), eq(savedViews.ownerId, userId)))
      .orderBy(savedViews.name),
    db.select({ id: tags.id, name: tags.name, color: tags.color }).from(tags).orderBy(tags.name),
    db.select({ id: events.id, title: events.title, startsAt: events.startsAt }).from(events).orderBy(desc(events.startsAt)).limit(200),
    db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).orderBy(desc(campaigns.createdAt)),
    db.select({ key: customFieldDefs.key, label: customFieldDefs.label }).from(customFieldDefs).orderBy(customFieldDefs.position),
    db
      .select({
        id: emailTemplates.id,
        name: emailTemplates.name,
        systemKey: emailTemplates.systemKey,
        subject: emailTemplates.subject,
        preheader: emailTemplates.preheader,
        contentJson: emailTemplates.contentJson,
        contentHtml: emailTemplates.contentHtml,
      })
      .from(emailTemplates)
      .orderBy(emailTemplates.name),
  ]);
  return {
    views,
    tags: tagRows,
    events: eventRows.map((e) => ({ id: e.id, label: `${e.title} · ${formatDate(e.startsAt, workspace.timezone)}` })),
    campaigns: campaignRows,
    stages: stages.map((s) => ({ key: s.key, label: s.label })),
    customFields: fields,
    templates: templateRows.map((t) => ({ ...t, preheader: t.preheader ?? "" })),
  };
}
