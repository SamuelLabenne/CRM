"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/app/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { createBookingPageAction } from "@/app/(app)/scheduling/actions";
import { DURATION_PRESETS, LOCATION_TYPES, PAGE_PRESETS } from "@/lib/scheduling/defaults";
import type { LocationType } from "@/lib/types";
import { cn } from "@/lib/utils";

export function NewBookingPageForm({ users, currentUserId }: { users: { id: string; name: string; color: string }[]; currentUserId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState<number>(30);
  const [locationType, setLocationType] = useState<LocationType>("online");
  const [hostIds, setHostIds] = useState<string[]>([currentUserId]);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createBookingPageAction({ title, description, durationMinutes: duration, locationType, hostIds });
      if (res.ok) {
        toast.success("Booking page created – now add questions and share it");
        router.push(`/scheduling/${res.data!.id}`);
      } else {
        setError(res.error);
        toast.error(res.error);
      }
    });
  };

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-6">
      <div className="grid gap-2">
        <Label className="flex items-center gap-1.5 text-muted-foreground">
          <Sparkles className="size-3.5" /> Start from
        </Label>
        <div className="flex flex-wrap gap-2">
          {PAGE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setTitle(p.title);
                setDescription(p.description);
                setDuration(p.durationMinutes);
              }}
              className="rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              {p.title} <span className="text-muted-foreground">· {p.durationMinutes} min</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="np-title">Title</Label>
        <Input id="np-title" required autoFocus maxLength={120} placeholder="e.g. Discovery call" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="np-desc">Description (optional)</Label>
        <Textarea id="np-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="np-dur">Duration</Label>
          <NativeSelect id="np-dur" className="w-full" value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATION_PRESETS.map((d) => (
              <NativeSelectOption key={d} value={d}>
                {d} minutes
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="np-loc">Location</Label>
          <NativeSelect id="np-loc" className="w-full" value={locationType} onChange={(e) => setLocationType(e.target.value as LocationType)}>
            {LOCATION_TYPES.map((l) => (
              <NativeSelectOption key={l.value} value={l.value}>
                {l.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Hosts</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {users.map((u) => {
            const on = hostIds.includes(u.id);
            return (
              <label key={u.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors", on ? "border-primary bg-accent" : "hover:bg-muted/50")}>
                <input type="checkbox" className="accent-[var(--primary)]" checked={on} onChange={() => setHostIds(on ? hostIds.filter((h) => h !== u.id) : [...hostIds, u.id])} />
                <UserAvatar name={u.name} color={u.color} />
                <span className="truncate">{u.name}</span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Each host sets their weekly hours in Settings → Profile. With several hosts, bookings rotate round-robin.</p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !title.trim() || !hostIds.length}>
          {pending && <Spinner />} Create booking page
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/scheduling")} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
