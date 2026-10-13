import type { JobHandler } from "@/lib/jobs/handlers";

// AUTOMATIONS MODULE – to be implemented.
//
// Job types:
//  - "automation.trigger" payload { type: TriggerType, contactId, context: TriggerContext }
//      Find active automations whose trigger matches (type + config filters such as
//      tagId / eventId / campaignId / bookingPageId / outcome / stage), respect
//      allowReentry, create automation_runs and start executing steps.
//  - "automation.step" payload { runId }
//      Execute the run's current step and continue; "wait"/"wait_until_event" steps
//      enqueue the next "automation.step" job with a future runAt.

export const automationJobHandlers: Record<string, JobHandler> = {
  "automation.trigger": async () => {
    // Not implemented yet – triggers are ignored.
  },
  "automation.step": async () => {},
};
