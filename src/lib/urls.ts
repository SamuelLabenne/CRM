import { sign } from "@/lib/crypto";

/** Absolute base URL of the app (no trailing slash). */
export function appBaseUrl(): string {
  const explicit = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function absoluteUrl(path: string): string {
  return `${appBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

// Public pages
export const eventPublicPath = (slug: string) => `/e/${slug}`;
export const bookingPublicPath = (slug: string) => `/book/${slug}`;
/** Attendee self-service page: view details, RSVP, cancel, add to calendar. */
export const attendeeManagePath = (token: string) => `/m/${token}`;
export const attendeeRsvpPath = (token: string, rsvp: "yes" | "no" | "maybe") => `/m/${token}?rsvp=${rsvp}`;
export const attendeeCancelPath = (token: string) => `/m/${token}?action=cancel`;
export const attendeeIcsPath = (token: string) => `/api/ics/attendee/${token}`;
export const unsubscribePath = (token: string) => `/u/${token}`;
/** Personal calendar feed (subscribe from Google/Outlook/Apple Calendar). */
export const calendarFeedPath = (token: string) => `/api/ics/feed/${token}`;

// Email tracking
export const trackOpenPath = (messageId: string) => `/api/t/o/${messageId}`;
export function trackClickPath(messageId: string, url: string) {
  return `/api/t/c/${messageId}?u=${encodeURIComponent(url)}&s=${sign(`${messageId}|${url}`)}`;
}
