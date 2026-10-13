// Client-safe data shapes shared between server components, server actions and client components.
import type { ActionResult } from "@/lib/action";
import type { ActivityType } from "@/lib/types";

export type ActivityDTO = {
  id: string;
  type: ActivityType;
  title: string;
  body: string | null;
  meta: Record<string, unknown>;
  actorName: string | null;
  actorId: string | null;
  eventId: string | null;
  /** ISO timestamp */
  createdAt: string;
};

/** Result of actions that can fail because another contact already uses the email/phone. */
export type ContactActionResult<T = undefined> =
  | ActionResult<T>
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined>; duplicateId?: string };

export type TagDTO = { id: string; name: string; color: string };
export type UserDTO = { id: string; name: string; color: string };
export type StageDTO = { key: string; label: string; color: string; category: "active" | "won" | "lost" };
export type SavedViewDTO = { id: string; name: string; description: string | null; visibility: "private" | "shared"; ownerId: string | null };

/** One row of the contacts table (dates are pre-formatted on the server to avoid hydration mismatches). */
export type ContactRowDTO = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  stage: string;
  leadStatus: string | null;
  emailStatus: string;
  dealValue: number | null;
  tags: TagDTO[];
  owner: UserDTO | null;
  lastActivity: string;
  created: string;
};

export type RegistrationDTO = {
  attendeeId: string;
  eventId: string;
  title: string;
  kind: "event" | "meeting";
  eventStatus: string;
  status: string;
  rsvp: string | null;
  outcome: string | null;
  source: string;
  /** Pre-formatted in the workspace timezone. */
  when: string;
  isPast: boolean;
};

export type MessageDTO = {
  id: string;
  subject: string;
  kind: string;
  status: string;
  sent: string;
  openCount: number;
  clickCount: number;
  error: string | null;
};
