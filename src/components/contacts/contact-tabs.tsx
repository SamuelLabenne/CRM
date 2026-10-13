"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays, CheckSquare, History, Mail } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/app/empty-state";
import { ATTENDEE_STATUS, MESSAGE_STATUS, MappedStatus, OUTCOME, StatusBadge } from "@/components/app/status-badge";
import { Journey } from "@/components/contacts/journey";
import { TaskRow } from "@/components/tasks/task-row";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import type { TaskDTO } from "@/components/tasks/types";
import type { ActivityDTO, MessageDTO, RegistrationDTO, StageDTO, UserDTO } from "@/lib/contacts/dto";
import { cn } from "@/lib/utils";

const RSVP_LABEL: Record<string, string> = { yes: "RSVP: yes", no: "RSVP: no", maybe: "RSVP: maybe" };

/** Journey / Events & meetings / Emails / Tasks tabs of the contact card. */
export function ContactTabs({
  contactId,
  contactName,
  contactEmail,
  defaultTab,
  activities,
  hasMoreActivities,
  registrations,
  messages,
  tasks,
  stages,
  users,
  currentUserId,
  isAdmin,
  timezone,
  currency,
}: {
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  defaultTab: string;
  activities: ActivityDTO[];
  hasMoreActivities: boolean;
  registrations: RegistrationDTO[];
  messages: MessageDTO[];
  tasks: TaskDTO[];
  stages: StageDTO[];
  users: UserDTO[];
  currentUserId: string;
  isAdmin: boolean;
  timezone: string;
  currency: string;
}) {
  const [tab, setTab] = useState(["journey", "events", "emails", "tasks"].includes(defaultTab) ? defaultTab : "journey");
  const openTasks = tasks.filter((t) => !t.completed).length;
  const count = (n: number) => (n > 0 ? <span className="rounded-full bg-background/80 px-1.5 text-[11px] tabular-nums text-muted-foreground">{n}</span> : null);

  return (
    <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-4">
      <TabsList className="h-auto w-full justify-start overflow-x-auto sm:w-fit">
        <TabsTrigger value="journey" className="px-3">
          <History /> Journey
        </TabsTrigger>
        <TabsTrigger value="events" className="px-3">
          <CalendarDays /> Events &amp; meetings {count(registrations.length)}
        </TabsTrigger>
        <TabsTrigger value="emails" className="px-3">
          <Mail /> Emails {count(messages.length)}
        </TabsTrigger>
        <TabsTrigger value="tasks" className="px-3">
          <CheckSquare /> Tasks {count(openTasks)}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="journey">
        <Journey
          contactId={contactId}
          initial={activities}
          hasMore={hasMoreActivities}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          timezone={timezone}
          stages={stages}
          currency={currency}
        />
      </TabsContent>

      <TabsContent value="events">
        {registrations.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No events or meetings" description={`${contactName} hasn't registered for an event or booked a meeting yet.`} className="py-10" />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            {registrations.map((r) => (
              <div key={r.attendeeId} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <Link href={`/events/${r.eventId}`} className="block truncate font-medium hover:underline">
                    {r.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {r.kind === "meeting" ? "Meeting" : "Event"} · {r.when}
                    {r.rsvp && ` · ${RSVP_LABEL[r.rsvp] ?? r.rsvp}`} · via {r.source}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.outcome && <MappedStatus map={OUTCOME} value={r.outcome} />}
                  <MappedStatus map={ATTENDEE_STATUS} value={r.status} />
                  {r.eventStatus === "cancelled" && <StatusBadge tone="red">Event cancelled</StatusBadge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="emails">
        {messages.length === 0 ? (
          <EmptyState icon={Mail} title="No emails yet" description={contactEmail ? `Emails sent to ${contactEmail} will be listed here with opens and clicks.` : "This contact has no email address."} className="py-10" />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            {messages.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <Link href={`/emails/outbox/${m.id}`} className="block truncate font-medium hover:underline">
                    {m.subject}
                  </Link>
                  <p className={cn("text-xs text-muted-foreground", m.error && "text-destructive")}>
                    {m.error ? m.error : `${m.sent} · ${m.kind}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {m.openCount > 0 && <span>Opened {m.openCount}×</span>}
                  {m.clickCount > 0 && <span>Clicked {m.clickCount}×</span>}
                  <MappedStatus map={MESSAGE_STATUS} value={m.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="tasks">
        <div className="grid gap-3">
          <div className="flex justify-end">
            <NewTaskButton users={users} currentUserId={currentUserId} timezone={timezone} lockedContact={{ id: contactId, name: contactName, email: contactEmail }} variant="outline" label="Add task" />
          </div>
          {tasks.length === 0 ? (
            <EmptyState icon={CheckSquare} title="No tasks" description="Create a follow-up so nothing slips through." className="py-10" />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} users={users} currentUserId={currentUserId} timezone={timezone} showContact={false} />
              ))}
            </div>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
