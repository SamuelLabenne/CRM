import { audienceSchema } from "@/lib/email/schemas";
import type { Audience, AttendeeStatus } from "@/lib/types";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: AttendeeStatus[] = ["registered", "confirmed", "waitlisted", "attended", "no_show", "cancelled"];

function tryParseAudience(raw: string): Audience | null {
  const candidates: string[] = [raw];
  try {
    candidates.push(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    // not base64
  }
  for (const c of candidates) {
    try {
      const parsed = audienceSchema.safeParse(JSON.parse(c));
      if (parsed.success) return parsed.data as Audience;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Prefill an audience for /emails/broadcasts/new from the query string so other modules can deep-link:
 *  ?audience=<json or base64url json> | ?eventId=<id>[&statuses=attended,no_show] | ?campaignId=<id>
 *  | ?tagId=<id>[,<id>] | ?viewId=<id> | ?contactId=<id>[,<id>]
 * (short aliases: event, campaign, tag, view, contact)
 */
export function audienceFromSearchParams(sp: SP): Audience | null {
  const raw = first(sp.audience);
  if (raw) {
    const a = tryParseAudience(raw);
    if (a) return a;
  }
  const eventId = first(sp.eventId) ?? first(sp.event);
  if (eventId && UUID.test(eventId)) {
    const statuses = (first(sp.statuses) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is AttendeeStatus => STATUSES.includes(s as AttendeeStatus));
    return { type: "event", eventId, statuses };
  }
  const campaignId = first(sp.campaignId) ?? first(sp.campaign);
  if (campaignId && UUID.test(campaignId)) return { type: "campaign", campaignId };
  const tagIds = (first(sp.tagId) ?? first(sp.tag) ?? first(sp.tagIds) ?? "").split(",").filter((s) => UUID.test(s));
  if (tagIds.length) return { type: "tags", tagIds, match: "any" };
  const viewId = first(sp.viewId) ?? first(sp.view);
  if (viewId && UUID.test(viewId)) return { type: "view", viewId };
  const contactIds = (first(sp.contactId) ?? first(sp.contact) ?? first(sp.contactIds) ?? "").split(",").filter((s) => UUID.test(s));
  if (contactIds.length) return { type: "contacts", contactIds };
  return null;
}

export function isUuid(v: string | undefined): v is string {
  return Boolean(v && UUID.test(v));
}
