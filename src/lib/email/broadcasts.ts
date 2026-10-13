import type { JobHandler } from "@/lib/jobs/handlers";

// EMAIL MODULE – broadcast sending, to be implemented.
//
// Job types:
//  - "broadcast.send" payload { broadcastId }
//      Resolve the audience (src/lib/audience.ts), send to each recipient with
//      sendEmail({ kind: "broadcast", broadcastId, marketing: true }), update
//      recipientCount / status / sentAt. Must be resumable (skip contacts that
//      already have a message for this broadcast) because large sends may be
//      split across several job runs.

export const broadcastJobHandlers: Record<string, JobHandler> = {
  "broadcast.send": async () => {},
};
