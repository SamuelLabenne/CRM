import Link from "next/link";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Automation } from "@/lib/db/schema";
import { describeStep, type NameLookups } from "@/lib/automations/meta";
import { listRuns } from "@/lib/automations/service";
import { formatDateTime, fullName, timeAgo } from "@/lib/format";
import { FilterPills, ListPagination, RunStatusBadge } from "./status";
import { RunActions } from "./run-actions";

const PAGE_SIZE = 25;
const FILTERS = [
  { key: "all", label: "All" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "exited", label: "Exited" },
  { key: "failed", label: "Failed" },
  { key: "cancelled", label: "Cancelled" },
];

export async function RunsTab({
  automation,
  searchParams,
  timezone,
  names,
}: {
  automation: Automation;
  searchParams: Record<string, string | string[] | undefined>;
  timezone: string;
  names: NameLookups;
}) {
  const filter = FILTERS.find((f) => f.key === searchParams.status)?.key ?? "all";
  const page = Math.max(1, Number.parseInt(String(searchParams.page ?? "1"), 10) || 1);
  const { rows, total } = await listRuns(automation.id, {
    status: filter === "all" ? undefined : filter,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const base = `/automations/${automation.id}?tab=runs`;
  const hrefFor = (p: number) => `${base}${filter === "all" ? "" : `&status=${filter}`}&page=${p}`;

  return (
    <div className="grid gap-4">
      {automation.status !== "active" && (
        <Alert>
          <Info />
          <AlertDescription>
            This automation is {automation.status}. Contacts already inside it wait here and carry on once it&apos;s active again.
          </AlertDescription>
        </Alert>
      )}
      <FilterPills
        active={filter}
        items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: f.key === "all" ? base : `${base}&status=${f.key}` }))}
      />
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Current step</TableHead>
              <TableHead>Next run</TableHead>
              <TableHead>Started</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No runs match this filter.
                </TableCell>
              </TableRow>
            )}
            {rows.map(({ run, contact }) => {
              const name = fullName(contact);
              const step = automation.steps[run.currentStep];
              const finished = run.status === "completed" || run.status === "exited" || run.status === "cancelled";
              return (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link href={`/contacts/${contact.id}`} className="font-medium hover:underline">
                      {name}
                    </Link>
                    {contact.email && contact.email !== name && <div className="text-xs text-muted-foreground">{contact.email}</div>}
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={run.status} />
                    {run.status === "failed" && run.lastError && (
                      <div className="mt-1 max-w-64 text-xs text-destructive">{run.lastError}</div>
                    )}
                    {run.status === "waiting" && run.lastError && (
                      <div className="mt-1 max-w-64 text-xs text-muted-foreground">Retrying: {run.lastError}</div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-64 text-muted-foreground">
                    {run.status === "completed" ? (
                      "Finished all steps"
                    ) : step ? (
                      <span className="line-clamp-2">
                        {run.currentStep + 1}/{automation.steps.length} · {describeStep(step, names)}
                      </span>
                    ) : (
                      "–"
                    )}
                    {run.status === "exited" && step && <span className="text-xs"> (left here)</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {!finished && run.status !== "failed" && run.nextRunAt ? formatDateTime(run.nextRunAt, timezone) : "–"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDateTime(run.startedAt, timezone)}>
                    {timeAgo(run.startedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <RunActions runId={run.id} status={run.status} contactName={name} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ListPagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={hrefFor} />
    </div>
  );
}
