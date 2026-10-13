"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Check, ChevronDown, ChevronRight, Loader2, MoreHorizontal, RotateCcw, Trash2, UserX, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ATTENDEE_STATUS, MappedStatus, StatusBadge } from "@/components/app/status-badge";
import { UserAvatar } from "@/components/app/user-avatar";
import { bulkMarkAttendanceAction, cancelAttendeeAction, markAttendanceAction, removeAttendeeAction } from "@/app/(app)/events/actions";

export type AttendeeTableRow = {
  id: string;
  contactId: string;
  name: string;
  email: string | null;
  company: string | null;
  status: string;
  rsvp: string | null;
  source: string;
  registeredLabel: string;
  checkedInLabel: string | null;
  cancelReason: string | null;
  answers: { label: string; value: string }[];
};

type Confirm = { kind: "cancel" | "remove"; row: AttendeeTableRow } | null;

const RSVP_TONE = { yes: "green", maybe: "amber", no: "red" } as const;

export function AttendeesTable({ rows }: { rows: AttendeeTableRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [pending, start] = useTransition();

  const markable = rows.filter((r) => r.status !== "cancelled" && r.status !== "waitlisted");
  const allSelected = markable.length > 0 && markable.every((r) => selected.has(r.id));
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, onDone?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Something went wrong");
      if (res.message) toast.success(res.message);
      onDone?.();
      router.refresh();
    });

  const mark = (id: string, status: "attended" | "no_show" | "registered") =>
    run(async () => {
      const r = await markAttendanceAction(id, status);
      return { ...r, message: status === "attended" ? "Marked as attended" : status === "no_show" ? "Marked as no-show" : "Attendance reset" };
    });

  const bulk = (status: "attended" | "no_show" | "registered") =>
    run(() => bulkMarkAttendanceAction([...selected], status), () => setSelected(new Set()));

  return (
    <div className="grid gap-3">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => bulk("attended")}>
              <Check /> Mark attended
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => bulk("no_show")}>
              <UserX /> Mark no-show
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => bulk("registered")}>
              <RotateCcw /> Reset
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all"
                  checked={allSelected}
                  onCheckedChange={(c) => setSelected(c ? new Set(markable.map((r) => r.id)) : new Set())}
                  disabled={markable.length === 0}
                />
              </TableHead>
              <TableHead>Attendee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Registered</TableHead>
              <TableHead className="hidden lg:table-cell">Source</TableHead>
              <TableHead className="hidden lg:table-cell">Checked in</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const expanded = open.has(r.id);
              const canMark = r.status !== "cancelled" && r.status !== "waitlisted";
              return (
                <Fragment key={r.id}>
                  <TableRow data-state={selected.has(r.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox aria-label={`Select ${r.name}`} checked={selected.has(r.id)} disabled={!canMark} onCheckedChange={() => setSelected(toggle(selected, r.id))} />
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <UserAvatar name={r.name} />
                        <div className="min-w-0">
                          <Link href={`/contacts/${r.contactId}`} className="block truncate font-medium hover:underline">
                            {r.name}
                          </Link>
                          <p className="truncate text-xs text-muted-foreground">{[r.email, r.company].filter(Boolean).join(" · ")}</p>
                        </div>
                        {r.answers.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setOpen(toggle(open, r.id))}
                            aria-expanded={expanded}
                            className="ml-1 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                          >
                            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} Answers
                          </button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <MappedStatus map={ATTENDEE_STATUS} value={r.status} />
                        {r.rsvp && r.status !== "cancelled" && <StatusBadge tone={RSVP_TONE[r.rsvp as keyof typeof RSVP_TONE] ?? "neutral"}>RSVP {r.rsvp}</StatusBadge>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{r.registeredLabel}</TableCell>
                    <TableCell className="hidden capitalize text-muted-foreground lg:table-cell">{r.source}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{r.checkedInLabel ?? "—"}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {canMark && r.status !== "attended" && (
                            <DropdownMenuItem onSelect={() => mark(r.id, "attended")}>
                              <Check /> Mark attended
                            </DropdownMenuItem>
                          )}
                          {canMark && r.status !== "no_show" && (
                            <DropdownMenuItem onSelect={() => mark(r.id, "no_show")}>
                              <UserX /> Mark no-show
                            </DropdownMenuItem>
                          )}
                          {(r.status === "attended" || r.status === "no_show") && (
                            <DropdownMenuItem onSelect={() => mark(r.id, "registered")}>
                              <RotateCcw /> Reset attendance
                            </DropdownMenuItem>
                          )}
                          {canMark || r.status === "waitlisted" ? <DropdownMenuSeparator /> : null}
                          {r.status !== "cancelled" && (
                            <DropdownMenuItem onSelect={() => setConfirm({ kind: "cancel", row: r })}>
                              <Ban /> Cancel registration
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => setConfirm({ kind: "remove", row: r })} className="text-destructive focus:text-destructive">
                            <Trash2 /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell />
                      <TableCell colSpan={6}>
                        <dl className="grid gap-x-6 gap-y-2 py-1 text-sm sm:grid-cols-2">
                          {r.answers.map((a) => (
                            <div key={a.label}>
                              <dt className="text-xs text-muted-foreground">{a.label}</dt>
                              <dd className="font-medium break-words">{a.value || "—"}</dd>
                            </div>
                          ))}
                        </dl>
                        {r.cancelReason && <p className="mt-1 text-xs text-muted-foreground">Cancel reason: {r.cancelReason}</p>}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "remove" ? `Remove ${confirm.row.name}?` : `Cancel ${confirm?.row.name}'s registration?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "remove"
                ? "They will be removed from this event entirely (their contact is kept). A waitlisted person may take their seat."
                : "Their reminders stop and their seat is released. They stay on the list as cancelled and can register again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                if (!confirm) return;
                const { kind, row } = confirm;
                run(() => (kind === "remove" ? removeAttendeeAction(row.id) : cancelAttendeeAction(row.id, false)), () => setConfirm(null));
              }}
            >
              {pending && <Loader2 className="animate-spin" />}
              {confirm?.kind === "remove" ? "Remove" : "Cancel registration"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function AttendeesEmpty() {
  return (
    <div className="grid place-items-center gap-2 rounded-xl border border-dashed bg-card py-12 text-center text-muted-foreground">
      <Users className="size-8" />
      <p className="text-sm">No attendees match.</p>
    </div>
  );
}
