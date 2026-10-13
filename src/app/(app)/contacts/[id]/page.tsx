import { notFound } from "next/navigation";
import { desc, eq, isNull } from "drizzle-orm";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { ContactActions } from "@/components/contacts/contact-actions";
import { ContactDetails } from "@/components/contacts/contact-details";
import { ContactSummary } from "@/components/contacts/contact-summary";
import { ContactTabs } from "@/components/contacts/contact-tabs";
import { db } from "@/lib/db";
import { contacts, emailTemplates, eventAttendees, events, messages, tasks } from "@/lib/db/schema";
import { isAdmin, requireUser } from "@/lib/auth";
import { getWorkspace } from "@/lib/settings";
import { formatDateTime, formatInTz, fullName } from "@/lib/format";
import { ACTIVITY_PAGE, listActivities } from "@/lib/contacts/detail";
import { loadReferenceData } from "@/lib/contacts/form-data";
import { tagsByContact } from "@/lib/contacts/query";
import type { MessageDTO, RegistrationDTO } from "@/lib/contacts/dto";
import { queryTasks, toTaskDTO } from "../../tasks/data";

export const metadata = { title: "Contact" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ContactPage({ params, searchParams }: PageProps<"/contacts/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!contact) notFound();
  const sp = await searchParams;

  const [ref, workspace, activityRows, regRows, msgRows, taskRows, tagMap, templateRows] = await Promise.all([
    loadReferenceData(),
    getWorkspace(),
    listActivities(id, { limit: ACTIVITY_PAGE + 1 }),
    db
      .select({ a: eventAttendees, e: events })
      .from(eventAttendees)
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(eq(eventAttendees.contactId, id))
      .orderBy(desc(events.startsAt)),
    db
      .select({
        id: messages.id,
        subject: messages.subject,
        kind: messages.kind,
        status: messages.status,
        error: messages.error,
        sentAt: messages.sentAt,
        createdAt: messages.createdAt,
        openCount: messages.openCount,
        clickCount: messages.clickCount,
      })
      .from(messages)
      .where(eq(messages.contactId, id))
      .orderBy(desc(messages.createdAt))
      .limit(50),
    queryTasks(eq(tasks.contactId, id), { limit: 200 }),
    tagsByContact([id]),
    db
      .select({ id: emailTemplates.id, name: emailTemplates.name, subject: emailTemplates.subject, contentHtml: emailTemplates.contentHtml })
      .from(emailTemplates)
      .where(isNull(emailTemplates.systemKey))
      .orderBy(emailTemplates.name),
  ]);

  const tz = workspace.timezone;
  const now = new Date();
  const name = fullName(contact);
  const tags = tagMap.get(id) ?? [];
  const owner = ref.users.find((u) => u.id === contact.ownerId) ?? null;

  const hasMore = activityRows.length > ACTIVITY_PAGE;
  const activities = hasMore ? activityRows.slice(0, ACTIVITY_PAGE) : activityRows;

  const registrations: RegistrationDTO[] = regRows.map(({ a, e }) => ({
    attendeeId: a.id,
    eventId: e.id,
    title: e.title,
    kind: e.kind,
    eventStatus: e.status,
    status: a.status,
    rsvp: a.rsvp,
    outcome: a.outcome,
    source: a.source,
    when: formatDateTime(e.startsAt, tz),
    isPast: e.endsAt < now,
  }));
  const msgs: MessageDTO[] = msgRows.map((m) => ({
    id: m.id,
    subject: m.subject,
    kind: m.kind,
    status: m.status,
    sent: formatInTz(m.sentAt ?? m.createdAt, tz, "d MMM yyyy, HH:mm"),
    openCount: m.openCount,
    clickCount: m.clickCount,
    error: m.error,
  }));
  const taskDtos = taskRows.map((r) => toTaskDTO(r, tz, now));

  const subtitle = [contact.jobTitle, contact.company].filter(Boolean).join(" at ") || contact.email || "Contact";
  const tab = typeof sp.tab === "string" ? sp.tab : "journey";

  return (
    <>
      <PageHeader
        title={name}
        description={subtitle}
        back={{ href: "/contacts", label: "Contacts" }}
        actions={
          <ContactActions
            contact={{
              id,
              name,
              email: contact.email,
              emailStatus: contact.emailStatus,
              firstName: contact.firstName,
              lastName: contact.lastName,
              company: contact.company,
              jobTitle: contact.jobTitle,
              phone: contact.phone,
            }}
            initialForm={{
              firstName: contact.firstName ?? "",
              lastName: contact.lastName ?? "",
              email: contact.email ?? "",
              phone: contact.phone ?? "",
              company: contact.company ?? "",
              jobTitle: contact.jobTitle ?? "",
              website: contact.website ?? "",
              city: contact.city ?? "",
              country: contact.country ?? "",
              stage: contact.stage,
              ownerId: contact.ownerId ?? "",
              dealValue: contact.dealValue == null ? "" : String(contact.dealValue),
              notes: contact.notes ?? "",
              customFields: contact.customFields ?? {},
              tags: tags.map((t) => t.name),
            }}
            templates={templateRows}
            stages={ref.stages}
            users={ref.users}
            customFields={ref.customFields}
            tagSuggestions={ref.tags}
            currentUserId={user.id}
            timezone={tz}
            workspace={{ name: workspace.name, brandColor: workspace.brandColor }}
          />
        }
      />
      <PageBody className="gap-5">
        <ContactSummary
          contactId={id}
          name={name}
          email={contact.email}
          phone={contact.phone}
          stage={contact.stage}
          leadStatus={contact.leadStatus}
          ownerId={contact.ownerId}
          tags={tags.map((t) => t.name)}
          stages={ref.stages}
          users={ref.users}
          tagSuggestions={ref.tags}
        />
        <div className="grid items-start gap-6 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <div className="order-2 lg:order-1">
            <ContactDetails contact={contact} customFields={ref.customFields} timezone={tz} currency={workspace.currency} ownerName={owner?.name ?? null} />
          </div>
          <div className="order-1 min-w-0 lg:order-2">
            <ContactTabs
              contactId={id}
              contactName={name}
              contactEmail={contact.email}
              defaultTab={tab}
              activities={activities}
              hasMoreActivities={hasMore}
              registrations={registrations}
              messages={msgs}
              tasks={taskDtos}
              stages={ref.stages}
              users={ref.users}
              currentUserId={user.id}
              isAdmin={isAdmin(user)}
              timezone={tz}
              currency={workspace.currency}
            />
          </div>
        </div>
      </PageBody>
    </>
  );
}
