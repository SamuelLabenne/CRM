"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskDialog, type TaskDialogUser } from "@/components/tasks/task-dialog";
import type { PickedContact } from "@/components/app/contact-picker";

/** Button + dialog to create a task (optionally pre-linked to a contact). */
export function NewTaskButton({
  users,
  currentUserId,
  timezone,
  lockedContact,
  label = "New task",
  variant = "default",
  size = "sm",
}: {
  users: TaskDialogUser[];
  currentUserId: string;
  timezone: string;
  lockedContact?: PickedContact;
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Plus /> {label}
      </Button>
      <TaskDialog open={open} onOpenChange={setOpen} users={users} currentUserId={currentUserId} timezone={timezone} lockedContact={lockedContact} />
    </>
  );
}
