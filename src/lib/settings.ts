import { cache } from "react";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import type { EmailProvider, Stage } from "@/lib/types";

// ---------------------------------------------------------------------------
// Typed workspace settings stored in the `settings` key/value table.
// ---------------------------------------------------------------------------

export type WorkspaceSettings = {
  name: string;
  timezone: string;
  brandColor: string;
  logoUrl: string | null;
  /** Postal address shown in marketing email footers (anti-spam requirement). */
  address: string;
  currency: string;
  weekStartsOn: 0 | 1;
};

export type EmailSettings = {
  provider: EmailProvider;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  /** Encrypted with encryptSecret(). */
  resendApiKey: string | null;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    /** Encrypted with encryptSecret(). */
    password: string | null;
  } | null;
  /** Add open-pixel & click tracking to emails. */
  tracking: boolean;
  /**
   * Test mode: real delivery only to team members and `testRecipients`; every other email is
   * simulated (logged in the outbox). Protects real contacts while trying things out.
   */
  testMode: boolean;
  testRecipients: string[];
  /** Max emails delivered through the provider per rolling 24h (null = unlimited). */
  dailyLimit: number | null;
};

export type SettingsMap = {
  workspace: WorkspaceSettings;
  email: EmailSettings;
  stages: Stage[];
  /** Last time background jobs were processed (used for opportunistic processing). */
  jobsHeartbeat: { at: string | null };
  /**
   * Ids of every row created by the sample-data loader, per table name ("contacts",
   * "campaigns", "events", "booking_pages", "email_templates", "broadcasts", "automations",
   * "tasks", "tags", "saved_views"). Used by deleteSampleData() (src/lib/sample-data-cleanup.ts).
   */
  sampleData: { ids: Record<string, string[]> };
};

export const DEFAULT_STAGES: Stage[] = [
  { key: "new", label: "New lead", color: "#64748b", category: "active" },
  { key: "contacted", label: "Contacted", color: "#3b82f6", category: "active" },
  { key: "engaged", label: "Engaged", color: "#8b5cf6", category: "active" },
  { key: "follow_up", label: "Follow-up", color: "#f59e0b", category: "active" },
  { key: "customer", label: "Customer", color: "#10b981", category: "won" },
  { key: "lost", label: "Lost", color: "#ef4444", category: "lost" },
];

export const DEFAULT_SETTINGS: SettingsMap = {
  workspace: {
    name: "Relay",
    timezone: "Australia/Perth",
    brandColor: "#4f46e5",
    logoUrl: null,
    address: "",
    currency: "AUD",
    weekStartsOn: 1,
  },
  email: {
    // A server-provided Resend key (RESEND_API_KEY) makes real sending the default;
    // EMAIL_FROM must be an address on a domain verified in Resend.
    provider: process.env.RESEND_API_KEY ? "resend" : "outbox",
    fromName: "Relay",
    fromEmail: process.env.EMAIL_FROM || "hello@example.com",
    replyTo: null,
    resendApiKey: null,
    smtp: null,
    tracking: true,
    testMode: process.env.EMAIL_TEST_MODE === "1",
    testRecipients: [],
    dailyLimit: process.env.EMAIL_DAILY_LIMIT ? Number(process.env.EMAIL_DAILY_LIMIT) || null : null,
  },
  stages: DEFAULT_STAGES,
  jobsHeartbeat: { at: null },
  sampleData: { ids: {} },
};

type Key = keyof SettingsMap;

async function load<K extends Key>(keys: K[]): Promise<Pick<SettingsMap, K>> {
  const rows = await db.select().from(settings).where(inArray(settings.key, keys));
  const out = {} as Pick<SettingsMap, K>;
  for (const k of keys) {
    const row = rows.find((r) => r.key === k);
    const def = DEFAULT_SETTINGS[k];
    // Merge objects with defaults so newly added fields always have a value.
    out[k] = (
      row
        ? Array.isArray(def)
          ? row.value
          : { ...(def as object), ...(row.value as object) }
        : def
    ) as SettingsMap[K];
  }
  return out;
}

/** Read one settings section (memoized per request). */
export const getSetting = cache(async <K extends Key>(key: K): Promise<SettingsMap[K]> => {
  const res = await load([key]);
  return res[key];
});

export async function getWorkspace() {
  return getSetting("workspace");
}

export async function getStages() {
  return getSetting("stages");
}

/** Replace (or shallow-merge for objects) a settings section. */
export async function setSetting<K extends Key>(key: K, value: Partial<SettingsMap[K]> | SettingsMap[K]) {
  const current = (await load([key]))[key];
  const next = Array.isArray(current) ? value : { ...(current as object), ...(value as object) };
  await db
    .insert(settings)
    .values({ key, value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value`, updatedAt: new Date() } });
  return next as SettingsMap[K];
}
