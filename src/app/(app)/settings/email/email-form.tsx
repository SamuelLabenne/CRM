"use client";

import { useState } from "react";
import { Inbox, Mail, Send, Server, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FieldErrors } from "@/components/settings/field-error";
import { SecretInput } from "@/components/settings/secret-input";
import { SettingsCard } from "@/components/settings/settings-card";
import { useRunAction } from "@/components/settings/use-run-action";
import { cn } from "@/lib/utils";
import type { EmailProvider } from "@/lib/types";
import { saveEmailSettingsAction } from "./actions";

type Initial = {
  provider: EmailProvider;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  tracking: boolean;
  testMode: boolean;
  testRecipients: string;
  dailyLimit: string;
  smtp: { host: string; port: number; secure: boolean; user: string };
};

const PROVIDERS: { value: EmailProvider; title: string; description: string; icon: typeof Inbox }[] = [
  { value: "outbox", title: "Outbox (simulated)", description: "Nothing leaves Relay. Emails are logged in Emails → Outbox so you can preview them. Great for trying things out.", icon: Inbox },
  { value: "resend", title: "Resend API", description: "Deliver real email through Resend. Recommended – simple setup and good deliverability.", icon: Send },
  { value: "smtp", title: "SMTP", description: "Use any SMTP server (Google Workspace, Postmark, Mailgun, your own).", icon: Server },
];

export function EmailSettingsForm({
  initial,
  resendKeySaved,
  resendKeyFromEnv,
  smtpPasswordSaved,
}: {
  initial: Initial;
  resendKeySaved: boolean;
  resendKeyFromEnv: boolean;
  smtpPasswordSaved: boolean;
}) {
  const [provider, setProvider] = useState<EmailProvider>(initial.provider);
  const [fromName, setFromName] = useState(initial.fromName);
  const [fromEmail, setFromEmail] = useState(initial.fromEmail);
  const [replyTo, setReplyTo] = useState(initial.replyTo);
  const [tracking, setTracking] = useState(initial.tracking);
  const [testMode, setTestMode] = useState(initial.testMode);
  const [testRecipients, setTestRecipients] = useState(initial.testRecipients);
  const [dailyLimit, setDailyLimit] = useState(initial.dailyLimit);
  const [resendKey, setResendKey] = useState("");
  const [smtp, setSmtp] = useState({ ...initial.smtp, password: "" });
  const { run, pending, fieldErrors } = useRunAction();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () => saveEmailSettingsAction({ provider, fromName, fromEmail, replyTo, tracking, testMode, testRecipients, dailyLimit, resendApiKey: resendKey, smtp }),
      { onSuccess: () => (setResendKey(""), setSmtp((s) => ({ ...s, password: "" }))) },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <SettingsCard title="Sending method" description="How Relay delivers every email: confirmations, reminders, broadcasts and automations.">
        <RadioGroup value={provider} onValueChange={(v) => setProvider(v as EmailProvider)} className="grid gap-3 sm:grid-cols-3" aria-label="Sending method">
          {PROVIDERS.map((p) => (
            <label
              key={p.value}
              htmlFor={`provider-${p.value}`}
              className={cn(
                "flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-3 text-sm transition-colors hover:bg-muted/50",
                "has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-primary/5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <p.icon className="size-4 text-muted-foreground" /> {p.title}
                </span>
                <RadioGroupItem id={`provider-${p.value}`} value={p.value} />
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{p.description}</span>
            </label>
          ))}
        </RadioGroup>

        {provider === "outbox" && (
          <Alert>
            <Inbox />
            <AlertTitle>Emails are simulated</AlertTitle>
            <AlertDescription>
              Nobody receives anything while this is selected. Contacts, automations and bookings still work – every email shows up in the Outbox.
            </AlertDescription>
          </Alert>
        )}

        {provider === "resend" && (
          <div className="grid gap-4 rounded-lg border p-4">
            <div className="grid gap-2">
              <Label htmlFor="resend-key">Resend API key</Label>
              <SecretInput id="resend-key" saved={resendKeySaved} value={resendKey} onChange={setResendKey} placeholder="re_…" invalid={!!fieldErrors.resendApiKey} />
              {resendKeyFromEnv && !resendKeySaved && (
                <p className="text-xs text-muted-foreground">Using the RESEND_API_KEY environment variable. Add a key here to override it.</p>
              )}
              <FieldErrors errors={fieldErrors.resendApiKey} />
              <p className="text-xs text-muted-foreground">
                Create a key at resend.com → API Keys (&quot;Sending access&quot; is enough). It is stored encrypted and never shown again.
              </p>
            </div>
            <Alert>
              <Mail />
              <AlertTitle>Verify your sending domain</AlertTitle>
              <AlertDescription>
                <p>
                  In Resend, add your domain under Domains and publish the SPF and DKIM DNS records it shows you. Until the domain is verified, Resend only delivers from{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">onboarding@resend.dev</code> to your own address. The &quot;From email&quot; below must use the verified domain.
                </p>
              </AlertDescription>
            </Alert>
          </div>
        )}

        {provider === "smtp" && (
          <div className="grid gap-4 rounded-lg border p-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <div className="grid gap-2">
                <Label htmlFor="smtp-host">SMTP host</Label>
                <Input id="smtp-host" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.example.com" aria-invalid={!!fieldErrors["smtp.host"]} />
                <FieldErrors errors={fieldErrors["smtp.host"]} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="smtp-port">Port</Label>
                <Input id="smtp-port" type="number" min={1} max={65535} value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} />
                <FieldErrors errors={fieldErrors["smtp.port"]} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={smtp.secure} onCheckedChange={(v) => setSmtp({ ...smtp, secure: v })} />
              Use TLS from the start (usually port 465). Leave off for STARTTLS on 587.
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="smtp-user">Username</Label>
                <Input id="smtp-user" value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} autoComplete="off" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="smtp-password">Password</Label>
                <SecretInput id="smtp-password" saved={smtpPasswordSaved} value={smtp.password} onChange={(v) => setSmtp({ ...smtp, password: v })} />
              </div>
            </div>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Sender" description="Shown in the From and Reply-To of every email.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="from-name">From name</Label>
            <Input id="from-name" value={fromName} onChange={(e) => setFromName(e.target.value)} maxLength={100} required aria-invalid={!!fieldErrors.fromName} />
            <FieldErrors errors={fieldErrors.fromName} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="from-email">From email</Label>
            <Input id="from-email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} required aria-invalid={!!fieldErrors.fromEmail} />
            <FieldErrors errors={fieldErrors.fromEmail} />
          </div>
        </div>
        <div className="grid gap-2 sm:max-w-sm">
          <Label htmlFor="reply-to">Reply-to (optional)</Label>
          <Input id="reply-to" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="Same as From if empty" aria-invalid={!!fieldErrors.replyTo} />
          <p className="text-xs text-muted-foreground">Where replies go, e.g. a monitored inbox.</p>
          <FieldErrors errors={fieldErrors.replyTo} />
        </div>
        {provider !== "outbox" && /@(example\.(com|org|net)|resend\.dev)$/.test(fromEmail.toLowerCase()) && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>This From address isn&apos;t on a domain you own. Real providers will reject or spam-folder these emails.</AlertDescription>
          </Alert>
        )}
      </SettingsCard>

      <SettingsCard title="Test mode & limits" description="Safety nets while you try Relay out with real email.">
        <div className="grid gap-5">
          <label className="flex items-start gap-3 text-sm">
            <Switch checked={testMode} onCheckedChange={setTestMode} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className="font-medium">Test mode</span>
              <span className="text-muted-foreground">
                Only team members and the addresses below receive real email. Everything else (sample contacts, real leads) is logged in the
                Outbox instead of being delivered. Turn this off when you go live.
              </span>
            </span>
          </label>
          {testMode && (
            <div className="grid gap-1.5">
              <Label htmlFor="test-recipients">Extra test recipients</Label>
              <Textarea
                id="test-recipients"
                rows={2}
                value={testRecipients}
                onChange={(e) => setTestRecipients(e.target.value)}
                placeholder="friend@example.com, colleague@example.com"
                aria-invalid={!!fieldErrors.testRecipients}
              />
              <FieldErrors errors={fieldErrors.testRecipients} />
            </div>
          )}
          <div className="grid max-w-xs gap-1.5">
            <Label htmlFor="daily-limit">Daily sending limit</Label>
            <Input
              id="daily-limit"
              type="number"
              min={1}
              inputMode="numeric"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              placeholder="Unlimited"
              aria-invalid={!!fieldErrors.dailyLimit}
            />
            <FieldErrors errors={fieldErrors.dailyLimit} />
            <p className="text-xs text-muted-foreground">Emails above this many per 24 hours are logged in the Outbox instead of sent. Useful on free plans with a shared quota.</p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Tracking">
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={tracking} onCheckedChange={setTracking} className="mt-0.5" />
          <span className="grid gap-0.5">
            <span className="font-medium">Track opens and clicks</span>
            <span className="text-muted-foreground">Adds a tiny image and wraps links so Relay can report open and click rates and log them on the contact timeline.</span>
          </span>
        </label>
      </SettingsCard>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />} Save changes
        </Button>
      </div>
    </form>
  );
}
