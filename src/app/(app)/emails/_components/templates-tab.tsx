import Link from "next/link";
import { and, asc, desc, eq, ilike, isNotNull, isNull, or } from "drizzle-orm";
import { FileText, Lock } from "lucide-react";
import { db } from "@/lib/db";
import { emailTemplates, type EmailTemplate } from "@/lib/db/schema";
import { timeAgo } from "@/lib/format";
import { TEMPLATE_CATEGORIES } from "@/lib/email/schemas";
import { describeUsage, getTemplateUsage, systemTemplateInfo } from "@/lib/email/templates";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge, type Tone } from "@/components/app/status-badge";
import { UrlFilters } from "@/components/email/url-filters";
import { TemplateActions } from "./template-actions";

export const CATEGORY_LABEL: Record<EmailTemplate["category"], { label: string; tone: Tone }> = {
  marketing: { label: "Marketing", tone: "violet" },
  notification: { label: "Notification", tone: "blue" },
  follow_up: { label: "Follow-up", tone: "amber" },
  other: { label: "Other", tone: "neutral" },
};

export async function TemplatesTab({ q, category }: { q?: string; category?: string }) {
  const term = q?.trim();
  const cat = TEMPLATE_CATEGORIES.find((c) => c === category);
  const like = term ? `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const base = and(
    cat ? eq(emailTemplates.category, cat) : undefined,
    like ? or(ilike(emailTemplates.name, like), ilike(emailTemplates.subject, like)) : undefined,
  );
  const [custom, system, usage, anyCustom] = await Promise.all([
    db.select().from(emailTemplates).where(and(base, isNull(emailTemplates.systemKey))).orderBy(desc(emailTemplates.updatedAt)),
    db.select().from(emailTemplates).where(and(base, isNotNull(emailTemplates.systemKey))).orderBy(asc(emailTemplates.name)),
    getTemplateUsage(),
    db.select({ id: emailTemplates.id }).from(emailTemplates).where(isNull(emailTemplates.systemKey)).limit(1),
  ]);
  const hasAnyCustom = anyCustom.length > 0;

  return (
    <div className="grid gap-6">
      <UrlFilters
        fields={[
          { type: "search", name: "q", placeholder: "Search templates…" },
          { type: "select", name: "category", label: "All categories", options: TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c].label })) },
        ]}
      />

      <section className="grid gap-3">
        <div>
          <h2 className="text-sm font-semibold">Your templates</h2>
          <p className="text-sm text-muted-foreground">Reusable layouts for broadcasts and automations.</p>
        </div>
        {custom.length === 0 ? (
          hasAnyCustom || term || cat ? (
            <EmptyState icon={FileText} title="No templates match" description="Try a different search or clear the filters." />
          ) : (
            <EmptyState
              icon={FileText}
              title="Create your first template"
              description="Save a design once, then reuse it in broadcasts, automations and event emails."
              action={
                <Link href="/emails/templates/new" className={buttonVariants()}>
                  New template
                </Link>
              }
            />
          )
        ) : (
          <TemplateTable rows={custom} usage={usage} />
        )}
      </section>

      {system.length > 0 && (
        <section className="grid gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Lock className="size-3.5 text-muted-foreground" /> Built-in emails
            </h2>
            <p className="text-sm text-muted-foreground">
              Sent automatically for event registrations and meetings. Edit the wording any time, or reset one to its default.
            </p>
          </div>
          <TemplateTable rows={system} usage={usage} />
        </section>
      )}
    </div>
  );
}

function TemplateTable({ rows, usage }: { rows: EmailTemplate[]; usage: Awaited<ReturnType<typeof getTemplateUsage>> }) {
  return (
    <Card className="gap-0 p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Template</TableHead>
            <TableHead className="hidden sm:table-cell">Category</TableHead>
            <TableHead className="hidden md:table-cell">Used by</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Updated</TableHead>
            <TableHead className="w-10 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => {
            const u = describeUsage(usage.get(t.id));
            const info = systemTemplateInfo(t.systemKey);
            return (
              <TableRow key={t.id}>
                <TableCell className="max-w-80 pl-4">
                  <Link href={`/emails/templates/${t.id}`} className="block truncate font-medium hover:underline">
                    {t.name}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground">{t.subject || "No subject"}</div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <StatusBadge tone={CATEGORY_LABEL[t.category].tone}>{CATEGORY_LABEL[t.category].label}</StatusBadge>
                </TableCell>
                <TableCell className="hidden max-w-64 text-muted-foreground md:table-cell">
                  <div className="truncate">{info ?? u ?? "Not used yet"}</div>
                  {info && u && <div className="truncate text-xs">Custom use: {u}</div>}
                </TableCell>
                <TableCell className="hidden text-right whitespace-nowrap text-muted-foreground sm:table-cell">{timeAgo(t.updatedAt)}</TableCell>
                <TableCell className="pr-4">
                  <TemplateActions id={t.id} name={t.name} isSystem={Boolean(t.systemKey)} usage={u} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
