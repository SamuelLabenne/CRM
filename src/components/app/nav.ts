import {
  BarChart3,
  CalendarDays,
  CalendarClock,
  CheckSquare,
  Columns3,
  LayoutDashboard,
  Mail,
  Megaphone,
  Settings,
  Ticket,
  Users,
  Workflow,
  Video,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { title: string; href: string; icon: LucideIcon; description?: string };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, description: "KPIs, funnel and what needs attention" },
      { title: "Calendar", href: "/calendar", icon: CalendarDays, description: "Events, meetings, campaigns and sends" },
      { title: "Reports", href: "/reports", icon: BarChart3, description: "Attendance, email and campaign performance" },
    ],
  },
  {
    label: "CRM",
    items: [
      { title: "Contacts", href: "/contacts", icon: Users, description: "People, smart views, import & export" },
      { title: "Pipeline", href: "/pipeline", icon: Columns3, description: "Contacts by stage" },
      { title: "Tasks", href: "/tasks", icon: CheckSquare, description: "Follow-ups and to-dos" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { title: "Campaigns", href: "/campaigns", icon: Megaphone, description: "Group events and sends into campaigns" },
      { title: "Events", href: "/events", icon: Ticket, description: "Registrations, attendance and check-in" },
      { title: "Emails", href: "/emails", icon: Mail, description: "Templates, broadcasts and outbox" },
      { title: "Automations", href: "/automations", icon: Workflow, description: "Triggered email sequences and actions" },
    ],
  },
  {
    label: "Scheduling",
    items: [
      { title: "Booking pages", href: "/scheduling", icon: CalendarClock, description: "Qualified 1:1 booking links" },
      { title: "Meetings", href: "/meetings", icon: Video, description: "Booked meetings and outcomes" },
    ],
  },
];

export const SETTINGS_NAV: NavItem = { title: "Settings", href: "/settings", icon: Settings };
