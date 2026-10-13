"use client";

import { useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/settings/copy-button";
import { SettingsCard } from "@/components/settings/settings-card";
import { regenerateCalendarFeedAction } from "./actions";

export function CalendarFeedCard({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const webcal = url.replace(/^https?:/, "webcal:");
  return (
    <SettingsCard
      title="Calendar feed"
      description="Subscribe to your Relay events and meetings from Google Calendar, Apple Calendar or Outlook. The link is private – anyone who has it can see your schedule."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 font-mono text-xs" aria-label="Calendar feed URL" />
        <CopyButton value={url} label="Copy link" />
        <Button variant="outline" asChild>
          <a href={webcal}>
            <CalendarDays /> Subscribe
          </a>
        </Button>
        <ConfirmDialog
          title="Create a new calendar link?"
          description="Your current link will stop working. Any calendar app subscribed to it will need the new link."
          confirmLabel="Create new link"
          destructive
          onConfirm={async () => {
            const res = await regenerateCalendarFeedAction();
            if (res.ok && res.data) {
              setUrl(res.data.url);
              toast.success(res.message);
            } else if (!res.ok) toast.error(res.error);
          }}
          trigger={
            <Button variant="ghost">
              <RefreshCw /> Regenerate
            </Button>
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Google Calendar: Other calendars → From URL. Apple Calendar: File → New Calendar Subscription. Outlook: Add calendar → Subscribe from web. Calendars refresh every few hours.
      </p>
    </SettingsCard>
  );
}
