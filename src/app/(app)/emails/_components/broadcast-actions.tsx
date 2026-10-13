"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { ControlledConfirm } from "@/components/email/controlled-confirm";
import type { BroadcastStatus } from "@/lib/types";
import { cancelBroadcastAction, deleteBroadcastAction, duplicateBroadcastAction } from "../actions";

/**
 * Broadcast actions menu used in the list rows and on the report page.
 * `redirectAfterDelete` sends the user back to the list when the broadcast is deleted from its own page.
 */
export function BroadcastActions({
  id,
  name,
  status,
  redirectAfterDelete,
  variant = "icon",
}: {
  id: string;
  name: string;
  status: BroadcastStatus;
  redirectAfterDelete?: boolean;
  variant?: "icon" | "button";
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"cancel" | "delete" | null>(null);
  const [pending, start] = useTransition();

  const canCancel = status === "scheduled" || status === "sending";
  const canDelete = status === "draft" || status === "cancelled" || status === "failed";
  const editable = status === "draft" || status === "cancelled";

  const duplicate = () =>
    start(async () => {
      const res = await duplicateBroadcastAction(id);
      if (!res.ok) return toast.error(res.error);
      toast.success("Broadcast duplicated", { description: "Review the copy and send it when you're ready." });
      router.push(`/emails/broadcasts/${res.data!.id}`);
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === "icon" ? (
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
              {pending ? <Spinner /> : <MoreHorizontal />}
            </Button>
          ) : (
            <Button variant="outline" size="sm">
              {pending ? <Spinner /> : <MoreHorizontal />} Actions
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <Link href={`/emails/broadcasts/${id}`}>
              <Pencil /> {editable ? "Edit" : "View report"}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={duplicate}>
            <Copy /> Duplicate
          </DropdownMenuItem>
          {(canCancel || canDelete) && <DropdownMenuSeparator />}
          {canCancel && (
            <DropdownMenuItem onSelect={() => setConfirm("cancel")}>
              <Ban /> {status === "scheduled" ? "Cancel schedule" : "Stop sending"}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ControlledConfirm
        open={confirm === "cancel"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={status === "scheduled" ? "Cancel this scheduled broadcast?" : "Stop sending this broadcast?"}
        description={
          status === "scheduled"
            ? `“${name}” will not be sent. You can edit it and schedule it again.`
            : `Emails that have already gone out can't be recalled. “${name}” will stop sending to the remaining recipients.`
        }
        confirmLabel={status === "scheduled" ? "Cancel schedule" : "Stop sending"}
        destructive
        onConfirm={async () => {
          const res = await cancelBroadcastAction(id);
          if (!res.ok) return toast.error(res.error);
          toast.success(status === "scheduled" ? "Schedule cancelled" : "Sending stopped");
          router.refresh();
        }}
      />
      <ControlledConfirm
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this broadcast?"
        description={`“${name}” will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const res = await deleteBroadcastAction(id);
          if (!res.ok) return toast.error(res.error);
          toast.success("Broadcast deleted");
          if (redirectAfterDelete) router.push("/emails");
          else router.refresh();
        }}
      />
    </>
  );
}
