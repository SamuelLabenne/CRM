import { getSetting } from "@/lib/settings";
import type { EmailBranding } from "@/components/email/types";

/** Workspace branding for client-side email previews. */
export async function getBranding(): Promise<EmailBranding> {
  const w = await getSetting("workspace");
  return { name: w.name, brandColor: w.brandColor, logoUrl: w.logoUrl, address: w.address || null };
}
