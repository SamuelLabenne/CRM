"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { deleteAutomationAction } from "@/app/(app)/automations/actions";

export function DeleteAutomationButton({ id, name, runs }: { id: string; name: string; runs: number }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      destructive
      title={`Delete “${name}”?`}
      description={
        runs > 0
          ? `This removes the automation and its ${runs} run${runs === 1 ? "" : "s"} and logs. Contacts currently inside it won't receive any more steps. Emails already sent stay in the outbox.`
          : "This permanently removes the automation."
      }
      confirmLabel="Delete automation"
      onConfirm={async () => {
        const res = await deleteAutomationAction(id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(res.message ?? "Automation deleted");
        router.push("/automations");
        router.refresh();
      }}
      trigger={
        <Button variant="outline" className="text-destructive hover:text-destructive">
          <Trash2 /> Delete
        </Button>
      }
    />
  );
}
