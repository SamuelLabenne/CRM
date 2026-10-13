import type { EventNotifications, LocationType } from "@/lib/types";

/** Default automatic emails for a new booking page (copied onto every meeting it creates). */
export const DEFAULT_PAGE_NOTIFICATIONS: EventNotifications = {
  confirmation: { enabled: true, templateId: null },
  cancellation: { enabled: true, templateId: null },
  reminders: [
    { id: "r24h", minutesBefore: 24 * 60, templateId: null },
    { id: "r1h", minutesBefore: 60, templateId: null },
  ],
  followUps: [{ id: "f-after", minutesAfter: 60, audience: "attended", templateId: null }],
  notifyHost: true,
};

export const DURATION_PRESETS = [15, 20, 30, 45, 60, 90] as const;
export const INCREMENT_OPTIONS = [5, 10, 15, 20, 30, 45, 60] as const;

export const LOCATION_TYPES: { value: LocationType; label: string }[] = [
  { value: "online", label: "Online (video call)" },
  { value: "phone", label: "Phone call" },
  { value: "in_person", label: "In person" },
];

export function locationLabel(type: LocationType): string {
  return LOCATION_TYPES.find((l) => l.value === type)?.label ?? type;
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Quick-start presets on the "new booking page" screen. */
export const PAGE_PRESETS = [
  { key: "discovery", title: "Discovery call", durationMinutes: 30, description: "A short call to understand your goals and see if we are a good fit." },
  { key: "strategy", title: "Strategy session", durationMinutes: 60, description: "A deep-dive working session to map out your plan." },
  { key: "intro", title: "Quick intro", durationMinutes: 15, description: "A quick hello – tell us what you are looking for." },
] as const;

export const PAGE_COLORS = ["#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#f59e0b", "#10b981", "#14b8a6", "#64748b"];
