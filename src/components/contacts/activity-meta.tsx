import {
  Bell,
  Bot,

  CalendarClock,
  CalendarX2,
  CheckCircle2,
  CheckSquare,
  Columns3,
  Eye,
  FileText,
  Flag,
  Handshake,
  MailMinus,
  MailOpen,
  MousePointerClick,
  Pencil,
  PhoneCall,
  Send,
  StickyNote,
  Tag,
  Tags,
  Ticket,
  UserCheck,
  UserPlus,
  UserX,
  type LucideIcon,
} from "lucide-react";
import type { ActivityType } from "@/lib/types";

export type ActivityGroup = "notes" | "emails" | "events" | "meetings" | "tasks" | "changes" | "automation";

export const ACTIVITY_GROUPS: { key: ActivityGroup; label: string }[] = [
  { key: "notes", label: "Notes & calls" },
  { key: "emails", label: "Emails" },
  { key: "events", label: "Events" },
  { key: "meetings", label: "Meetings" },
  { key: "tasks", label: "Tasks" },
  { key: "changes", label: "Changes" },
  { key: "automation", label: "Automation" },
];

type Meta = { label: string; icon: LucideIcon; group: ActivityGroup; tone: string };

// Full class names are spelled out so Tailwind can see them.
const TONES = {
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  slate: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  sky: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  indigo: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  pink: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  orange: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  fuchsia: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  teal: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
} as const;

export const ACTIVITY_META: Record<ActivityType, Meta> = {
  note: { label: "Note", icon: StickyNote, group: "notes", tone: TONES.amber },
  call: { label: "Call", icon: PhoneCall, group: "notes", tone: TONES.emerald },
  contact_created: { label: "Created", icon: UserPlus, group: "changes", tone: TONES.slate },
  contact_updated: { label: "Updated", icon: Pencil, group: "changes", tone: TONES.slate },
  stage_changed: { label: "Stage", icon: Columns3, group: "changes", tone: TONES.violet },
  lead_status_changed: { label: "Lead status", icon: Flag, group: "changes", tone: TONES.sky },
  tag_added: { label: "Tag added", icon: Tag, group: "changes", tone: TONES.pink },
  tag_removed: { label: "Tag removed", icon: Tags, group: "changes", tone: TONES.pink },
  email_sent: { label: "Email sent", icon: Send, group: "emails", tone: TONES.blue },
  email_opened: { label: "Email opened", icon: MailOpen, group: "emails", tone: TONES.sky },
  email_clicked: { label: "Link clicked", icon: MousePointerClick, group: "emails", tone: TONES.indigo },
  unsubscribed: { label: "Unsubscribed", icon: MailMinus, group: "emails", tone: TONES.red },
  event_registered: { label: "Registered", icon: Ticket, group: "events", tone: TONES.emerald },
  event_cancelled: { label: "Cancelled", icon: CalendarX2, group: "events", tone: TONES.slate },
  event_attended: { label: "Attended", icon: UserCheck, group: "events", tone: TONES.emerald },
  event_no_show: { label: "No-show", icon: UserX, group: "events", tone: TONES.red },
  rsvp: { label: "RSVP", icon: Bell, group: "events", tone: TONES.amber },
  meeting_booked: { label: "Meeting booked", icon: CalendarClock, group: "meetings", tone: TONES.sky },
  meeting_cancelled: { label: "Meeting cancelled", icon: CalendarX2, group: "meetings", tone: TONES.red },
  meeting_outcome: { label: "Meeting outcome", icon: Handshake, group: "meetings", tone: TONES.violet },
  form_started: { label: "Form started", icon: FileText, group: "events", tone: TONES.orange },
  task_created: { label: "Task created", icon: CheckSquare, group: "tasks", tone: TONES.blue },
  task_completed: { label: "Task completed", icon: CheckCircle2, group: "tasks", tone: TONES.teal },
  automation: { label: "Automation", icon: Bot, group: "automation", tone: TONES.fuchsia },
};

export const FALLBACK_ACTIVITY_META: Meta = { label: "Activity", icon: Eye, group: "changes", tone: TONES.slate };

