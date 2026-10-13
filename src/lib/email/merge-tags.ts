// Merge tags: {{contact.first_name}} or with a fallback {{contact.first_name | "there"}}.
// This file is safe to import from client components (editor insert menu, previews).

export type MergeTagDef = { key: string; label: string; sample: string };
export type MergeTagGroup = { group: string; tags: MergeTagDef[] };

export const MERGE_TAG_GROUPS: MergeTagGroup[] = [
  {
    group: "Contact",
    tags: [
      { key: "contact.first_name", label: "First name", sample: "Ada" },
      { key: "contact.last_name", label: "Last name", sample: "Lovelace" },
      { key: "contact.full_name", label: "Full name", sample: "Ada Lovelace" },
      { key: "contact.email", label: "Email", sample: "ada@example.com" },
      { key: "contact.company", label: "Company", sample: "Analytical Engines" },
      { key: "contact.job_title", label: "Job title", sample: "Mathematician" },
      { key: "contact.phone", label: "Phone", sample: "+61 400 000 000" },
    ],
  },
  {
    group: "Event / meeting",
    tags: [
      { key: "event.title", label: "Event title", sample: "Growth Workshop" },
      { key: "event.date", label: "Date", sample: "Thursday 22 October 2026" },
      { key: "event.time", label: "Start time", sample: "10:00 AWST" },
      { key: "event.end_time", label: "End time", sample: "11:00 AWST" },
      { key: "event.location", label: "Location", sample: "Online" },
      { key: "event.join_url", label: "Join link", sample: "https://meet.example.com/abc" },
      { key: "event.host_name", label: "Host name", sample: "Sam" },
      { key: "event.description", label: "Description", sample: "A hands-on session." },
    ],
  },
  {
    group: "Registration links",
    tags: [
      { key: "attendee.manage_url", label: "Manage registration link", sample: "https://app.example.com/m/abc" },
      { key: "attendee.cancel_url", label: "Cancel link", sample: "https://app.example.com/m/abc?action=cancel" },
      { key: "attendee.rsvp_yes_url", label: "RSVP yes link", sample: "https://app.example.com/m/abc?rsvp=yes" },
      { key: "attendee.rsvp_no_url", label: "RSVP no link", sample: "https://app.example.com/m/abc?rsvp=no" },
      { key: "attendee.calendar_url", label: "Add to calendar (.ics)", sample: "https://app.example.com/api/ics/attendee/abc" },
      { key: "attendee.google_calendar_url", label: "Add to Google Calendar", sample: "https://calendar.google.com/…" },
    ],
  },
  {
    group: "Workspace",
    tags: [
      { key: "workspace.name", label: "Workspace name", sample: "Relay" },
      { key: "unsubscribe_url", label: "Unsubscribe link", sample: "https://app.example.com/u/abc" },
    ],
  },
];

export type MergeContext = {
  contact?: Record<string, string | null | undefined>;
  event?: Record<string, string | null | undefined>;
  attendee?: Record<string, string | null | undefined>;
  answers?: Record<string, string | null | undefined>;
  workspace?: Record<string, string | null | undefined>;
  unsubscribe_url?: string;
  [key: string]: unknown;
};

/** Context filled with sample values – used for previews and test sends. */
export function sampleMergeContext(): MergeContext {
  const ctx: Record<string, Record<string, string> | string> = {};
  for (const g of MERGE_TAG_GROUPS) {
    for (const t of g.tags) {
      const [head, tail] = t.key.split(".");
      if (!tail) ctx[head] = t.sample;
      else ((ctx[head] ??= {}) as Record<string, string>)[tail] = t.sample;
    }
  }
  return ctx as MergeContext;
}

const TAG_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*(?:"([^"]*)"|'([^']*)'|&quot;(.*?)&quot;|([^}]*?)))?\s*\}\}/g;

function lookup(ctx: MergeContext, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), ctx);
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Replace merge tags. In HTML mode values are escaped. Unknown tags become the fallback or "". */
export function applyMergeTags(input: string, ctx: MergeContext, opts: { html: boolean } = { html: true }): string {
  return input.replace(TAG_RE, (_m, key: string, f1?: string, f2?: string, f3?: string, f4?: string) => {
    const raw = lookup(ctx, key);
    const fallback = (f1 ?? f2 ?? f3 ?? f4 ?? "").trim();
    const value = raw == null || raw === "" ? fallback : Array.isArray(raw) ? raw.join(", ") : String(raw);
    return opts.html ? escapeHtml(value) : value;
  });
}

/** List of merge tag keys used in a string (for validation/warnings). */
export function extractMergeTags(input: string): string[] {
  return [...input.matchAll(TAG_RE)].map((m) => m[1]);
}
