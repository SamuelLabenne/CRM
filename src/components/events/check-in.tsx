"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Search, UserPlus, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { UserAvatar } from "@/components/app/user-avatar";
import { markAttendanceAction, markRemainingNoShowAction, walkInAction } from "@/app/(app)/events/actions";
import { cn } from "@/lib/utils";

export type CheckInRow = { id: string; name: string; email: string | null; company: string | null; status: string; rsvp: string | null };

type Filter = "expected" | "checked" | "all";

/** Phone-friendly check-in list: tap a person to toggle attended (optimistic), search, walk-ins. */
export function CheckInList({ eventId, initialRows, ended }: { eventId: string; initialRows: CheckInRow[]; ended: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [seen, setSeen] = useState(initialRows);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [walkOpen, setWalkOpen] = useState(false);
  const [walk, setWalk] = useState({ name: "", email: "" });
  const [pending, start] = useTransition();
  const inflight = useRef(0);

  // Adopt fresh server data (after refresh) – "adjust state while rendering" pattern.
  if (initialRows !== seen) {
    setSeen(initialRows);
    setRows(initialRows);
  }

  // Light polling so several staff members see each other's check-ins.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && inflight.current === 0) router.refresh();
    }, 20_000);
    return () => clearInterval(t);
  }, [router]);

  const checked = rows.filter((r) => r.status === "attended").length;
  const expected = rows.length;
  const pct = expected ? Math.round((checked / expected) * 100) : 0;

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "expected" && r.status === "attended") return false;
      if (filter === "checked" && r.status !== "attended") return false;
      if (!term) return true;
      return [r.name, r.email, r.company].some((s) => s?.toLowerCase().includes(term));
    });
  }, [rows, q, filter]);

  function toggle(row: CheckInRow) {
    const next = row.status === "attended" ? "registered" : "attended";
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    inflight.current++;
    markAttendanceAction(row.id, next)
      .then((res) => {
        if (!res.ok) throw new Error(res.error);
      })
      .catch((err: Error) => {
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
        toast.error(err.message || "Couldn't save. Try again.");
      })
      .finally(() => {
        inflight.current--;
      });
  }

  function submitWalkIn(e: React.FormEvent) {
    e.preventDefault();
    if (!walk.name.trim()) return;
    start(async () => {
      const res = await walkInAction({ eventId, name: walk.name.trim(), email: walk.email.trim() });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message ?? "Checked in");
      const d = res.data!;
      setRows((prev) => [{ id: d.id, name: d.name, email: d.email, company: d.company, status: "attended", rsvp: null }, ...prev.filter((r) => r.id !== d.id)]);
      setWalk({ name: "", email: "" });
      setWalkOpen(false);
    });
  }

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      <div className="grid gap-3 rounded-2xl border bg-card p-4 shadow-xs">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Checked in</p>
            <p className="text-4xl leading-none font-bold tabular-nums">
              {checked}
              <span className="text-xl font-medium text-muted-foreground"> / {expected}</span>
            </p>
          </div>
          <p className="text-2xl font-semibold text-muted-foreground tabular-nums">{pct}%</p>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email or company…"
          aria-label="Search attendees"
          className="h-14 rounded-2xl pr-12 pl-12 text-base md:text-base"
          inputMode="search"
          autoComplete="off"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute top-1/2 right-3 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", `All (${expected})`],
            ["expected", `Not here yet (${expected - checked})`],
            ["checked", `Checked in (${checked})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            aria-pressed={filter === k}
            className={cn("h-10 rounded-full border px-4 text-sm font-medium transition-colors", filter === k ? "border-transparent bg-foreground text-background" : "bg-card hover:bg-muted")}
          >
            {label}
          </button>
        ))}
        <Button type="button" variant="outline" className="ml-auto h-10 rounded-full px-4" onClick={() => setWalkOpen((o) => !o)} aria-expanded={walkOpen}>
          <UserPlus /> Walk-in
        </Button>
      </div>

      {walkOpen && (
        <form onSubmit={submitWalkIn} className="grid gap-3 rounded-2xl border-2 border-dashed bg-card p-4">
          <p className="text-sm font-medium">Add a walk-in and check them in</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input className="h-12 text-base md:text-base" placeholder="Full name" value={walk.name} onChange={(e) => setWalk({ ...walk, name: e.target.value })} autoFocus aria-label="Full name" />
            <Input className="h-12 text-base md:text-base" type="email" placeholder="Email (optional)" value={walk.email} onChange={(e) => setWalk({ ...walk, email: e.target.value })} aria-label="Email" />
          </div>
          <Button type="submit" className="h-12 text-base" disabled={pending || !walk.name.trim()}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />} Check in
          </Button>
        </form>
      )}

      {visible.length === 0 ? (
        <div className="grid place-items-center gap-1 rounded-2xl border border-dashed bg-card py-12 text-center text-muted-foreground">
          <p className="font-medium">{rows.length === 0 ? "Nobody is registered yet" : "No one matches"}</p>
          <p className="text-sm">{rows.length === 0 ? "Add a walk-in to get started." : "Try another name or filter."}</p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {visible.map((r) => {
            const here = r.status === "attended";
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => toggle(r)}
                  aria-pressed={here}
                  className={cn(
                    "flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors active:scale-[0.99]",
                    here ? "border-emerald-500/40 bg-emerald-500/10" : "bg-card hover:bg-muted/50",
                  )}
                >
                  <UserAvatar name={r.name} className="size-11 rounded-xl" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold">{r.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">{[r.email, r.company].filter(Boolean).join(" · ") || "No email"}</span>
                    {r.status === "no_show" && <span className="text-xs font-medium text-red-600 dark:text-red-400">Marked no-show</span>}
                    {r.rsvp === "yes" && r.status !== "no_show" && !here && <span className="text-xs font-medium text-violet-600 dark:text-violet-400">RSVP yes</span>}
                  </span>
                  <span
                    className={cn("grid size-11 shrink-0 place-items-center rounded-full border-2 transition-colors", here ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/30 text-transparent")}
                    aria-hidden
                  >
                    <Check className="size-6" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {ended && expected - checked > 0 && (
        <ConfirmDialog
          trigger={
            <Button variant="outline" className="h-11">
              <UserX /> Mark {expected - checked} remaining as no-show
            </Button>
          }
          title="Mark everyone not checked in as no-show?"
          description="This records a no-show for every registered person who hasn't been checked in. You can still change individuals afterwards."
          confirmLabel="Mark as no-show"
          destructive
          onConfirm={async () => {
            const res = await markRemainingNoShowAction(eventId);
            if (!res.ok) return void toast.error(res.error);
            toast.success(res.message ?? "Done");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
