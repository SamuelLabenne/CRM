"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ContactPicker, type PickedContact } from "@/components/app/contact-picker";
import { addAttendeeAction } from "@/app/(app)/events/actions";

/** Staff adds an existing contact (or a brand-new person) to an event. */
export function AddAttendeeDialog({ eventId, trigger }: { eventId: string; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [markAttended, setMarkAttended] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setContact(null);
    setForm({ name: "", email: "", phone: "" });
    setMarkAttended(false);
    setSendEmail(true);
    setError(null);
  };

  const canSubmit = mode === "existing" ? !!contact : form.name.trim().length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await addAttendeeAction({
        eventId,
        contactId: mode === "existing" ? contact?.id : null,
        newContact: mode === "new" ? form : null,
        markAttended,
        silent: !sendEmail,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(res.message ?? "Attendee added");
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <UserPlus /> Add attendee
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add attendee</DialogTitle>
            <DialogDescription>Register a contact for this event. Staff can go over the capacity.</DialogDescription>
          </DialogHeader>
          <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as "existing" | "new")} className="w-full">
            <ToggleGroupItem value="existing" className="flex-1">
              Existing contact
            </ToggleGroupItem>
            <ToggleGroupItem value="new" className="flex-1">
              New contact
            </ToggleGroupItem>
          </ToggleGroup>
          {mode === "existing" ? (
            <div className="grid gap-1.5">
              <Label>Contact</Label>
              <ContactPicker value={contact} onChange={setContact} />
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="att-name">Full name</Label>
                <Input id="att-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="Ada Lovelace" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="att-email">Email</Label>
                  <Input id="att-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ada@example.com" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="att-phone">Phone</Label>
                  <Input id="att-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
            </div>
          )}
          <div className="grid gap-3 rounded-lg border p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Send confirmation email</span>
              <Switch checked={sendEmail} onCheckedChange={setSendEmail} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Mark as attended right away</span>
              <Switch checked={markAttended} onCheckedChange={setMarkAttended} />
            </label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || pending}>
              {pending && <Loader2 className="animate-spin" />} Add attendee
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
