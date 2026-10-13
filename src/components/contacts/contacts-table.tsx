"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Mail, Phone } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ColorBadge, LEAD_STATUS, MappedStatus } from "@/components/app/status-badge";
import { UserAvatar } from "@/components/app/user-avatar";
import { BulkBar } from "@/components/contacts/bulk-bar";
import { formatMoney } from "@/lib/format";
import type { BulkSelectionInput } from "@/app/(app)/contacts/actions";
import type { ContactRowDTO, StageDTO, TagDTO, UserDTO } from "@/lib/contacts/dto";
import type { ContactSort } from "@/lib/contacts/query";
import { cn } from "@/lib/utils";

type Props = {
  rows: ContactRowDTO[];
  total: number;
  stages: StageDTO[];
  users: UserDTO[];
  tags: TagDTO[];
  timezone: string;
  currency: string;
  /** Params describing the current query, used for "select all N matching" and export. */
  query: { q?: string; f?: string; quick: Record<string, string | undefined> };
  exportQuery: string;
  sort: ContactSort;
  dir: "asc" | "desc";
  sortHrefs: Partial<Record<ContactSort, string>>;
};

function SortHead({ label, sortKey, props }: { label: string; sortKey: ContactSort; props: Props }) {
  const active = props.sort === sortKey;
  const Icon = !active ? ArrowUpDown : props.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Link href={props.sortHrefs[sortKey] ?? "#"} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
      {label}
      <Icon className={cn("size-3", !active && "opacity-40")} />
    </Link>
  );
}

export function ContactsTable(props: Props) {
  const { rows, total, stages, users, tags, timezone, query, exportQuery } = props;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const stageByKey = new Map(stages.map((s) => [s.key, s]));

  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const count = allMatching ? total : selected.size;

  const toggleAll = (checked: boolean) => {
    setAllMatching(false);
    setSelected(checked ? new Set(pageIds) : new Set());
  };
  const toggle = (id: string, checked: boolean) => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const clear = () => {
    setSelected(new Set());
    setAllMatching(false);
  };

  const selection: BulkSelectionInput = allMatching
    ? { all: true, q: query.q, f: query.f, quick: query.quick }
    : { ids: [...selected].slice(0, 500) };
  const exportHref = allMatching ? `/contacts/export?${exportQuery}` : `/contacts/export?ids=${[...selected].join(",")}`;

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {count > 0 && (
        <BulkBar
          count={count}
          selection={selection}
          exportHref={exportHref}
          tags={tags}
          stages={stages}
          users={users}
          timezone={timezone}
          onClear={clear}
        />
      )}
      {allOnPage && !allMatching && total > rows.length && (
        <div className="border-b bg-muted/40 px-3 py-2 text-center text-sm">
          All {rows.length} contacts on this page are selected.{" "}
          <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setAllMatching(true)}>
            Select all {total.toLocaleString("en-AU")} matching contacts
          </button>
        </div>
      )}
      {allMatching && (
        <div className="border-b bg-muted/40 px-3 py-2 text-center text-sm">
          All {total.toLocaleString("en-AU")} matching contacts are selected.{" "}
          <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={clear}>
            Clear selection
          </button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10 pl-3">
              <Checkbox
                aria-label="Select all contacts on this page"
                checked={allOnPage ? true : someOnPage ? "indeterminate" : false}
                onCheckedChange={(c) => toggleAll(c === true)}
              />
            </TableHead>
            <TableHead className="min-w-56">
              <SortHead label="Name" sortKey="name" props={props} />
            </TableHead>
            <TableHead className="hidden md:table-cell">
              <SortHead label="Company" sortKey="company" props={props} />
            </TableHead>
            <TableHead>
              <SortHead label="Stage" sortKey="stage" props={props} />
            </TableHead>
            <TableHead className="hidden lg:table-cell">Lead status</TableHead>
            <TableHead className="hidden xl:table-cell">Tags</TableHead>
            <TableHead className="hidden lg:table-cell">Owner</TableHead>
            <TableHead className="hidden md:table-cell">
              <SortHead label="Last activity" sortKey="last_activity" props={props} />
            </TableHead>
            <TableHead className="hidden xl:table-cell">
              <SortHead label="Created" sortKey="created" props={props} />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const stage = stageByKey.get(r.stage);
            const isSelected = allMatching || selected.has(r.id);
            return (
              <TableRow key={r.id} data-state={isSelected ? "selected" : undefined} className="group">
                <TableCell className="pl-3">
                  <Checkbox
                    aria-label={`Select ${r.name}`}
                    checked={isSelected}
                    disabled={allMatching}
                    onCheckedChange={(c) => toggle(r.id, c === true)}
                  />
                </TableCell>
                <TableCell>
                  <Link href={`/contacts/${r.id}`} className="flex min-w-0 items-center gap-3">
                    <UserAvatar name={r.name} className="size-8" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium group-hover:underline">{r.name}</span>
                      <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {r.email ? (
                          <>
                            <Mail className="size-3 shrink-0" />
                            <span className="truncate">{r.email}</span>
                          </>
                        ) : r.phone ? (
                          <>
                            <Phone className="size-3 shrink-0" />
                            <span className="truncate">{r.phone}</span>
                          </>
                        ) : (
                          "No email"
                        )}
                        {r.emailStatus !== "subscribed" && r.email && <span className="shrink-0 text-amber-600 dark:text-amber-400">· {r.emailStatus}</span>}
                      </span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="max-w-48 truncate">{r.company ?? <span className="text-muted-foreground">—</span>}</div>
                  {r.jobTitle && <div className="max-w-48 truncate text-xs text-muted-foreground">{r.jobTitle}</div>}
                </TableCell>
                <TableCell>
                  {stage ? <ColorBadge color={stage.color}>{stage.label}</ColorBadge> : <span className="text-muted-foreground">{r.stage}</span>}
                  {r.dealValue != null && <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{formatMoney(r.dealValue, props.currency)}</div>}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {r.leadStatus ? <MappedStatus map={LEAD_STATUS} value={r.leadStatus} /> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="hidden xl:table-cell">
                  <div className="flex max-w-56 flex-wrap gap-1">
                    {r.tags.slice(0, 3).map((t) => (
                      <ColorBadge key={t.id} color={t.color}>
                        {t.name}
                      </ColorBadge>
                    ))}
                    {r.tags.length > 3 && <span className="text-xs text-muted-foreground">+{r.tags.length - 3}</span>}
                  </div>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {r.owner ? (
                    <div className="flex items-center gap-2">
                      <UserAvatar name={r.owner.name} color={r.owner.color} className="size-6" />
                      <span className="max-w-28 truncate text-sm">{r.owner.name}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{r.lastActivity}</TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground xl:table-cell">{r.created}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
