"use client";

import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { cancelBroadcastAction } from "../actions";

/** Prominent cancel / stop button shown in the scheduled & sending banners. */
export function CancelBroadcastButton({ id, name, mode }: { id: string; name: string; mode: "schedule" | "sending" }) {
  const router = useRouter();
  const schedule = mode === "schedule";
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          <Ban /> {schedule ? "Cancel schedule" : "Stop sending"}
        </Button>
      }
      title={schedule ? "Cancel this scheduled broadcast?" : "Stop sending this broadcast?"}
      description={
        schedule
          ? `“${name}” will not be sent. You can edit it and schedule it again.`
          : `Emails that have already gone out can't be recalled. “${name}” will stop sending to the remaining recipients.`
      }
      confirmLabel={schedule ? "Cancel schedule" : "Stop sending"}
      destructive
      onConfirm={async () => {
        const res = await cancelBroadcastAction(id);
        if (!res.ok) {
        toast.error(res.error);
        return;
      }
        toast.success(schedule ? "Schedule cancelled" : "Sending stopped");
        router.refresh();
      }}
    />
  );
}
