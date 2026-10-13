"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { StatusBadge, type Tone } from "@/components/app/status-badge";
import { setEmailStatusAction } from "@/app/(app)/contacts/actions";

const TONE: Record<string, { label: string; tone: Tone }> = {
  subscribed: { label: "Subscribed", tone: "green" },
  unsubscribed: { label: "Unsubscribed", tone: "amber" },
  bounced: { label: "Bounced", tone: "red" },
  complained: { label: "Complained", tone: "red" },
};

/** Email subscription status with unsubscribe / resubscribe. */
export function EmailStatusControl({ contactId, status, hasEmail }: { contactId: string; status: string; hasEmail: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const t = TONE[status] ?? { label: status, tone: "neutral" as Tone };
  const set = (next: "subscribed" | "unsubscribed") =>
    start(async () => {
      const res = await setEmailStatusAction(contactId, next);
      if (!res.ok) toast.error(res.error);
      else toast.success(res.message ?? "Updated");
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge tone={t.tone}>{t.label}</StatusBadge>
      {hasEmail && status === "subscribed" && (
        <ConfirmDialog
          title="Unsubscribe this contact?"
          description="They will no longer receive broadcasts or automated marketing emails. One-to-one emails and event notifications are unaffected."
          confirmLabel="Unsubscribe"
          onConfirm={() => set("unsubscribed")}
          trigger={
            <Button variant="ghost" size="xs" disabled={pending}>
              Unsubscribe
            </Button>
          }
        />
      )}
      {hasEmail && status === "unsubscribed" && (
        <Button variant="ghost" size="xs" disabled={pending} onClick={() => set("subscribed")}>
          {pending && <Spinner />} Resubscribe
        </Button>
      )}
    </div>
  );
}
