"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ExternalLink, History, Loader2, PhoneCall, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { OUTCOME, StatusBadge } from "@/components/app/status-badge";
import { ACTIVITY_GROUPS, ACTIVITY_META, FALLBACK_ACTIVITY_META, type ActivityGroup } from "@/components/contacts/activity-meta";
import { addNoteAction, deleteActivityAction, loadMoreActivitiesAction } from "@/app/(app)/contacts/actions";
import { formatInTz, formatMoney, timeAgo } from "@/lib/format";
import type { ActivityDTO, StageDTO } from "@/lib/contacts/dto";
import { cn } from "@/lib/utils";

/**
 * The contact's journey: newest-first timeline grouped by day, with an inline note/call composer
 * and a type filter. Entries link to events (/events/<id>) and sent emails (/emails/outbox/<id>).
 */
export function Journey({
  contactId,
  initial,
  hasMore: initialHasMore,
  currentUserId,
  isAdmin,
  timezone,
  stages,
  currency,
}: {
  contactId: string;
  initial: ActivityDTO[];
  hasMore: boolean;
  currentUserId: string;
  isAdmin: boolean;
  timezone: string;
  stages: StageDTO[];
  currency: string;
}) {
  const router = useRouter();
  const [extra, setExtra] = useState<ActivityDTO[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [filter, setFilter] = useState<ActivityGroup | "all">("all");
  const [loadingMore, startLoadMore] = useTransition();

  const items = useMemo(() => {
    const map = new Map<string, ActivityDTO>();
    for (const a of [...extra, ...initial]) map.set(a.id, a);
    return [...map.values()]
      .filter((a) => !removed.has(a.id))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }, [extra, initial, removed]);

  const counts = useMemo(() => {
    const c: Partial<Record<ActivityGroup, number>> = {};
    for (const a of items) {
      const g = (ACTIVITY_META[a.type] ?? FALLBACK_ACTIVITY_META).group;
      c[g] = (c[g] ?? 0) + 1;
    }
    return c;
  }, [items]);

  const visible = filter === "all" ? items : items.filter((a) => (ACTIVITY_META[a.type] ?? FALLBACK_ACTIVITY_META).group === filter);

  // Group by calendar day in the workspace timezone.
  const days = useMemo(() => {
    const groups: { day: string; items: ActivityDTO[] }[] = [];
    for (const a of visible) {
      const day = formatInTz(a.createdAt, timezone, "yyyy-MM-dd");
      const last = groups[groups.length - 1];
      if (last?.day === day) last.items.push(a);
      else groups.push({ day, items: [a] });
    }
    return groups;
  }, [visible, timezone]);

  const loadMore = () =>
    startLoadMore(async () => {
      const oldest = items[items.length - 1];
      if (!oldest) return;
      const older = await loadMoreActivitiesAction(contactId, oldest.createdAt);
      setExtra((prev) => [...prev, ...older]);
      if (older.length < 100) setHasMore(false);
    });

  const stageLabel = (key: unknown) => stages.find((s) => s.key === key)?.label ?? String(key ?? "");

  return (
    <div className="grid gap-5">
      <Composer
        contactId={contactId}
        onAdded={(a) => {
          setExtra((prev) => [a, ...prev]);
          setFilter("all");
          router.refresh();
        }}
      />

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter timeline by type">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          All <span className="opacity-60">{items.length}</span>
        </FilterChip>
        {ACTIVITY_GROUPS.filter((g) => counts[g.key]).map((g) => (
          <FilterChip key={g.key} active={filter === g.key} onClick={() => setFilter(g.key)}>
            {g.label} <span className="opacity-60">{counts[g.key]}</span>
          </FilterChip>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={History}
          title={items.length ? "Nothing of this type yet" : "No activity yet"}
          description={items.length ? "Try another filter." : "Notes, emails, events and changes will appear here as they happen."}
          className="py-10"
        />
      ) : (
        <div className="grid gap-6">
          {days.map(({ day, items: dayItems }) => (
            <section key={day} aria-label={dayLabel(day, timezone)}>
              <h3 className="sticky top-14 z-10 -mx-1 mb-3 bg-background/90 px-1 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur" suppressHydrationWarning>
                {dayLabel(day, timezone)}
              </h3>
              <ol className="relative grid gap-4 before:absolute before:top-2 before:bottom-2 before:left-4 before:w-px before:bg-border">
                {dayItems.map((a) => (
                  <TimelineItem
                    key={a.id}
                    a={a}
                    timezone={timezone}
                    stageLabel={stageLabel}
                    currency={currency}
                    canDelete={(a.type === "note" || a.type === "call") && (isAdmin || a.actorId === currentUserId)}
                    onDeleted={() => setRemoved((prev) => new Set(prev).add(a.id))}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="animate-spin" /> : <History />} Load older activity
          </Button>
        </div>
      )}
    </div>
  );
}

function dayLabel(day: string, tz: string) {
  const today = formatInTz(new Date(), tz, "yyyy-MM-dd");
  const yesterday = formatInTz(new Date(Date.now() - 864e5), tz, "yyyy-MM-dd");
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return formatInTz(`${day}T12:00:00Z`, "UTC", "EEEE d MMMM yyyy");
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Composer({ contactId, onAdded }: { contactId: string; onAdded: (a: ActivityDTO) => void }) {
  const [type, setType] = useState<"note" | "call">("note");
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    if (!body.trim()) return;
    start(async () => {
      const res = await addNoteAction(contactId, { type, body });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Added");
      setBody("");
      if (res.data) onAdded(res.data);
    });
  };

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 inline-flex rounded-lg bg-muted p-0.5 text-sm" role="tablist" aria-label="Entry type">
        {(
          [
            ["note", "Note", StickyNote],
            ["call", "Call", PhoneCall],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={type === key}
            onClick={() => setType(key)}
            className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors", type === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>
      <Textarea
        id="journey-note"
        aria-label={type === "call" ? "Call notes" : "Note"}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={type === "call" ? "What was discussed? Outcome, next steps…" : "Write a note about this contact…"}
        rows={3}
        maxLength={10000}
        className="resize-none"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">⌘/Ctrl + Enter to save</span>
        <Button size="sm" className="ml-auto" onClick={submit} disabled={pending || !body.trim()}>
          {pending && <Spinner />} {type === "call" ? "Log call" : "Add note"}
        </Button>
      </div>
    </div>
  );
}

function TimelineItem({
  a,
  timezone,
  stageLabel,
  currency,
  canDelete,
  onDeleted,
}: {
  a: ActivityDTO;
  timezone: string;
  stageLabel: (k: unknown) => string;
  currency: string;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const meta = ACTIVITY_META[a.type] ?? FALLBACK_ACTIVITY_META;
  const Icon = meta.icon;
  const m = a.meta;
  const eventId = a.eventId ?? (typeof m.eventId === "string" ? m.eventId : null);
  const messageId = typeof m.messageId === "string" ? m.messageId : null;
  const isNote = a.type === "note" || a.type === "call";
  const exact = formatInTz(a.createdAt, timezone, "EEE d MMM yyyy, HH:mm");

  let title: React.ReactNode = a.title;
  if (a.type === "stage_changed" && (m.from || m.to)) {
    title = (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        Stage changed <StatusBadge tone="neutral">{stageLabel(m.from)}</StatusBadge>
        <ArrowRight className="size-3 text-muted-foreground" />
        <StatusBadge tone="violet">{stageLabel(m.to)}</StatusBadge>
      </span>
    );
  } else if (isNote) {
    title = a.type === "call" ? "Logged a call" : "Added a note";
  }

  return (
    <li className="relative flex gap-3">
      <span className={cn("relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-background", meta.tone)} title={meta.label}>
        <Icon className="size-4" />
      </span>
      <div className={cn("min-w-0 flex-1", isNote && "rounded-xl border bg-card p-3")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="min-w-0 text-sm font-medium break-words">{title}</p>
          <time dateTime={a.createdAt} title={exact} className="shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
            {timeAgo(a.createdAt)}
          </time>
        </div>
        {a.body && <p className={cn("mt-1 text-sm whitespace-pre-wrap break-words", isNote ? "text-foreground" : "text-muted-foreground")}>{a.body}</p>}

        {a.type === "meeting_outcome" && typeof m.outcome === "string" && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge tone={OUTCOME[m.outcome]?.tone ?? "neutral"}>{OUTCOME[m.outcome]?.label ?? m.outcome}</StatusBadge>
            {typeof m.objection === "string" && m.objection !== "no_objection" && <span>Objection: {m.objection.replace("_", " ")}</span>}
            {typeof m.dealValue === "number" && <span>Deal value {formatMoney(m.dealValue, currency)}</span>}
          </div>
        )}
        {a.type === "email_clicked" && typeof m.url === "string" && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            <ExternalLink className="mr-1 inline size-3" />
            {m.url}
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {a.actorName && <span>by {a.actorName}</span>}
          {a.type === "email_sent" && m.simulated === true && <StatusBadge tone="sky">Simulated</StatusBadge>}
          {messageId && (
            <Link href={`/emails/outbox/${messageId}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              View email <ExternalLink className="size-3" />
            </Link>
          )}
          {eventId && (
            <Link href={`/events/${eventId}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              View {a.type.startsWith("meeting") ? "meeting" : "event"} <ExternalLink className="size-3" />
            </Link>
          )}
          {isNote && canDelete && (
            <ConfirmDialog
              destructive
              title={a.type === "call" ? "Delete this call log?" : "Delete this note?"}
              description="It will be removed from the contact's journey."
              confirmLabel="Delete"
              onConfirm={async () => {
                const res = await deleteActivityAction(a.id);
                if (res.ok) {
                  onDeleted();
                  toast.success(res.message ?? "Deleted");
                } else toast.error(res.error);
              }}
              trigger={
                <button type="button" className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-destructive" aria-label="Delete entry">
                  <Trash2 className="size-3" /> Delete
                </button>
              }
            />
          )}
        </div>
      </div>
    </li>
  );
}
