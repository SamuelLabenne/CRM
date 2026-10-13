import type { BookingPage } from "@/lib/db/schema";
import type { EventNotifications, FormQuestion, LocationType, RuleGroup } from "@/lib/types";

/** Editable state of the booking page editor (client-safe: plain JSON). */
export type PageDraft = {
  title: string;
  slug: string;
  description: string;
  durationMinutes: number;
  locationType: LocationType;
  location: string;
  meetingUrl: string;
  hostIds: string[];
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  slotIncrementMinutes: number;
  dailyLimit: number | null;
  questions: FormQuestion[];
  disqualifyRules: RuleGroup[];
  disqualifyMessage: string;
  disqualifyRedirectUrl: string;
  confirmationMessage: string;
  redirectUrl: string;
  notifications: EventNotifications;
  campaignId: string | null;
  color: string;
  isActive: boolean;
};

export function pageToDraft(p: BookingPage): PageDraft {
  return {
    title: p.title,
    slug: p.slug,
    description: p.description ?? "",
    durationMinutes: p.durationMinutes,
    locationType: p.locationType,
    location: p.location ?? "",
    meetingUrl: p.meetingUrl ?? "",
    hostIds: p.hostIds,
    bufferBeforeMinutes: p.bufferBeforeMinutes,
    bufferAfterMinutes: p.bufferAfterMinutes,
    minNoticeMinutes: p.minNoticeMinutes,
    maxDaysAhead: p.maxDaysAhead,
    slotIncrementMinutes: p.slotIncrementMinutes,
    dailyLimit: p.dailyLimit,
    questions: p.questions,
    disqualifyRules: p.disqualifyRules,
    disqualifyMessage: p.disqualifyMessage ?? "",
    disqualifyRedirectUrl: p.disqualifyRedirectUrl ?? "",
    confirmationMessage: p.confirmationMessage ?? "",
    redirectUrl: p.redirectUrl ?? "",
    notifications: p.notifications,
    campaignId: p.campaignId,
    color: p.color,
    isActive: p.isActive,
  };
}
