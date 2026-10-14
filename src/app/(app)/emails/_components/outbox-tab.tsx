import Link from "next/link";
import { Inbox, Info } from "lucide-react";
import { getSetting } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { listMessages } from "@/lib/email/outbox";
import { OUTBOX_KINDS, OUTBOX_STATUSES } from "@/lib/email/schemas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/app/empty-state";
import { MESSAGE_STATUS, MappedStatus } from "@/components/app/status-badge";
import { Pager } from "@/components/email/pager";
import { UrlFilters } from "@/components/email/url-filters";
import { Badge } from "@/components/ui/badge";

const PAGE_SIZE = 50;

export const KIND_LABEL: Record<string, string> = {
  broadcast: "Broadcast",
  automation: "Automation",
  notification: "Notification",
  transactional: "Transactional",
  test: "Test",
  manual: "Manual",
};

/** Banner explaining simulated sending, shown on the outbox list and detail pages. */
export async function OutboxModeBanner() {
  const email = await getSetting("email");
  if (email.provider !== "outbox" && email.testMode) {
    return (
      <Alert>
        <Info />
        <AlertTitle>Test mode is on</AlertTitle>
        <AlertDescription>
          Only team members{email.testRecipients.length ? " and your test recipients" : ""} receive real email; everything else is logged here as
          simulated.{" "}
          <Link href="/settings/email" className="font-medium text-foreground underline underline-offset-4">
            Turn off test mode in Settings → Email
          </Link>{" "}
          when you go live.
        </AlertDescription>
      </Alert>
    );
  }
  if (email.provider !== "outbox") return null;
  return (
    <Alert>
      <Info />
      <AlertTitle>Emails are simulated</AlertTitle>
      <AlertDescription>
        Relay is in Outbox mode, so nothing is delivered to real inboxes. Every email is recorded here so you can check content, links and merge tags.{" "}
        <Link href="/settings/email" className="font-medium text-foreground underline underline-offset-4">
          Connect Resend or SMTP in Settings → Email
        </Link>{" "}
        to send for real.
      </AlertDescription>
    </Alert>
  );
}

export async function OutboxTab({ q, kind, status, page }: { q?: string; kind?: string; status?: string; page: number }) {
  const { timezone } = await getSetting("workspace");
  const { rows, total } = await listMessages({ q, kind, status, page, pageSize: PAGE_SIZE });
  const filtered = Boolean(q || kind || status);

  return (
    <div className="grid gap-4">
      <OutboxModeBanner />
      <UrlFilters
        fields={[
          { type: "search", name: "q", placeholder: "Search by recipient or subject…" },
          { type: "select", name: "kind", label: "All types", options: OUTBOX_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })) },
          { type: "select", name: "status", label: "All statuses", options: OUTBOX_STATUSES.map((s) => ({ value: s, label: MESSAGE_STATUS[s].label })) },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={filtered ? "No emails match" : "No emails yet"}
          description={
            filtered
              ? "Try a different search or clear the filters."
              : "Every email Relay sends or simulates (broadcasts, automations, event confirmations and tests) is recorded here."
          }
        />
      ) : (
        <Card className="gap-0 p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Recipient</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Opens</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Clicks</TableHead>
                <TableHead className="pr-4 text-right">Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id} className="relative">
                  <TableCell className="max-w-56 pl-4">
                    <Link href={`/emails/outbox/${m.id}`} className="block truncate font-medium after:absolute after:inset-0 hover:underline">
                      {m.toName || m.toEmail}
                    </Link>
                    {m.toName && <div className="truncate text-xs text-muted-foreground">{m.toEmail}</div>}
                  </TableCell>
                  <TableCell className="max-w-72 truncate">{m.subject}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant="outline" className="font-normal">
                      {KIND_LABEL[m.kind] ?? m.kind}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <MappedStatus map={MESSAGE_STATUS} value={m.status} />
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{m.openCount || "—"}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{m.clickCount || "—"}</TableCell>
                  <TableCell className="pr-4 text-right whitespace-nowrap text-muted-foreground">{formatDateTime(m.sentAt ?? m.createdAt, timezone)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pager basePath="/emails" params={{ tab: "outbox", q, kind, status }} page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  );
}
