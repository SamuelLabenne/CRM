"use client";

import { useState } from "react";
import { ImageOff, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ColorField } from "@/components/settings/color-field";
import { FieldErrors } from "@/components/settings/field-error";
import { SettingsCard } from "@/components/settings/settings-card";
import { TimezoneSelect } from "@/components/settings/timezone-select";
import { useRunAction } from "@/components/settings/use-run-action";
import type { WorkspaceSettings } from "@/lib/settings";
import { saveGeneralSettingsAction } from "./actions";

type CurrencyOption = { code: string; name: string; common: boolean };

export function GeneralForm({ initial, currencies }: { initial: WorkspaceSettings; currencies: CurrencyOption[] }) {
  const [name, setName] = useState(initial.name);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [brandColor, setBrandColor] = useState(initial.brandColor);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? "");
  const [logoBroken, setLogoBroken] = useState(false);
  const [address, setAddress] = useState(initial.address);
  const [currency, setCurrency] = useState(initial.currency);
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(initial.weekStartsOn);
  const { run, pending, fieldErrors } = useRunAction();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(() => saveGeneralSettingsAction({ name, timezone, brandColor, logoUrl, address, currency, weekStartsOn }));
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <SettingsCard title="Workspace" description="Shown in the sidebar, email headers and your public registration and booking pages.">
        <div className="grid gap-2">
          <Label htmlFor="ws-name">Workspace name</Label>
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required aria-invalid={!!fieldErrors.name} />
          <FieldErrors errors={fieldErrors.name} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ws-tz">Timezone</Label>
          <TimezoneSelect id="ws-tz" value={timezone} onChange={setTimezone} />
          <p className="text-xs text-muted-foreground">Dates and times across Relay (events, reports, schedules) are shown in this timezone unless a person sets their own.</p>
          <FieldErrors errors={fieldErrors.timezone} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="ws-currency">Currency</Label>
            <NativeSelect id="ws-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full">
              <NativeSelectOptGroup label="Common">
                {currencies
                  .filter((c) => c.common)
                  .map((c) => (
                    <NativeSelectOption key={c.code} value={c.code}>
                      {c.code} – {c.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelectOptGroup>
              <NativeSelectOptGroup label="All currencies">
                {currencies
                  .filter((c) => !c.common)
                  .map((c) => (
                    <NativeSelectOption key={c.code} value={c.code}>
                      {c.code} – {c.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelectOptGroup>
            </NativeSelect>
            <p className="text-xs text-muted-foreground">Used for deal values and campaign budgets.</p>
            <FieldErrors errors={fieldErrors.currency} />
          </div>
          <div className="grid gap-2">
            <Label id="week-start-label">Week starts on</Label>
            <RadioGroup
              aria-labelledby="week-start-label"
              value={String(weekStartsOn)}
              onValueChange={(v) => setWeekStartsOn(v === "0" ? 0 : 1)}
              className="flex gap-4 pt-1.5"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="1" /> Monday
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="0" /> Sunday
              </label>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">Affects the calendar and availability editor.</p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Branding" description="Used on emails, the public event and booking pages, and embedded forms.">
        <div className="grid gap-2">
          <Label htmlFor="ws-color">Brand color</Label>
          <ColorField id="ws-color" value={brandColor} onChange={setBrandColor} />
          <FieldErrors errors={fieldErrors.brandColor} />
          <div className="mt-1 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <span className="text-xs text-muted-foreground">Preview</span>
            <span className="inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold text-white" style={{ background: brandColor }}>
              Register now
            </span>
            <span className="text-sm font-medium underline" style={{ color: brandColor }}>
              Manage your registration
            </span>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ws-logo">Logo URL</Label>
          <div className="flex items-start gap-3">
            <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
              {logoUrl && !logoBroken ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo preview" className="max-h-full max-w-full object-contain" onError={() => setLogoBroken(true)} />
              ) : (
                <ImageOff className="size-5 text-muted-foreground" aria-hidden />
              )}
            </div>
            <div className="grid flex-1 gap-1.5">
              <Input
                id="ws-logo"
                type="url"
                inputMode="url"
                placeholder="https://example.com/logo.png"
                value={logoUrl}
                onChange={(e) => {
                  setLogoUrl(e.target.value);
                  setLogoBroken(false);
                }}
                aria-invalid={!!fieldErrors.logoUrl || logoBroken}
              />
              <p className="text-xs text-muted-foreground">Link to a PNG, SVG or JPG (square or wide, transparent background works best). Leave empty to show the workspace name.</p>
              {logoBroken && <p className="text-xs text-destructive">We couldn&apos;t load an image from this URL.</p>}
              <FieldErrors errors={fieldErrors.logoUrl} />
            </div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Postal address" description="Included in the footer of every marketing email.">
        <div className="grid gap-2">
          <Label htmlFor="ws-address">Business address</Label>
          <Textarea
            id="ws-address"
            rows={3}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={"Acme Pty Ltd\n12 Example Street, Perth WA 6000, Australia"}
            maxLength={300}
          />
          <p className="text-xs text-muted-foreground">
            Anti-spam laws (CAN-SPAM, GDPR/ePrivacy, Australia&apos;s Spam Act) require marketing emails to identify the sender and include a valid postal address.
          </p>
          <FieldErrors errors={fieldErrors.address} />
          {!address.trim() && (
            <Alert>
              <TriangleAlert />
              <AlertDescription>No address yet. Add one before you send broadcasts or automated marketing emails.</AlertDescription>
            </Alert>
          )}
        </div>
      </SettingsCard>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />} Save changes
        </Button>
      </div>
    </form>
  );
}
