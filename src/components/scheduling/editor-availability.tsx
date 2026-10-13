"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CalendarSearch, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/app/user-avatar";
import { INCREMENT_OPTIONS } from "@/lib/scheduling/defaults";
import { DEFAULT_WEEKLY_AVAILABILITY } from "@/lib/scheduling/slots-core";
import { formatSlotTime } from "@/lib/scheduling/slots-core";
import { previewAvailabilityAction } from "@/app/(app)/scheduling/actions";
import { Card, FieldError, type EditorCtx, type EditorUser } from "./editor-setup";
import { DurationInput, NumberInput } from "./fields";
import { format } from "date-fns";

const DAYS = [
  { key: "1", label: "Mon" },
  { key: "2", label: "Tue" },
  { key: "3", label: "Wed" },
  { key: "4", label: "Thu" },
  { key: "5", label: "Fri" },
  { key: "6", label: "Sat" },
  { key: "0", label: "Sun" },
] as const;

function HostHours({ user }: { user: EditorUser }) {
  const weekly = user.availability ?? DEFAULT_WEEKLY_AVAILABILITY;
  return (
    <div className="grid gap-3 rounded-lg border bg-background p-3">
      <div className="flex items-center gap-3">
        <UserAvatar name={user.name} color={user.color} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {user.timezone.replace(/_/g, " ")}
            {user.overridesCount > 0 && ` · ${user.overridesCount} date override${user.overridesCount === 1 ? "" : "s"}`}
            {!user.availability && " · default hours"}
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-[3rem_1fr] gap-x-3 gap-y-1 text-sm">
        {DAYS.map((d) => {
          const slots = weekly[d.key] ?? [];
          return (
            <div key={d.key} className="contents">
              <dt className="text-muted-foreground">{d.label}</dt>
              <dd className={slots.length ? "" : "text-muted-foreground/60"}>{slots.length ? slots.map((s) => `${s.start}–${s.end}`).join(", ") : "Unavailable"}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export function AvailabilityTab({ ctx, users, pageId, dirty }: { ctx: EditorCtx; users: EditorUser[]; pageId: string; dirty: boolean }) {
  const { draft, update, errors } = ctx;
  const hosts = users.filter((u) => draft.hostIds.includes(u.id));
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<{ days: { date: string; times: string[] }[]; timezone: string } | null>(null);

  const runPreview = () =>
    start(async () => {
      const res = await previewAvailabilityAction(pageId);
      if (res.ok) setPreview(res.data!);
      else toast.error(res.error);
    });

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="grid content-start gap-5">
        <Card
          title="Host availability"
          description="Visitors can only book when a host is free. Weekly hours and date overrides are managed by each host in their profile."
        >
          {hosts.length === 0 && <p className="text-sm text-muted-foreground">Select at least one host on the Setup tab.</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {hosts.map((u) => (
              <HostHours key={u.id} user={u} />
            ))}
          </div>
          <Button asChild variant="outline" className="w-fit">
            <Link href="/settings/profile">
              <ExternalLink /> Edit weekly hours in profile settings
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground">Existing meetings and events on a host&apos;s calendar always block that time. Cancelled meetings free it up again.</p>
        </Card>

        <Card title="Preview" description="The next days with open times, using the saved settings.">
          <div className="grid gap-3">
            <Button type="button" variant="outline" className="w-fit" onClick={runPreview} disabled={pending}>
              <CalendarSearch /> {pending ? "Checking…" : "Show next available times"}
            </Button>
            {dirty && <p className="text-xs text-muted-foreground">You have unsaved changes – save first to include them.</p>}
            {preview &&
              (preview.days.length ? (
                <ul className="grid gap-2 text-sm">
                  {preview.days.map((d) => (
                    <li key={d.date} className="flex flex-wrap gap-x-3 gap-y-1">
                      <span className="w-28 shrink-0 font-medium">{format(new Date(d.date + "T12:00:00"), "EEE d MMM")}</span>
                      <span className="text-muted-foreground">
                        {d.times.slice(0, 6).map((t) => formatSlotTime(t, preview.timezone, false)).join(", ")}
                        {d.times.length > 6 && ` +${d.times.length - 6} more`}
                      </span>
                    </li>
                  ))}
                  <li className="text-xs text-muted-foreground">Shown in {preview.timezone.replace(/_/g, " ")}.</li>
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No available times in the booking window. Check the hosts&apos; hours and the limits.</p>
              ))}
          </div>
        </Card>
      </div>

      <Card title="Scheduling limits" description="Apply to every host on this page.">
        <div className="grid gap-2">
          <Label>Minimum notice</Label>
          <DurationInput aria-label="Minimum notice" value={draft.minNoticeMinutes} onChange={(m) => update({ minNoticeMinutes: m })} />
          <p className="text-xs text-muted-foreground">How far ahead of the start time a visitor must book.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="bp-days">Booking window</Label>
          <div className="flex items-center gap-2">
            <NumberInput id="bp-days" className="w-24" min={1} max={365} value={draft.maxDaysAhead} onChange={(n) => update({ maxDaysAhead: n })} />
            <span className="text-sm text-muted-foreground">days into the future</span>
          </div>
          <FieldError>{errors.maxDaysAhead?.[0]}</FieldError>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="bp-inc">Time slot interval</Label>
          <NativeSelect id="bp-inc" value={String(draft.slotIncrementMinutes)} onChange={(e) => update({ slotIncrementMinutes: Number(e.target.value) })}>
            {INCREMENT_OPTIONS.map((i) => (
              <NativeSelectOption key={i} value={i}>
                every {i} minutes
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="bp-buf-before">Buffer before</Label>
            <div className="flex items-center gap-2">
              <NumberInput id="bp-buf-before" className="w-20" max={240} value={draft.bufferBeforeMinutes} onChange={(n) => update({ bufferBeforeMinutes: n })} />
              <span className="text-sm text-muted-foreground">min</span>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bp-buf-after">Buffer after</Label>
            <div className="flex items-center gap-2">
              <NumberInput id="bp-buf-after" className="w-20" max={240} value={draft.bufferAfterMinutes} onChange={(n) => update({ bufferAfterMinutes: n })} />
              <span className="text-sm text-muted-foreground">min</span>
            </div>
          </div>
        </div>
        <div className="grid gap-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">Daily limit per host</span>
            <Switch checked={draft.dailyLimit != null} onCheckedChange={(v) => update({ dailyLimit: v ? 4 : null })} />
          </label>
          {draft.dailyLimit != null ? (
            <div className="flex items-center gap-2">
              <NumberInput aria-label="Daily limit" className="w-20" min={1} max={100} value={draft.dailyLimit} onChange={(n) => update({ dailyLimit: n })} />
              <span className="text-sm text-muted-foreground">meetings per host per day</span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No limit – hosts can be booked back to back.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
