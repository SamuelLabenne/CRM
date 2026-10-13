"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "@/components/app/user-avatar";
import { StatusBadge } from "@/components/app/status-badge";
import { AVATAR_PRESETS, ColorField } from "@/components/settings/color-field";
import { FieldErrors } from "@/components/settings/field-error";
import { SettingsCard } from "@/components/settings/settings-card";
import { TimezoneSelect } from "@/components/settings/timezone-select";
import { useRunAction } from "@/components/settings/use-run-action";
import { saveProfileAction } from "./actions";

type Initial = { name: string; email: string; title: string; timezone: string; color: string };

export function ProfileForm({ initial, role, workspaceTimezone }: { initial: Initial; role: string; workspaceTimezone: string }) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof Initial>(k: K, val: Initial[K]) => setV((p) => ({ ...p, [k]: val }));
  const { run, pending, fieldErrors } = useRunAction();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveProfileAction(v));
      }}
    >
      <SettingsCard
        title="Profile"
        description="How you appear to your team and on booking pages."
        action={
          <StatusBadge tone={role === "member" ? "neutral" : "violet"} className="capitalize">
            {role}
          </StatusBadge>
        }
        footer={
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />} Save profile
          </Button>
        }
      >
        <div className="flex items-center gap-4">
          <UserAvatar name={v.name || "?"} color={v.color} className="size-14 rounded-xl text-base" />
          <div className="grid gap-1.5">
            <Label>Avatar color</Label>
            <ColorField value={v.color} onChange={(c) => set("color", c)} presets={AVATAR_PRESETS} compact />
            <FieldErrors errors={fieldErrors.color} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={80} required autoComplete="name" aria-invalid={!!fieldErrors.name} />
            <FieldErrors errors={fieldErrors.name} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-title">Job title</Label>
            <Input id="p-title" value={v.title} onChange={(e) => set("title", e.target.value)} maxLength={80} placeholder="Optional" autoComplete="organization-title" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-email">Email</Label>
            <Input id="p-email" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} required autoComplete="email" aria-invalid={!!fieldErrors.email} />
            <FieldErrors errors={fieldErrors.email} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-tz">Timezone</Label>
            <TimezoneSelect id="p-tz" value={v.timezone} onChange={(tz) => set("timezone", tz)} emptyLabel={`Workspace default (${workspaceTimezone})`} />
            <p className="text-xs text-muted-foreground">Your availability below is interpreted in this timezone.</p>
            <FieldErrors errors={fieldErrors.timezone} />
          </div>
        </div>
      </SettingsCard>
    </form>
  );
}
