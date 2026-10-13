"use client";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { pluralize } from "@/lib/format";
import { deleteSampleDataAction } from "./actions";

const LABELS: Record<string, [string, string]> = {
  contacts: ["contact", "contacts"],
  campaigns: ["campaign", "campaigns"],
  events: ["event or meeting", "events and meetings"],
  booking_pages: ["booking page", "booking pages"],
  email_templates: ["email template", "email templates"],
  broadcasts: ["broadcast", "broadcasts"],
  automations: ["automation", "automations"],
  tasks: ["task", "tasks"],
  tags: ["tag", "tags"],
  saved_views: ["smart view", "smart views"],
};

export function DangerZoneCard({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  return (
    <section className="rounded-xl border border-destructive/40 bg-card p-4">
      <h2 className="text-base font-medium text-destructive">Danger zone</h2>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <div className="text-sm font-medium">Delete sample data</div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {total > 0
              ? `Removes the demo content Relay created for you: ${entries.map(([t, n]) => pluralize(n, ...((LABELS[t] ?? [t, t]) as [string, string]))).join(", ")} – including their activity, registrations and emails. Anything you created yourself is kept.`
              : "There is no sample data in this workspace."}
          </p>
        </div>
        <ConfirmDialog
          title="Delete all sample data?"
          description="This permanently removes the demo contacts, events, campaigns, emails and everything attached to them. Your own data is not touched. This can’t be undone."
          confirmLabel="Delete sample data"
          destructive
          onConfirm={async () => {
            const res = await deleteSampleDataAction();
            if (res.ok) toast.success(res.message);
            else toast.error(res.error);
          }}
          trigger={
            <Button variant="destructive" disabled={total === 0}>
              <Trash2 /> Delete sample data
            </Button>
          }
        />
      </div>
    </section>
  );
}
