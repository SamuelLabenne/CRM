"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, CheckCheck, CircleSlash, ClipboardCheck, Copy, MoreHorizontal, UserRound, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cancelMeetingAction, markAttendedAction, markNoShowAction } from "@/app/(app)/meetings/actions";
import type { MeetingOutcome } from "@/lib/types";
import { OutcomeDialog } from "./outcome-dialog";

export type MeetingActionRow = {
  attendeeId: string;
  contactId: string;
  contactName: string;
  title: string;
  manageToken: string;
  cancelled: boolean;
  past: boolean;
  status: string;
  outcome: MeetingOutcome | null;
  objection: string | null;
  notes: string | null;
  dealValue: number | null;
};

function CancelDialog({ row, open, onOpenChange }: { row: MeetingActionRow; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this meeting?</DialogTitle>
          <DialogDescription>
            {row.contactName} · {row.title}. The time slot is freed up for other bookings.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="cm-reason">Reason (optional)</Label>
            <Textarea id="cm-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={notify} onCheckedChange={(v) => setNotify(v === true)} /> Email the invitee about the cancellation
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Keep meeting
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await cancelMeetingAction({ attendeeId: row.attendeeId, reason, notify });
                if (res.ok) {
                  toast.success("Meeting cancelled");
                  onOpenChange(false);
                  router.refresh();
                } else toast.error(res.error);
              })
            }
          >
            {pending && <Spinner />} Cancel meeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Quick actions + menu for one meeting row. */
export function MeetingActions({ row }: { row: MeetingActionRow }) {
  const router = useRouter();
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Done");
        router.refresh();
      } else toast.error(res.error ?? "Something went wrong");
    });

  return (
    <div className="flex items-center justify-end gap-1.5">
      {!row.cancelled && row.past && !row.outcome && (
        <>
          <Button size="sm" onClick={() => setOutcomeOpen(true)}>
            <ClipboardCheck /> Log outcome
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markNoShowAction(row.attendeeId))}>
            {pending ? <Spinner /> : <CircleSlash />} No-show
          </Button>
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Meeting actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {!row.cancelled && (
            <DropdownMenuItem onSelect={() => setOutcomeOpen(true)}>
              <ClipboardCheck /> {row.outcome ? "Edit outcome" : "Log outcome"}
            </DropdownMenuItem>
          )}
          {!row.cancelled && row.status !== "attended" && (
            <DropdownMenuItem onSelect={() => run(() => markAttendedAction(row.attendeeId))}>
              <CheckCheck /> Mark attended
            </DropdownMenuItem>
          )}
          {!row.cancelled && row.status !== "no_show" && (
            <DropdownMenuItem onSelect={() => run(() => markNoShowAction(row.attendeeId))}>
              <CircleSlash /> Mark no-show
            </DropdownMenuItem>
          )}
          {!row.cancelled && !row.past && (
            <DropdownMenuItem asChild>
              <Link href={`/m/${row.manageToken}/reschedule`} target="_blank">
                <CalendarClock /> Reschedule
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href={`/contacts/${row.contactId}`}>
              <UserRound /> Open contact
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void navigator.clipboard.writeText(`${window.location.origin}/m/${row.manageToken}`).then(() => toast.success("Manage link copied"));
            }}
          >
            <Copy /> Copy manage link
          </DropdownMenuItem>
          {!row.cancelled && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setCancelOpen(true)}>
                <XCircle /> Cancel meeting
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {outcomeOpen && (
        <OutcomeDialog
          open={outcomeOpen}
          onOpenChange={setOutcomeOpen}
          target={{ attendeeId: row.attendeeId, contactName: row.contactName, title: row.title, outcome: row.outcome, objection: row.objection, notes: row.notes, dealValue: row.dealValue }}
          onSaved={() => router.refresh()}
        />
      )}
      {cancelOpen && <CancelDialog row={row} open={cancelOpen} onOpenChange={setCancelOpen} />}
    </div>
  );
}
