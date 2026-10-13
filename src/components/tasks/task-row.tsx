"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Pencil, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { UserAvatar } from "@/components/app/user-avatar";
import { StatusBadge } from "@/components/app/status-badge";
import { TaskDialog, type TaskDialogUser } from "@/components/tasks/task-dialog";
import { deleteTaskAction, setTaskCompletedAction } from "@/app/(app)/tasks/actions";
import type { TaskDTO } from "@/components/tasks/types";
import { cn } from "@/lib/utils";

/** One task line: complete checkbox (optimistic), title, due date, contact, assignee, edit/delete. */
export function TaskRow({
  task,
  users,
  currentUserId,
  timezone,
  showContact = true,
}: {
  task: TaskDTO;
  users: TaskDialogUser[];
  currentUserId: string;
  timezone: string;
  showContact?: boolean;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [completed, setCompleted] = useOptimistic(task.completed);

  const toggle = (next: boolean) =>
    start(async () => {
      setCompleted(next);
      const res = await setTaskCompletedAction(task.id, next);
      if (!res.ok) toast.error(res.error);
      else toast.success(res.message ?? (next ? "Task completed" : "Task reopened"));
      router.refresh();
    });

  const overdue = !completed && task.bucket === "overdue";
  return (
    <div className="group flex items-start gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/40">
      <Checkbox className="mt-1" aria-label={completed ? `Reopen ${task.title}` : `Complete ${task.title}`} checked={completed} onCheckedChange={(c) => toggle(c === true)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("font-medium", completed && "text-muted-foreground line-through")}>{task.title}</span>
          {task.priority === "high" && !completed && <StatusBadge tone="red">High</StatusBadge>}
          {task.priority === "low" && !completed && <StatusBadge tone="neutral">Low</StatusBadge>}
        </div>
        {task.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{task.description}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {task.dueLabel && (
            <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-destructive")}>
              <CalendarClock className="size-3" /> {task.dueLabel}
            </span>
          )}
          {showContact && task.contact && (
            <Link href={`/contacts/${task.contact.id}`} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
              <User className="size-3" /> {task.contact.name}
            </Link>
          )}
          {task.assignee && (
            <span className="inline-flex items-center gap-1">
              <UserAvatar name={task.assignee.name} color={task.assignee.color} className="size-4 rounded-md text-[8px]" />
              {task.assignee.id === currentUserId ? "You" : task.assignee.name}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        <Button variant="ghost" size="icon-sm" aria-label="Edit task" onClick={() => setEditing(true)}>
          <Pencil />
        </Button>
        <ConfirmDialog
          destructive
          title="Delete this task?"
          description={`“${task.title}” will be removed. This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            const res = await deleteTaskAction(task.id);
            if (!res.ok) toast.error(res.error);
            else toast.success(res.message ?? "Task deleted");
            router.refresh();
          }}
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label="Delete task">
              <Trash2 />
            </Button>
          }
        />
      </div>
      <TaskDialog open={editing} onOpenChange={setEditing} task={task} users={users} currentUserId={currentUserId} timezone={timezone} />
    </div>
  );
}
