"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Ellipsis, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
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
import { Spinner } from "@/components/ui/spinner";
import {
  deleteAutomationAction,
  duplicateAutomationAction,
  setAutomationStatusAction,
} from "@/app/(app)/automations/actions";
import type { AutomationStatus } from "@/lib/types";

/** Quick on/off switch for the list page. Draft and paused automations switch on, active ones pause. */
export function StatusToggle({ id, name, status }: { id: string; name: string; status: AutomationStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useState<AutomationStatus | null>(null);
  const shown = optimistic ?? status;
  return (
    <Switch
      checked={shown === "active"}
      disabled={pending}
      aria-label={shown === "active" ? `Pause ${name}` : `Activate ${name}`}
      onCheckedChange={(on) => {
        const next: AutomationStatus = on ? "active" : "paused";
        setOptimistic(next);
        start(async () => {
          const res = await setAutomationStatusAction(id, next);
          setOptimistic(null);
          if (!res.ok) {
            toast.error(res.error, { description: on ? "Open the automation to finish setting it up." : undefined });
            return;
          }
          toast.success(on ? `“${name}” is now active` : `“${name}” paused`);
          router.refresh();
        });
      }}
    />
  );
}

export function AutomationCardMenu({ id, name, runs }: { id: string; name: string; runs: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`} disabled={pending}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/automations/${id}`}>
              <Pencil /> Open
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              start(async () => {
                const res = await duplicateAutomationAction(id);
                if (!res.ok) return void toast.error(res.error);
                toast.success(res.message ?? "Duplicated");
                router.push(`/automations/${res.data!.id}`);
              })
            }
          >
            <Copy /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the automation{runs ? `, its ${runs} run${runs === 1 ? "" : "s"}` : ""} and logs. Contacts currently inside it won&apos;t
              get any more steps. Emails already sent stay in the outbox.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                start(async () => {
                  const res = await deleteAutomationAction(id);
                  if (res.ok) toast.success(res.message ?? "Deleted");
                  else toast.error(res.error);
                  setConfirmOpen(false);
                  router.refresh();
                });
              }}
            >
              {pending && <Spinner />} Delete automation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
