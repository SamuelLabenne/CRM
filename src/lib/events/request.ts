import { headers } from "next/headers";
import { recordPageView, utmFromParams } from "@/lib/leads";
import type { Event } from "@/lib/db/schema";
import type { Utm } from "@/lib/types";

// Request-scoped helpers for the public pages (needs `next/headers`, so it stays out of public.ts).

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|curl|wget|headless|monitor|uptime/i;

export type PublicSearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Prefill values from the query string (?email=&first_name=&last_name=&phone=) and UTM params. */
export function prefillFromParams(params: PublicSearchParams): {
  prefill: { firstName: string; lastName: string; email: string; phone: string };
  utm: Utm;
} {
  return {
    prefill: {
      firstName: first(params.first_name).slice(0, 80),
      lastName: first(params.last_name).slice(0, 80),
      email: first(params.email).slice(0, 200),
      phone: first(params.phone).slice(0, 40),
    },
    utm: utmFromParams(params),
  };
}

/** Record one page view of a public event page (skips obvious bots / link previews). Never throws. */
export async function trackEventView(event: Pick<Event, "id">, utm: Utm) {
  try {
    const h = await headers();
    const ua = h.get("user-agent");
    if (!ua || BOT.test(ua)) return;
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    let referrer = h.get("referer");
    if (referrer) {
      try {
        const u = new URL(referrer);
        referrer = `${u.origin}${u.pathname}`;
      } catch {
        referrer = null;
      }
    }
    await recordPageView({ kind: "event", targetId: event.id, ip, userAgent: ua, referrer, utm });
  } catch (err) {
    console.error("[events] page view not recorded", err);
  }
}
