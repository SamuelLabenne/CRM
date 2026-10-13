"use client";

import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/app/user-avatar";
import { DURATION_PRESETS, LOCATION_TYPES, PAGE_COLORS } from "@/lib/scheduling/defaults";
import type { PageDraft } from "@/lib/scheduling/draft";
import { cn } from "@/lib/utils";
import { NumberInput } from "./fields";

export type EditorUser = {
  id: string;
  name: string;
  email: string;
  color: string;
  timezone: string;
  availability: import("@/lib/types").WeeklyAvailability | null;
  overridesCount: number;
  deactivated: boolean;
};

export type EditorCtx = {
  draft: PageDraft;
  update: (patch: Partial<PageDraft>) => void;
  errors: Record<string, string[] | undefined>;
};

export function Card({ title, description, children, className }: { title: string; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-4 rounded-xl border bg-card p-5", className)}>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function FieldError({ children }: { children?: string }) {
  return children ? <p className="text-sm text-destructive">{children}</p> : null;
}

export function SetupTab({ ctx, users, campaigns }: { ctx: EditorCtx; users: EditorUser[]; campaigns: { id: string; name: string }[] }) {
  const { draft, update, errors } = ctx;
  const toggleHost = (id: string) => update({ hostIds: draft.hostIds.includes(id) ? draft.hostIds.filter((h) => h !== id) : [...draft.hostIds, id] });
  const visibleUsers = users.filter((u) => !u.deactivated || draft.hostIds.includes(u.id));
  const customDuration = !(DURATION_PRESETS as readonly number[]).includes(draft.durationMinutes);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="grid content-start gap-5">
        <Card title="Basics" description="What visitors see at the top of the page.">
          <div className="grid gap-2">
            <Label htmlFor="bp-title">Title</Label>
            <Input id="bp-title" value={draft.title} maxLength={120} onChange={(e) => update({ title: e.target.value })} aria-invalid={!!errors.title} />
            <FieldError>{errors.title?.[0]}</FieldError>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bp-slug">Link</Label>
            <div className="flex min-w-0 items-center rounded-lg border border-input bg-transparent text-sm focus-within:ring-3 focus-within:ring-ring/50">
              <span className="shrink-0 pl-2.5 text-muted-foreground">/book/</span>
              <input
                id="bp-slug"
                value={draft.slug}
                onChange={(e) => update({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+/, "") })}
                onBlur={() => update({ slug: draft.slug.replace(/-+$/, "") })}
                className="h-8 min-w-0 flex-1 bg-transparent px-1 outline-none"
                aria-invalid={!!errors.slug}
              />
            </div>
            <FieldError>{errors.slug?.[0]}</FieldError>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bp-desc">Description</Label>
            <Textarea id="bp-desc" rows={4} value={draft.description} onChange={(e) => update({ description: e.target.value })} placeholder="What will you cover on this call? Shown next to the calendar." />
          </div>
          <div className="grid gap-2">
            <Label>Accent color</Label>
            <div className="flex flex-wrap items-center gap-2">
              {PAGE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update({ color: c })}
                  aria-label={`Use color ${c}`}
                  aria-pressed={draft.color === c}
                  className="grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-card transition-shadow hover:ring-2 hover:ring-border aria-pressed:ring-2 aria-pressed:ring-foreground"
                  style={{ background: c }}
                >
                  {draft.color === c && <Check className="size-3.5 text-white" />}
                </button>
              ))}
              <input type="color" aria-label="Custom color" value={draft.color} onChange={(e) => update({ color: e.target.value })} className="size-7 cursor-pointer rounded-full border bg-transparent p-0" />
            </div>
          </div>
        </Card>

        <Card title="After booking" description="What happens once someone has booked a time.">
          <div className="grid gap-2">
            <Label htmlFor="bp-confirm">Confirmation message</Label>
            <Textarea id="bp-confirm" rows={3} value={draft.confirmationMessage} onChange={(e) => update({ confirmationMessage: e.target.value })} placeholder="e.g. Please prepare your top three questions – we will cover them on the call." />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bp-redirect">Redirect to your own page (optional)</Label>
            <Input id="bp-redirect" type="url" placeholder="https://example.com/thank-you" value={draft.redirectUrl} onChange={(e) => update({ redirectUrl: e.target.value })} aria-invalid={!!errors.redirectUrl} />
            <FieldError>{errors.redirectUrl?.[0]}</FieldError>
          </div>
        </Card>
      </div>

      <div className="grid content-start gap-5">
        <Card title="Meeting">
          <div className="grid gap-2">
            <Label>Duration</Label>
            <div className="flex flex-wrap items-center gap-2">
              {DURATION_PRESETS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={draft.durationMinutes === d}
                  onClick={() => update({ durationMinutes: d })}
                  className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                >
                  {d} min
                </button>
              ))}
              <div className="flex items-center gap-1.5">
                <NumberInput aria-label="Custom duration in minutes" className={cn("w-20", customDuration && "border-primary")} min={5} max={480} value={draft.durationMinutes} onChange={(n) => update({ durationMinutes: n })} />
                <span className="text-sm text-muted-foreground">min</span>
              </div>
            </div>
            <FieldError>{errors.durationMinutes?.[0]}</FieldError>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bp-loc-type">Location</Label>
            <NativeSelect id="bp-loc-type" className="w-full" value={draft.locationType} onChange={(e) => update({ locationType: e.target.value as PageDraft["locationType"] })}>
              {LOCATION_TYPES.map((l) => (
                <NativeSelectOption key={l.value} value={l.value}>
                  {l.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {draft.locationType === "online" && (
            <div className="grid gap-2">
              <Label htmlFor="bp-url">Meeting link</Label>
              <Input id="bp-url" type="url" placeholder="https://meet.google.com/…" value={draft.meetingUrl} onChange={(e) => update({ meetingUrl: e.target.value })} aria-invalid={!!errors.meetingUrl} />
              <p className="text-xs text-muted-foreground">Shown in the confirmation and reminder emails. Paste your Zoom, Google Meet or Teams link.</p>
              <FieldError>{errors.meetingUrl?.[0]}</FieldError>
            </div>
          )}
          {draft.locationType !== "online" && (
            <div className="grid gap-2">
              <Label htmlFor="bp-location">{draft.locationType === "in_person" ? "Address" : "Phone number or note"}</Label>
              <Input
                id="bp-location"
                value={draft.location}
                onChange={(e) => update({ location: e.target.value })}
                placeholder={draft.locationType === "in_person" ? "12 Example St, Perth WA" : "We will call you on the number you provide"}
              />
            </div>
          )}
        </Card>

        <Card title="Hosts" description="People who take these meetings. With several hosts, bookings rotate round-robin and visitors see the combined availability.">
          <div className="grid gap-2">
            {visibleUsers.map((u) => {
              const on = draft.hostIds.includes(u.id);
              return (
                <label key={u.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors", on ? "border-primary bg-accent" : "hover:bg-muted/50")}>
                  <input type="checkbox" className="accent-[var(--primary)]" checked={on} onChange={() => toggleHost(u.id)} />
                  <UserAvatar name={u.name} color={u.color} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {u.name} {u.deactivated && <span className="text-xs text-muted-foreground">(deactivated)</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{u.timezone.replace(/_/g, " ")}</div>
                  </div>
                </label>
              );
            })}
            <FieldError>{errors.hostIds?.[0]}</FieldError>
          </div>
        </Card>

        <Card title="Campaign" description="Attribute meetings booked here to a marketing campaign.">
          <NativeSelect className="w-full" aria-label="Campaign" value={draft.campaignId ?? ""} onChange={(e) => update({ campaignId: e.target.value || null })}>
            <NativeSelectOption value="">No campaign</NativeSelectOption>
            {campaigns.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Card>

        <Card title="Status">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-medium">{draft.isActive ? "Page is live" : "Page is paused"}</span>
              <span className="block text-muted-foreground">Paused pages show a friendly &ldquo;not available&rdquo; message.</span>
            </span>
            <Switch checked={draft.isActive} onCheckedChange={(v) => update({ isActive: v })} />
          </label>
        </Card>
      </div>
    </div>
  );
}
