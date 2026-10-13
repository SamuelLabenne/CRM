"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CheckCheck, Copy, Loader2, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { deleteEventAction, duplicateEventAction, setEventStatusAction } from "@/app/(app)/events/actions";

type Confirm = "cancel" | "delete" | null;

/** Header "more" menu on the event page: duplicate, complete, cancel/reopen, delete. */
export function EventActions({ eventId, status, attendees, title }: { eventId: string; status: string; attendees: number; title: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Something went wrong");
      toast.success(res.message ?? "Done");
      setConfirm(null);
      after?.();
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onSelect={() =>
              run(
                async () => {
                  const r = await duplicateEventAction(eventId);
                  if (r.ok && r.data) router.push(`/events/${r.data.id}?tab=settings`);
                  return r;
                },
              )
            }
          >
            <Copy /> Duplicate
          </DropdownMenuItem>
          {status === "scheduled" && (
            <DropdownMenuItem onSelect={() => run(() => setEventStatusAction(eventId, "completed"), () => router.refresh())}>
              <CheckCheck /> Mark as completed
            </DropdownMenuItem>
          )}
          {(status === "cancelled" || status === "completed") && (
            <DropdownMenuItem onSelect={() => run(() => setEventStatusAction(eventId, "scheduled"), () => router.refresh())}>
              <RotateCcw /> Reopen event
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {status !== "cancelled" && (
            <DropdownMenuItem onSelect={() => setConfirm("cancel")} className="text-destructive focus:text-destructive">
              <Ban /> Cancel event
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setConfirm("delete")} className="text-destructive focus:text-destructive">
            <Trash2 /> Delete event
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "delete" ? `Delete “${title}”?` : `Cancel “${title}”?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? `This permanently deletes the event and its ${attendees} ${attendees === 1 ? "registration" : "registrations"}. Contacts are kept. This can't be undone.`
                : attendees > 0
                  ? `The registration page closes and ${attendees} ${attendees === 1 ? "person" : "people"} will receive the cancellation email (if enabled). You can reopen the event later.`
                  : "The registration page closes. You can reopen the event later."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep event</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                if (confirm === "delete") run(() => deleteEventAction(eventId), () => router.push("/events"));
                else run(() => setEventStatusAction(eventId, "cancelled", true), () => router.refresh());
              }}
            >
              {pending && <Loader2 className="animate-spin" />}
              {confirm === "delete" ? "Delete event" : "Cancel event"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
