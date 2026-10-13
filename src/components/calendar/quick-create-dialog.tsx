"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { quickCreateEventAction } from "@/app/(app)/calendar/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { EVENT_TYPE_OPTIONS } from "./constants";

export type QuickCreateDraft = { start: string; end: string };

/** Wall-clock "yyyy-MM-ddTHH:mm" strings in the workspace timezone. */
export function QuickCreateDialog({
  draft,
  onClose,
  campaigns,
  timezone,
  onCreated,
}: {
  draft: QuickCreateDraft | null;
  onClose: () => void;
  campaigns: { id: string; name: string }[];
  timezone: string;
  onCreated: () => void;
}) {
  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {/* key resets the form each time the dialog opens with a new range */}
        {draft && <QuickCreateForm key={`${draft.start}|${draft.end}`} draft={draft} onClose={onClose} campaigns={campaigns} timezone={timezone} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function QuickCreateForm({
  draft,
  onClose,
  campaigns,
  timezone,
  onCreated,
}: {
  draft: QuickCreateDraft;
  onClose: () => void;
  campaigns: { id: string; name: string }[];
  timezone: string;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [type, setType] = useState("webinar");
  const [startAt, setStartAt] = useState(draft.start);
  const [endAt, setEndAt] = useState(draft.end);
  const [campaignId, setCampaignId] = useState("");
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await quickCreateEventAction({
        title,
        type: type as (typeof EVENT_TYPE_OPTIONS)[number]["value"],
        start: startAt,
        end: endAt,
        campaignId: campaignId || null,
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success("Event created");
      onCreated();
      onClose();
      if (res.data?.id) router.push(`/events/${res.data.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New event</DialogTitle>
        <DialogDescription>
          Schedules the event right away with default reminders, hosted by you. Times are in {timezone.replace(/_/g, " ")}. You can finish the details
          on the next screen.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="qc-title">Title</Label>
        <Input id="qc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Spring product webinar" autoFocus aria-invalid={!!errors.title} />
        {errors.title && <p className="text-xs text-destructive">{errors.title[0]}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="qc-type">Type</Label>
          <NativeSelect id="qc-type" className="w-full" value={type} onChange={(e) => setType(e.target.value)}>
            {EVENT_TYPE_OPTIONS.map((t) => (
              <NativeSelectOption key={t.value} value={t.value}>
                {t.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="qc-campaign">Campaign</Label>
          <NativeSelect id="qc-campaign" className="w-full" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            <NativeSelectOption value="">None</NativeSelectOption>
            {campaigns.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="qc-start">Starts</Label>
          <Input id="qc-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} aria-invalid={!!errors.start} required />
          {errors.start && <p className="text-xs text-destructive">{errors.start[0]}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="qc-end">Ends</Label>
          <Input id="qc-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} aria-invalid={!!errors.end} required />
          {errors.end && <p className="text-xs text-destructive">{errors.end[0]}</p>}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />} Create &amp; open
        </Button>
      </DialogFooter>
    </form>
  );
}
