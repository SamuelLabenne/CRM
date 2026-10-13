"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { cancelRunAction, retryRunAction } from "@/app/(app)/automations/actions";
import type { AutomationRunStatus } from "@/lib/types";

/** Cancel (in-progress runs) or retry (failed runs) a single run. */
export function RunActions({ runId, status, contactName }: { runId: string; status: AutomationRunStatus; contactName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (status === "failed") {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await retryRunAction(runId);
            if (res.ok) toast.success(res.message ?? "Retrying");
            else toast.error(res.error);
            router.refresh();
          })
        }
      >
        {pending ? <Spinner /> : <RotateCcw />} Retry
      </Button>
    );
  }
  if (status === "active" || status === "waiting") {
    return (
      <ConfirmDialog
        destructive
        title="Cancel this run?"
        description={`${contactName} will be removed from the automation and won't receive the remaining steps.`}
        confirmLabel="Cancel run"
        onConfirm={async () => {
          const res = await cancelRunAction(runId);
          if (res.ok) toast.success(res.message ?? "Run cancelled");
          else toast.error(res.error);
          router.refresh();
        }}
        trigger={
          <Button variant="ghost" size="sm">
            <XCircle /> Cancel
          </Button>
        }
      />
    );
  }
  return null;
}
