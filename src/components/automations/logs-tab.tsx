import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/app/status-badge";
import type { Automation } from "@/lib/db/schema";
import { STEP_META, type StepType } from "@/lib/automations/meta";
import { listLogs } from "@/lib/automations/service";
import { formatDateTime, fullName } from "@/lib/format";
import { FilterPills, ListPagination, LOG_STATUS } from "./status";

const PAGE_SIZE = 50;
const FILTERS = [
  { key: "all", label: "All" },
  { key: "ok", label: "OK" },
  { key: "skipped", label: "Skipped" },
  { key: "error", label: "Errors" },
  { key: "exited", label: "Exited" },
];

const SPECIAL: Record<string, string> = { enrolled: "Enrolled", end: "Finished", retry: "Retry" };

export async function LogsTab({
  automation,
  searchParams,
  timezone,
}: {
  automation: Automation;
  searchParams: Record<string, string | string[] | undefined>;
  timezone: string;
}) {
  const filter = FILTERS.find((f) => f.key === searchParams.status)?.key ?? "all";
  const page = Math.max(1, Number.parseInt(String(searchParams.page ?? "1"), 10) || 1);
  const { rows, total } = await listLogs(automation.id, {
    status: filter === "all" ? undefined : filter,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const base = `/automations/${automation.id}?tab=logs`;
  const hrefFor = (p: number) => `${base}${filter === "all" ? "" : `&status=${filter}`}&page=${p}`;

  return (
    <div className="grid gap-4">
      <FilterPills
        active={filter}
        items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: f.key === "all" ? base : `${base}&status=${f.key}` }))}
      />
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Step</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No log entries match this filter.
                </TableCell>
              </TableRow>
            )}
            {rows.map(({ log, contact }) => {
              const s = LOG_STATUS[log.status] ?? { label: log.status, tone: "neutral" as const };
              const stepLabel =
                log.stepType && SPECIAL[log.stepType]
                  ? SPECIAL[log.stepType]
                  : log.stepType && STEP_META[log.stepType as StepType]
                    ? `${log.stepIndex != null ? `${log.stepIndex + 1}. ` : ""}${STEP_META[log.stepType as StepType].label}`
                    : "–";
              return (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(log.createdAt, timezone)}</TableCell>
                  <TableCell>
                    <Link href={`/contacts/${contact.id}`} className="font-medium hover:underline">
                      {fullName(contact)}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{stepLabel}</TableCell>
                  <TableCell>
                    <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                  </TableCell>
                  <TableCell className="max-w-md whitespace-normal text-muted-foreground">{log.message}</TableCell>
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
