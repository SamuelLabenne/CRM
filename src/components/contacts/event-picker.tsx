"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarDays, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { searchEventsAction } from "@/app/(app)/actions";
import { formatInTz } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PickedEvent = { id: string; title: string; startsAt: Date | string };

/** Inline searchable list of events (not meetings) for "Add to event". */
export function EventPicker({
  value,
  onChange,
  timezone,
}: {
  value: PickedEvent | null;
  onChange: (e: PickedEvent | null) => void;
  timezone: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<(PickedEvent & { kind: string })[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    const t = setTimeout(
      () =>
        start(async () => {
          const rows = await searchEventsAction(q, 30);
          setHits(rows.filter((r) => r.kind === "event"));
        }),
      q ? 200 : 0,
    );
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="grid gap-2">
      <Input placeholder="Search events…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="max-h-56 overflow-y-auto rounded-lg border">
        {pending && !hits.length && (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        )}
        {!pending && !hits.length && (
          <p className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
            <CalendarDays className="size-4" /> No events found
          </p>
        )}
        {hits.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => onChange(value?.id === h.id ? null : h)}
            className={cn("flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted", value?.id === h.id && "bg-accent")}
          >
            <Check className={cn("size-4 shrink-0", value?.id === h.id ? "opacity-100" : "opacity-0")} />
            <span className="min-w-0 flex-1 truncate">{h.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatInTz(h.startsAt, timezone, "d MMM yyyy")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
