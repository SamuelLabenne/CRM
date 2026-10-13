"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ListTodo, Mail, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { createLeadTaskAction } from "@/app/(app)/meetings/actions";

function tomorrow() {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Quick actions for a potential lead: email, create task, open contact. */
export function LeadActions({ contactId, name, email }: { contactId: string; name: string; email: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(`Follow up with ${name}`);
  const [due, setDue] = useState(tomorrow);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {email && (
        <Button asChild size="sm" variant="outline">
          <a href={`mailto:${email}`}>
            <Mail /> Email
          </a>
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <ListTodo /> Create task
      </Button>
      <Button asChild size="sm" variant="ghost">
        <Link href={`/contacts/${contactId}`}>
          <UserRound /> Open
        </Link>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create a task</DialogTitle>
            <DialogDescription>Reach out to {name} before the lead goes cold.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await createLeadTaskAction({ contactId, title, dueDate: due || null });
                if (res.ok) {
                  toast.success("Task created");
                  setOpen(false);
                  router.refresh();
                } else toast.error(res.error);
              });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="lt-title">Task</Label>
              <Input id="lt-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lt-due">Due date</Label>
              <Input id="lt-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !title.trim()}>
                {pending && <Spinner />} Create task
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
