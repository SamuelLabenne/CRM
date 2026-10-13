// Dependency-free copies of the normalisation helpers in src/lib/contacts/index.ts, usable from
// client components (index.ts imports the database). Behaviour must stay identical.

export function normalizeEmailLoose(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function normalizePhoneLoose(phone: string | null | undefined): string | null {
  const p = (phone ?? "").trim();
  if (!p) return null;
  const digits = p.replace(/[^\d+]/g, "");
  return digits.length >= 6 ? digits : null;
}

export function splitNameLoose(name: string | null | undefined): { firstName: string | null; lastName: string | null } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null, lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || null };
}
