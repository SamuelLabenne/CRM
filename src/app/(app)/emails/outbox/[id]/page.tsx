import Link from "next/link";
import { notFound } from "next/navigation";
import { MousePointerClick, Eye, UserMinus, MailWarning, AlertTriangle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { formatDateTime, timeAgo } from "@/lib/format";
import { getMessageDetail } from "@/lib/email/outbox";
import { prepareForPreviewFrame, stripTrackingFromHtml } from "@/lib/email/html";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { MESSAGE_STATUS, MappedStatus } from "@/components/app/status-badge";
import { MessageViewer } from "@/components/email/message-viewer";
import { KIND_LABEL, OutboxModeBanner } from "../../_components/outbox-tab";

export const metadata = { title: "Email" };

export default async function OutboxMessagePage({ params }: PageProps<"/emails/outbox/[id]">) {
  await requireUser();
  const { id } = await params;
  const detail = await getMessageDetail(id);
  if (!detail) notFound();
  const { message: m, contact, broadcast, automation, event, template, events } = detail;
  const { timezone } = await getSetting("workspace");
  const html = prepareForPreviewFrame(stripTrackingFromHtml(m.html));

  return (
    <>
      <PageHeader
        back={{ href: "/emails?tab=outbox", label: "Outbox" }}
        title={
          <span className="flex items-center gap-3">
            <span className="truncate">{m.subject}</span>
            <MappedStatus map={MESSAGE_STATUS} value={m.status} />
          </span>
        }
        description={`To ${m.toName ? `${m.toName} <${m.toEmail}>` : m.toEmail} · ${formatDateTime(m.sentAt ?? m.createdAt, timezone)}`}
      />
      <PageBody>
        <OutboxModeBanner />
        {m.error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Delivery failed</AlertTitle>
            <AlertDescription>{m.error}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <MessageViewer html={html} text={m.text} />

          <div className="grid content-start gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-3 text-sm">
                  <Row label="Type">
                    <Badge variant="outline" className="font-normal">
                      {KIND_LABEL[m.kind] ?? m.kind}
                    </Badge>
                  </Row>
                  <Row label="To">{m.toName ? `${m.toName} <${m.toEmail}>` : m.toEmail}</Row>
                  <Row label="From">{m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail}</Row>
                  {m.replyTo && <Row label="Reply-to">{m.replyTo}</Row>}
                  <Row label="Provider">
                    {m.provider ?? "—"}
                    {m.providerMessageId && <span className="block truncate text-xs text-muted-foreground">ID {m.providerMessageId}</span>}
                  </Row>
                  <Row label="Created">{formatDateTime(m.createdAt, timezone)}</Row>
                  {m.sentAt && <Row label="Sent">{formatDateTime(m.sentAt, timezone)}</Row>}
                  <Row label="Opens">{m.openCount ? `${m.openCount} (first ${timeAgo(m.openedAt)})` : "None yet"}</Row>
                  <Row label="Clicks">{m.clickCount ? `${m.clickCount} (first ${timeAgo(m.clickedAt)})` : "None yet"}</Row>
                  {contact && (
                    <Row label="Contact">
                      <Link href={`/contacts/${contact.id}`} className="hover:underline">
                        {[contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email}
                      </Link>
                    </Row>
                  )}
                  {broadcast && (
                    <Row label="Broadcast">
                      <Link href={`/emails/broadcasts/${broadcast.id}`} className="hover:underline">
                        {broadcast.name}
                      </Link>
                    </Row>
                  )}
                  {automation && (
                    <Row label="Automation">
                      <Link href={`/automations/${automation.id}`} className="hover:underline">
                        {automation.name}
                      </Link>
                    </Row>
                  )}
                  {event && (
                    <Row label="Event">
                      <Link href={`/events/${event.id}`} className="hover:underline">
                        {event.title}
                      </Link>
                    </Row>
                  )}
                  {template && (
                    <Row label="Template">
                      <Link href={`/emails/templates/${template.id}`} className="hover:underline">
                        {template.name}
                      </Link>
                    </Row>
                  )}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Activity</CardTitle>
                <CardDescription>Opens, clicks and delivery events for this email.</CardDescription>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
                ) : (
                  <ol className="grid gap-3">
                    {events.map((e) => (
                      <li key={e.id} className="flex items-start gap-2.5 text-sm">
                        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          {e.type === "open" ? <Eye className="size-3.5" /> : e.type === "click" ? <MousePointerClick className="size-3.5" /> : e.type === "unsubscribe" ? <UserMinus className="size-3.5" /> : <MailWarning className="size-3.5" />}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium capitalize">{e.type === "click" ? "Clicked a link" : e.type === "open" ? "Opened" : e.type}</div>
                          {e.url && <div className="truncate text-xs text-muted-foreground">{e.url}</div>}
                          <div className="text-xs text-muted-foreground">{formatDateTime(e.createdAt, timezone)}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}
