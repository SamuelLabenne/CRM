// Client-safe campaign constants (no database imports).
import type { CampaignStatus, CampaignType } from "@/lib/types";

export const CAMPAIGN_TYPES: { value: CampaignType; label: string }[] = [
  { value: "event_series", label: "Event series" },
  { value: "webinar", label: "Webinar" },
  { value: "conference", label: "Conference" },
  { value: "email", label: "Email" },
  { value: "outreach", label: "Outreach" },
  { value: "social", label: "Social" },
  { value: "ads", label: "Paid ads" },
  { value: "other", label: "Other" },
];
export const CAMPAIGN_TYPE_LABEL = Object.fromEntries(CAMPAIGN_TYPES.map((t) => [t.value, t.label])) as Record<string, string>;
export const CAMPAIGN_STATUSES: CampaignStatus[] = ["planned", "active", "completed", "archived"];
