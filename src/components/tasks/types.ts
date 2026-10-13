// Client-safe task shapes (dates pre-formatted on the server in the workspace timezone).
export type TaskBucketKey = "overdue" | "today" | "upcoming" | "no_date" | "completed";

export type TaskDTO = {
  id: string;
  title: string;
  description: string | null;
  priority: "low" | "normal" | "high";
  /** ISO timestamp or null */
  dueAt: string | null;
  /** yyyy-MM-dd in the workspace timezone, "" when there is no due date */
  dueDate: string;
  /** HH:mm, "" for date-only tasks */
  dueTime: string;
  /** e.g. "Tue 14 Oct" or "Tue 14 Oct, 09:30" */
  dueLabel: string;
  bucket: TaskBucketKey;
  completed: boolean;
  contact: { id: string; name: string } | null;
  assignee: { id: string; name: string; color: string } | null;
};
