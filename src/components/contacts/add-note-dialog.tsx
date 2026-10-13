"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { addNoteAction } from "@/app/(app)/contacts/actions";

/** Quick "Add note" from the contact header (the Journey tab has an inline composer too). */
export function AddNoteDialog({ open, onOpenChange, contactId, contactName }: { open: boolean; onOpenChange: (o: boolean) => void; contactId: string; contactName: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const res = await addNoteAction(contactId, { type: "note", body });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Note added");
      setBody("");
      onOpenChange(false);
      router.refresh();
    });
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add note</DialogTitle>
          <DialogDescription>Saved to {contactName}&apos;s journey.</DialogDescription>
        </DialogHeader>
        <Textarea
          rows={5}
          autoFocus
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) submit();
          }}
          placeholder="Write a note…"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !body.trim()}>
            {pending && <Spinner />} Add note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
