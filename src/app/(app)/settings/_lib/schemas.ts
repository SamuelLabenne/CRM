import { z } from "zod";

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Enter a hex color like #4f46e5");

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timezone = z.string().trim().refine(isValidTimezone, "Choose a valid timezone");

export const uuid = z.string().uuid("Invalid id");

/** HH:mm, 00:00–23:59 */
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the format HH:mm");
