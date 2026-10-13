"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, Check, Copy, ExternalLink, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { getCalendarFeedAction, resetCalendarFeedAction } from "@/app/(app)/calendar/actions";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STEPS: Record<string, string[]> = {
  google: [
    "Open Google Calendar on the web and click + next to “Other calendars”.",
    "Choose “From URL” and paste the link above.",
    "Click “Add calendar”. Google refreshes subscribed calendars every few hours.",
  ],
  outlook: [
    "In Outlook, open Calendar and choose “Add calendar” → “Subscribe from web”.",
    "Paste the link above, name the calendar and click “Import”.",
    "Outlook checks for updates automatically.",
  ],
  apple: [
    "In Apple Calendar choose File → “New Calendar Subscription…”.",
    "Paste the link above and click Subscribe.",
    "Pick an auto-refresh interval (every hour is a good choice) and click OK.",
  ],
};

export function SubscribeDialog() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function load() {
    start(async () => {
      const res = await getCalendarFeedAction();
      if (res.ok && res.data) setUrl(res.data.url);
      else toast.error(res.ok ? "Could not load your calendar link" : res.error);
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Calendar link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select the link and copy it manually");
    }
  }

  const isLocal = url ? /^https?:\/\/(localhost|127\.|\[::1\])/.test(url) : false;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && !url) load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarPlus /> Subscribe
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Subscribe to your calendar</DialogTitle>
          <DialogDescription>
            Your events and meetings (everything, if you&apos;re an admin) from the last 30 days to the next 6 months, kept up to date in
            Google Calendar, Outlook or Apple Calendar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your private calendar link</div>
          {url ? (
            <div className="flex gap-2">
              <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" aria-label="Calendar feed URL" />
              <Button variant="outline" onClick={copy}>
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          ) : (
            <Skeleton className="h-8 w-full" />
          )}
          {url && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="link" size="sm" className="h-auto p-0" asChild>
                <a href={url.replace(/^https?:/, "webcal:")}>
                  <ExternalLink /> Open in my calendar app
                </a>
              </Button>
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="xs" className="text-muted-foreground">
                    <RotateCcw /> Reset link
                  </Button>
                }
                title="Reset your calendar link?"
                description="The current link stops working immediately. You'll need to subscribe again with the new link."
                confirmLabel="Reset link"
                destructive
                onConfirm={async () => {
                  const res = await resetCalendarFeedAction();
                  if (res.ok && res.data) {
                    setUrl(res.data.url);
                    toast.success("Calendar link reset");
                  } else toast.error(res.ok ? "Could not reset the link" : res.error);
                }}
              />
            </div>
          )}
          {pending && !url && <p className="text-xs text-muted-foreground">Generating your link…</p>}
          <p className="text-xs text-muted-foreground">Anyone with this link can see your calendar — keep it private.</p>
        </div>

        {isLocal && (
          <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              This is a local address, so Google Calendar and Outlook on the web can&apos;t reach it. It works once the app is deployed (or for calendar
              apps on this computer).
            </span>
          </div>
        )}

        <Tabs defaultValue="google">
          <TabsList className="w-full">
            <TabsTrigger value="google">Google</TabsTrigger>
            <TabsTrigger value="outlook">Outlook</TabsTrigger>
            <TabsTrigger value="apple">Apple</TabsTrigger>
          </TabsList>
          {Object.entries(STEPS).map(([key, steps]) => (
            <TabsContent key={key} value={key}>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                {steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
