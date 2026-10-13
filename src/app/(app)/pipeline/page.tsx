import Link from "next/link";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { Columns3, Users } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { PipelineBoard, type BoardColumn } from "@/components/contacts/pipeline-board";
import { PipelineFilters } from "@/components/contacts/pipeline-filters";
import { db } from "@/lib/db";
import { contacts, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getWorkspace } from "@/lib/settings";
import { formatMoney, fullName, timeAgo } from "@/lib/format";
import { loadReferenceData } from "@/lib/contacts/form-data";
import { contactQueryWhere } from "@/lib/contacts/query";

export const metadata = { title: "Pipeline" };

const CARD_LIMIT = 100;

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  await requireUser();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const q = get("q").trim();
  const owner = get("owner");
  const tag = get("tag");

  const [ref, workspace] = await Promise.all([loadReferenceData(), getWorkspace()]);
  const filterWhere = contactQueryWhere({ q, quick: { owner: owner || undefined, tag: tag || undefined } });

  const loadColumn = async (stageFilter: ReturnType<typeof eq>) => {
    const where = and(stageFilter, filterWhere);
    const [agg, cards] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${contacts.dealValue}), 0)::float8` })
        .from(contacts)
        .where(where),
      db
        .select({ c: contacts, ownerName: users.name, ownerColor: users.color })
        .from(contacts)
        .leftJoin(users, eq(users.id, contacts.ownerId))
        .where(where)
        .orderBy(sql`${contacts.lastActivityAt} desc nulls last`, desc(contacts.createdAt))
        .limit(CARD_LIMIT),
    ]);
    return {
      count: agg[0]?.n ?? 0,
      sum: agg[0]?.sum ?? 0,
      cards: cards.map(({ c, ownerName, ownerColor }) => ({
        id: c.id,
        name: fullName(c),
        company: c.company,
        dealValue: c.dealValue,
        lastActivity: c.lastActivityAt ? timeAgo(c.lastActivityAt) : "no activity",
        owner: ownerName ? { name: ownerName, color: ownerColor! } : null,
      })),
    };
  };

  const moreParams = (stage: string) => {
    const p = new URLSearchParams({ stage });
    if (q) p.set("q", q);
    if (owner) p.set("owner", owner);
    if (tag) p.set("tag", tag);
    return `/contacts?${p.toString()}`;
  };

  const stageKeys = ref.stages.map((s) => s.key);
  const [stageData, otherData] = await Promise.all([
    Promise.all(ref.stages.map((s) => loadColumn(eq(contacts.stage, s.key)))),
    stageKeys.length ? loadColumn(notInArray(contacts.stage, stageKeys) as ReturnType<typeof eq>) : Promise.resolve({ count: 0, sum: 0, cards: [] }),
  ]);

  const columns: BoardColumn[] = ref.stages.map((s, i) => ({
    key: s.key,
    label: s.label,
    color: s.color,
    category: s.category,
    ...stageData[i],
    moreHref: moreParams(s.key),
  }));
  if (otherData.count > 0) {
    columns.push({ key: "__other", label: "Other / unknown stage", color: "#94a3b8", category: "other", ...otherData, moreHref: "/contacts" });
  }

  const total = columns.reduce((n, c) => n + c.count, 0);
  const openValue = columns.filter((c) => c.category === "active").reduce((n, c) => n + c.sum, 0);
  const wonValue = columns.filter((c) => c.category === "won").reduce((n, c) => n + c.sum, 0);
  const filtered = Boolean(q || owner || tag);

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={`${total.toLocaleString("en-AU")} contact${total === 1 ? "" : "s"} · ${formatMoney(openValue, workspace.currency)} open${wonValue ? ` · ${formatMoney(wonValue, workspace.currency)} won` : ""}`}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/contacts">
              <Users /> List view
            </Link>
          </Button>
        }
      />
      <PageBody className="gap-4">
        <PipelineFilters q={q} owner={owner} tag={tag} users={ref.users} tags={ref.tags} />
        {ref.stages.length === 0 ? (
          <EmptyState icon={Columns3} title="No pipeline stages" description="Add stages in Settings → Pipeline to start tracking contacts." />
        ) : total === 0 && !filtered ? (
          <EmptyState
            icon={Users}
            title="No contacts in your pipeline yet"
            description="Add or import contacts and drag them between stages as deals progress."
            action={
              <Button asChild>
                <Link href="/contacts/new">New contact</Link>
              </Button>
            }
          />
        ) : (
          <PipelineBoard columns={columns} currency={workspace.currency} />
        )}
      </PageBody>
    </>
  );
}
