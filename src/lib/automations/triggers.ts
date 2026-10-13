import { db, type Tx } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/queue";
import type { TriggerContext, TriggerType } from "@/lib/types";

/**
 * Announce that something happened to a contact. Matching active automations
 * are enrolled asynchronously by the "automation.trigger" job handler
 * (src/lib/automations/engine.ts). Cheap to call – always call it.
 */
export async function emitTrigger(
  type: TriggerType,
  contactId: string,
  context: TriggerContext = {},
  tx: Tx = db,
) {
  await enqueueJob("automation.trigger", { type, contactId, context }, {}, tx);
}
