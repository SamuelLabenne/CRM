import {
  ArrowRightLeft,
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  CalendarX2,
  CheckSquare,
  ClipboardCheck,
  Columns3,
  Flame,
  GitBranch,
  Hand,
  Hourglass,
  Mail,
  MailCheck,
  MousePointerClick,
  Tag,
  Tags,
  Target,
  Ticket,
  Timer,
  UserPlus,
  UserX,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import type { RecipeId } from "@/lib/automations/recipes";
import type { StepType } from "@/lib/automations/meta";
import type { TriggerType } from "@/lib/types";

export const TRIGGER_ICONS: Record<TriggerType, LucideIcon> = {
  contact_created: UserPlus,
  tag_added: Tag,
  stage_changed: Columns3,
  lead_potential: Target,
  event_registered: Ticket,
  event_cancelled: CalendarX,
  event_attended: CalendarCheck,
  event_no_show: UserX,
  meeting_booked: CalendarClock,
  meeting_cancelled: CalendarX2,
  meeting_outcome: ClipboardCheck,
  email_clicked: MousePointerClick,
  manual: Hand,
};

export const STEP_ICONS: Record<StepType, LucideIcon> = {
  send_email: Mail,
  wait: Timer,
  wait_until_event: Hourglass,
  condition: GitBranch,
  add_tag: Tag,
  remove_tag: Tags,
  set_stage: ArrowRightLeft,
  create_task: CheckSquare,
  notify_team: Bell,
  webhook: Webhook,
};

/** Tailwind classes for the icon bubble of each step type (works in light and dark mode). */
export const STEP_TONE: Record<StepType, string> = {
  send_email: "bg-blue-500/10 text-blue-600 dark:text-blue-300",
  wait: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  wait_until_event: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  condition: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  add_tag: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  remove_tag: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  set_stage: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  create_task: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  notify_team: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  webhook: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

export const RECIPE_ICONS: Record<RecipeId, LucideIcon> = {
  "event-reminders": CalendarCheck,
  "no-show-recovery": UserX,
  "welcome-series": MailCheck,
  "abandoned-registration": Target,
  "meeting-no-show": CalendarClock,
  "hot-lead-alert": Flame,
};
