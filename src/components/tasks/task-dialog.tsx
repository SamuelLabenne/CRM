"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ContactPicker, type PickedContact } from "@/components/app/contact-picker";
import { createTaskAction, updateTaskAction } from "@/app/(app)/tasks/actions";
import { formatInTz } from "@/lib/format";
import type { TaskDTO } from "@/components/tasks/types";

export type TaskDialogUser = { id: string; name: string };

/**
 * Create or edit a task. Controlled via `open`/`onOpenChange` so callers can open it from menus.
 * Pass `lockedContact` to attach the task to a contact without showing the picker (contact page).
 */
export function TaskDialog({
  open,
  onOpenChange,
  task,
  lockedContact,
  users,
  currentUserId,
  timezone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: TaskDTO;
  lockedContact?: PickedContact;
  users: TaskDialogUser[];
  currentUserId: string;
  timezone: string;
}) {
  // Re-mount the form each time the dialog opens so state always starts from the right task.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <TaskForm
            key={task?.id ?? "new"}
            task={task}
            lockedContact={lockedContact}
            users={users}
            currentUserId={currentUserId}
            timezone={timezone}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  task,
  lockedContact,
  users,
  currentUserId,
  timezone,
  onClose,
}: {
  task?: TaskDTO;
  lockedContact?: PickedContact;
  users: TaskDialogUser[];
  currentUserId: string;
  timezone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [dueTime, setDueTime] = useState(task?.dueTime ?? "");
  const [priority, setPriority] = useState<"low" | "normal" | "high">(task?.priority ?? "normal");
  const [assigneeId, setAssigneeId] = useState(task ? (task.assignee?.id ?? "") : currentUserId);
  const [contact, setContact] = useState<PickedContact | null>(
    lockedContact ?? (task?.contact ? { id: task.contact.id, name: task.contact.name, email: null } : null),
  );
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const preset = (days: number | null) => {
    if (days == null) {
      setDueDate("");
      setDueTime("");
    } else setDueDate(formatInTz(addDays(new Date(), days), timezone, "yyyy-MM-dd"));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    const payload = {
      title,
      description: description || null,
      dueDate: dueDate || null,
      dueTime: dueTime || null,
      priority,
      contactId: contact?.id ?? null,
      assigneeId: assigneeId || null,
    };
    start(async () => {
      const res = task ? await updateTaskAction(task.id, payload) : await createTaskAction(payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Saved");
      onClose();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        <DialogDescription>{lockedContact ? `Follow-up for ${lockedContact.name}.` : "A to-do with an optional due date and contact."}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="task-title">Title</Label>
        <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call to discuss the proposal" required maxLength={200} autoFocus aria-invalid={!!errors.title} />
        {errors.title && <p className="text-sm text-destructive">{errors.title[0]}</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="task-desc">Details (optional)</Label>
        <Textarea id="task-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="task-date">Due</Label>
          <div className="flex gap-1">
            {[
              ["Today", 0],
              ["Tomorrow", 1],
              ["Next week", 7],
            ].map(([label, days]) => (
              <Button key={label as string} type="button" variant="ghost" size="xs" onClick={() => preset(days as number)}>
                {label}
              </Button>
            ))}
            <Button type="button" variant="ghost" size="xs" onClick={() => preset(null)}>
              No date
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_8rem] gap-2">
          <Input id="task-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-invalid={!!errors.dueDate} />
          <Input type="time" aria-label="Due time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={!dueDate} />
        </div>
        {errors.dueDate && <p className="text-sm text-destructive">{errors.dueDate[0]}</p>}
        <p className="text-xs text-muted-foreground">Times are in the workspace timezone ({timezone}). Leave the time empty for an all-day task.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="task-priority">Priority</Label>
          <NativeSelect id="task-priority" className="w-full" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            <NativeSelectOption value="low">Low</NativeSelectOption>
            <NativeSelectOption value="normal">Normal</NativeSelectOption>
            <NativeSelectOption value="high">High</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="task-assignee">Assignee</Label>
          <NativeSelect id="task-assignee" className="w-full" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <NativeSelectOption value="">Unassigned</NativeSelectOption>
            {users.map((u) => (
              <NativeSelectOption key={u.id} value={u.id}>
                {u.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      {!lockedContact && (
        <div className="grid gap-1.5">
          <Label>Contact (optional)</Label>
          <ContactPicker value={contact} onChange={setContact} placeholder="Link to a contact…" />
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !title.trim()}>
          {pending && <Spinner />} {task ? "Save task" : "Create task"}
        </Button>
      </DialogFooter>
    </form>
  );
}
