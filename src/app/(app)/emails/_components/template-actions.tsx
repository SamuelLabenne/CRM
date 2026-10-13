"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react";
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
import { deleteTemplateAction, duplicateTemplateAction } from "../actions";

/** Row actions for a template in the list. */
export function TemplateActions({ id, name, isSystem, usage }: { id: string; name: string; isSystem: boolean; usage: string | null }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  const duplicate = () =>
    start(async () => {
      const res = await duplicateTemplateAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Template duplicated");
      router.push(`/emails/templates/${res.data!.id}`);
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
            {pending ? <Spinner /> : <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <Link href={`/emails/templates/${id}`}>
              <Pencil /> Edit
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/emails/broadcasts/new?template=${id}`}>
              <Send /> Use in a broadcast
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={duplicate}>
            <Copy /> Duplicate
          </DropdownMenuItem>
          {!isSystem && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ControlledConfirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this template?"
        description={
          <>
            “{name}” will be permanently deleted.
            {usage ? ` It is currently used by ${usage}; those will fall back to their default email.` : ""}
          </>
        }
        confirmLabel="Delete template"
        destructive
        onConfirm={async () => {
          const res = await deleteTemplateAction(id);
          if (!res.ok) {
        toast.error(res.error);
        return;
      }
          toast.success("Template deleted");
          router.refresh();
        }}
      />
    </>
  );
}
