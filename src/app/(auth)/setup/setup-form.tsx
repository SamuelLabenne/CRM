"use client";

import { useActionState, useEffect, useState } from "react";
import { setupAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

export function SetupForm({ requireCode }: { requireCode: boolean }) {
  const [state, action, pending] = useActionState(setupAction, null);
  const [tz, setTz] = useState("UTC");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.[0] : undefined);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="timezone" value={tz} />
      {state && !state.ok && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-2">
        <Label htmlFor="workspaceName">Workspace / company name</Label>
        <Input id="workspaceName" name="workspaceName" placeholder="Acme Events" required autoFocus aria-invalid={!!err("workspaceName")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" autoComplete="name" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!err("email")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required aria-invalid={!!err("password")} />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      {requireCode && (
        <div className="grid gap-2">
          <Label htmlFor="setupCode">Setup code</Label>
          <Input id="setupCode" name="setupCode" required aria-invalid={!!err("setupCode")} />
          <p className="text-xs text-muted-foreground">Provided with your deployment, to make sure only you can claim this workspace.</p>
        </div>
      )}
      <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
        <Checkbox name="sampleData" defaultChecked className="mt-0.5" />
        <span>
          <span className="font-medium">Load sample data</span>
          <span className="block text-muted-foreground">Demo contacts, campaigns, events, emails and automations so you can explore. You can delete them later.</span>
        </span>
      </label>
      <p className="text-xs text-muted-foreground">Timezone: {tz}</p>
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Spinner />} Create workspace
      </Button>
    </form>
  );
}
