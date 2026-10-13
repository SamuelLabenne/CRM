"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { FieldErrors } from "@/components/settings/field-error";
import { SettingsCard } from "@/components/settings/settings-card";
import { useRunAction } from "@/components/settings/use-run-action";
import { changePasswordAction } from "./actions";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const { run, pending, fieldErrors } = useRunAction();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => changePasswordAction({ current, next, confirm }), {
          onSuccess: () => {
            setCurrent("");
            setNext("");
            setConfirm("");
          },
        });
      }}
    >
      <SettingsCard
        title="Password"
        description="Changing your password signs you out on all other devices."
        footer={
          <Button type="submit" disabled={pending || !current || !next || !confirm}>
            {pending && <Spinner />} Update password
          </Button>
        }
      >
        <div className="grid max-w-sm gap-4">
          <div className="grid gap-2">
            <Label htmlFor="pw-current">Current password</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} aria-invalid={!!fieldErrors.current} />
            <FieldErrors errors={fieldErrors.current} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-new">New password</Label>
            <Input id="pw-new" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={!!fieldErrors.next} />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            <FieldErrors errors={fieldErrors.next} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-confirm">Confirm new password</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!fieldErrors.confirm} />
            <FieldErrors errors={fieldErrors.confirm} />
          </div>
        </div>
      </SettingsCard>
    </form>
  );
}
