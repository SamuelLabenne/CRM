"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { addContactToEventAction } from "@/app/(app)/contacts/actions";
import { EventPicker, type PickedEvent } from "@/components/contacts/event-picker";

/** Register a single contact for an event (manual registration, honours capacity / waitlist). */
export function AddToEventDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  timezone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contactId: string;
  contactName: string;
  timezone: string;
}) {
  const router = useRouter();
  const [event, setEvent] = useState<PickedEvent | null>(null);
  const [silent, setSilent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    if (!event) return;
    setError(null);
    start(async () => {
      const res = await addContactToEventAction(contactId, event.id, silent);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Registered");
      onOpenChange(false);
      setEvent(null);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to event</DialogTitle>
          <DialogDescription>Register {contactName} for an event. If it&apos;s full and has a waitlist, they join the waitlist.</DialogDescription>
        </DialogHeader>
        {open && <EventPicker value={event} onChange={setEvent} timezone={timezone} />}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={!silent} onCheckedChange={(c) => setSilent(c !== true)} />
          Send registration confirmation email
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!event || pending}>
            {pending && <Spinner />} Register
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
