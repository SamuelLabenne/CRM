import { desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { listApiKeys } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { webhooks } from "@/lib/db/schema";
import { timeAgo } from "@/lib/format";
import { getSampleDataCounts } from "@/lib/sample-data-cleanup";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import { absoluteUrl } from "@/lib/urls";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { getSystemStatus, heartbeatHealth } from "../_lib/system-status";
import { ApiDocsCard } from "./api-docs";
import { ApiKeysCard, type ApiKeyRow } from "./api-keys-card";
import { DangerZoneCard } from "./danger-zone-card";
import { SystemStatusCard } from "./system-status-card";
import { WebhooksCard, type WebhookRow } from "./webhooks-card";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  await requireAdmin();
  const [hooks, keys, status, sample] = await Promise.all([
    db.select().from(webhooks).orderBy(desc(webhooks.createdAt)),
    listApiKeys(),
    getSystemStatus(),
    getSampleDataCounts(),
  ]);

  const hookRows: WebhookRow[] = hooks.map((h) => ({
    id: h.id,
    url: h.url,
    events: h.events,
    isActive: h.isActive,
    lastDelivery: h.lastDeliveryAt ? timeAgo(h.lastDeliveryAt) : null,
    lastStatus: h.lastStatus,
  }));
  const keyRows: ApiKeyRow[] = keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    created: timeAgo(k.createdAt),
    lastUsed: k.lastUsedAt ? timeAgo(k.lastUsedAt) : "Never",
    revoked: !!k.revokedAt,
  }));

  return (
    <>
      <PageHeader title="Integrations" description="Connect Relay to other tools with webhooks and the REST API, and check that background jobs are running." />
      <PageBody className="w-full max-w-4xl">
        <WebhooksCard hooks={hookRows} eventNames={[...WEBHOOK_EVENTS]} />
        <ApiKeysCard keys={keyRows} />
        <ApiDocsCard baseUrl={absoluteUrl("/api/v1")} />
        <SystemStatusCard
          status={{
            health: heartbeatHealth(status.heartbeatAt),
            heartbeat: status.heartbeatAt ? timeAgo(status.heartbeatAt) : null,
            pending: status.pending,
            running: status.running,
            overdue: status.overdue,
            failed: status.failed,
            failedJobs: status.failedJobs.map((j) => ({ id: j.id, type: j.type, error: j.error, attempts: j.attempts, when: timeAgo(j.at) })),
          }}
        />
        <DangerZoneCard counts={sample} />
      </PageBody>
    </>
  );
}
