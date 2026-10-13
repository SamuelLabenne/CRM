import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "violet" | "sky";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  red: "bg-red-500/10 text-red-700 dark:text-red-300",
  violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  sky: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  violet: "bg-violet-500",
  sky: "bg-sky-500",
};

/** Small status pill with a colored dot. */
export function StatusBadge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("gap-1.5 border-0 font-medium", TONES[tone], className)}>
      <span className={cn("size-1.5 rounded-full", DOTS[tone])} />
      {children}
    </Badge>
  );
}

/** Pill colored with an arbitrary hex color (tags, stages). */
export function ColorBadge({ color, children, className }: { color: string; children: React.ReactNode; className?: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn("gap-1.5 border-0 font-medium", className)}
      style={{ background: `color-mix(in oklch, ${color} 14%, transparent)`, color: `color-mix(in oklch, ${color} 80%, var(--foreground))` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {children}
    </Badge>
  );
}

// Common status → tone mappings so every module shows statuses consistently.
export const ATTENDEE_STATUS: Record<string, { label: string; tone: Tone }> = {
  registered: { label: "Registered", tone: "blue" },
  confirmed: { label: "Confirmed", tone: "violet" },
  waitlisted: { label: "Waitlisted", tone: "amber" },
  attended: { label: "Attended", tone: "green" },
  no_show: { label: "No-show", tone: "red" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const EVENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "blue" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "red" },
};

export const CAMPAIGN_STATUS: Record<string, { label: string; tone: Tone }> = {
  planned: { label: "Planned", tone: "sky" },
  active: { label: "Active", tone: "green" },
  completed: { label: "Completed", tone: "violet" },
  archived: { label: "Archived", tone: "neutral" },
};

export const LEAD_STATUS: Record<string, { label: string; tone: Tone }> = {
  potential: { label: "Potential", tone: "amber" },
  qualified: { label: "Qualified", tone: "sky" },
  disqualified: { label: "Disqualified", tone: "red" },
  registered: { label: "Registered", tone: "blue" },
  booked: { label: "Booked", tone: "green" },
};

export const MESSAGE_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "neutral" },
  sent: { label: "Sent", tone: "green" },
  simulated: { label: "Simulated", tone: "sky" },
  failed: { label: "Failed", tone: "red" },
  bounced: { label: "Bounced", tone: "red" },
};

export const BROADCAST_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "amber" },
  sending: { label: "Sending", tone: "blue" },
  sent: { label: "Sent", tone: "green" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "red" },
};

export const AUTOMATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "green" },
  paused: { label: "Paused", tone: "amber" },
};

export const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  won: { label: "Won", tone: "green" },
  lost: { label: "Lost", tone: "red" },
  follow_up: { label: "Follow-up", tone: "amber" },
  not_qualified: { label: "Not qualified", tone: "neutral" },
  no_show: { label: "No-show", tone: "red" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function MappedStatus({ map, value }: { map: Record<string, { label: string; tone: Tone }>; value: string | null | undefined }) {
  if (!value) return null;
  const s = map[value] ?? { label: value, tone: "neutral" as Tone };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}
