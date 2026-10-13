import Link from "next/link";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { Send } from "lucide-react";
import { db } from "@/lib/db";
import { broadcasts } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import { formatDateTime, formatNumber, formatPercent, timeAgo } from "@/lib/format";
import { describeAudiences } from "@/lib/email/audience-summary";
import { getBroadcastListMetrics, rate } from "@/lib/email/broadcasts";
import type { BroadcastStatus } from "@/lib/types";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/app/empty-state";
import { BROADCAST_STATUS, MappedStatus } from "@/components/app/status-badge";
import { Pager } from "@/components/email/pager";
import { UrlFilters } from "@/components/email/url-filters";
import { BroadcastActions } from "./broadcast-actions";

const PAGE_SIZE = 25;
const STATUSES: BroadcastStatus[] = ["draft", "scheduled", "sending", "sent", "cancelled", "failed"];

export async function BroadcastsTab({ q, status, page }: { q?: string; status?: string; page: number }) {
  const { timezone } = await getSetting("workspace");
  const statusFilter = STATUSES.includes(status as BroadcastStatus) ? (status as BroadcastStatus) : undefined;
  const term = q?.trim();
  const where = and(
    statusFilter ? eq(broadcasts.status, statusFilter) : undefined,
    term ? ilike(broadcasts.name, `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`) : undefined,
  );

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(broadcasts).where(where);
  const [{ all }] = await db.select({ all: sql<number>`count(*)::int` }).from(broadcasts);
  const rows = await db
    .select()
    .from(broadcasts)
    .where(where)
    .orderBy(desc(broadcasts.updatedAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const [metrics, audiences] = await Promise.all([
    getBroadcastListMetrics(rows.map((r) => r.id)),
    describeAudiences(rows.map((r) => r.audience)),
  ]);

  if (all === 0) {
    return (
      <EmptyState
        icon={Send}
        title="Send your first broadcast"
        description="Email a segment of your contacts: announce an event, share news or follow up with attendees. Track opens and clicks as they come in."
        action={
          <Link href="/emails/broadcasts/new" className={buttonVariants()}>
            <Send /> New broadcast
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-4">
      <UrlFilters
        fields={[
          { type: "search", name: "q", placeholder: "Search broadcasts…" },
          { type: "select", name: "status", label: "All statuses", options: STATUSES.map((s) => ({ value: s, label: BROADCAST_STATUS[s].label })) },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState icon={Send} title="No broadcasts match" description="Try a different search or clear the filters." />
      ) : (
        <Card className="gap-0 p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Broadcast</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Audience</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="text-right">Recipients</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Opens</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Clicks</TableHead>
                <TableHead className="w-10 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b, i) => {
                const m = metrics.get(b.id);
                const delivered = m?.delivered ?? 0;
                const when =
                  b.status === "scheduled" && b.scheduledAt
                    ? { label: "Scheduled", value: formatDateTime(b.scheduledAt, timezone) }
                    : b.sentAt
                      ? { label: "Sent", value: formatDateTime(b.sentAt, timezone) }
                      : { label: "Edited", value: timeAgo(b.updatedAt) };
                return (
                  <TableRow key={b.id}>
                    <TableCell className="max-w-72 pl-4">
                      <Link href={`/emails/broadcasts/${b.id}`} className="block truncate font-medium hover:underline">
                        {b.name}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">{b.subject || "No subject yet"}</div>
                    </TableCell>
                    <TableCell>
                      <MappedStatus map={BROADCAST_STATUS} value={b.status} />
                    </TableCell>
                    <TableCell className="hidden max-w-56 truncate text-muted-foreground lg:table-cell">{audiences[i]}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="text-xs">{when.label}</div>
                      <div className="whitespace-nowrap">{when.value}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.status === "sent" || b.status === "sending" ? formatNumber(m?.total ?? b.recipientCount) : "—"}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{delivered ? formatPercent(rate(m?.opened ?? 0, delivered)) : "—"}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{delivered ? formatPercent(rate(m?.clicked ?? 0, delivered)) : "—"}</TableCell>
                    <TableCell className="pr-4">
                      <BroadcastActions id={b.id} name={b.name} status={b.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pager basePath="/emails" params={{ q: term, status: statusFilter }} page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  );
}
