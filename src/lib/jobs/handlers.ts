import type { Job } from "@/lib/db/schema";
import { automationJobHandlers } from "@/lib/automations/engine";
import { eventJobHandlers } from "@/lib/events/notifications";
import { broadcastJobHandlers } from "@/lib/email/broadcasts";
import { webhookJobHandlers } from "@/lib/webhooks";

export type JobHandler = (payload: Record<string, unknown>, job: Job) => Promise<void>;

/**
 * Registry of background job types. Each module exports its own handler map;
 * add new maps here rather than editing other modules' handlers.
 */
export const jobHandlers: Record<string, JobHandler> = {
  ...automationJobHandlers,
  ...eventJobHandlers,
  ...broadcastJobHandlers,
  ...webhookJobHandlers,
};
