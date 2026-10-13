"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Info, Save, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption, NativeSelectOptGroup } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { AudienceBuilder, isAudienceComplete, type AudienceOptions } from "@/components/email/audience-builder";
import { ControlledConfirm } from "@/components/email/controlled-confirm";
import { EmailComposer, type ComposerValue } from "@/components/email/email-composer";
import type { EmailBranding } from "@/components/email/types";
import type { AudiencePreview } from "@/lib/email/audience-summary";
import { isEmailBodyEmpty } from "@/lib/email/html";
import { toZonedLocalInput } from "@/lib/email/schedule";
import { EMAIL_STARTERS } from "@/lib/email/starters";
import { formatNumber } from "@/lib/format";
import type { Audience } from "@/lib/types";
import { saveBroadcastAction, sendBroadcastAction } from "../actions";
import type { TemplateOption } from "../_lib/audience-options";

export type BroadcastFormValue = {
  id: string | null;
  name: string;
  campaignId: string | null;
  templateId: string | null;
  audience: Audience;
  subject: string;
  preheader: string;
  contentJson: Record<string, unknown> | null;
  contentHtml: string;
};

type Errors = { name?: string; subject?: string; body?: string; audience?: string };

export function BroadcastForm({
  initial,
  status,
  options,
  branding,
  timezone,
  initialPreview,
}: {
  initial: BroadcastFormValue;
  /** Present when editing an existing broadcast. */
  status?: "draft" | "cancelled";
  options: AudienceOptions & { templates: TemplateOption[] };
  branding: EmailBranding;
  timezone: string;
  initialPreview?: AudiencePreview | null;
}) {
  const router = useRouter();
  const [id, setId] = useState(initial.id);
  const [name, setName] = useState(initial.name);
  const [campaignId, setCampaignId] = useState(initial.campaignId ?? "");
  const [templateId, setTemplateId] = useState<string | null>(initial.templateId);
  const [audience, setAudience] = useState<Audience>(initial.audience);
  const [content, setContent] = useState<ComposerValue>({
    subject: initial.subject,
    preheader: initial.preheader,
    json: initial.contentJson,
    html: initial.contentHtml,
  });
  const [preview, setPreview] = useState<AudiencePreview | null>(initialPreview ?? null);
  const [errors, setErrors] = useState<Errors>({});
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [saving, startSave] = useTransition();

  const fingerprint = (v: unknown[]) => JSON.stringify(v);
  const current = () => fingerprint([name, campaignId, templateId, audience, content.subject, content.preheader, content.html]);
  const [savedFp, setSavedFp] = useState(() => current());
  const dirty = current() !== savedFp;

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const payload = () => ({
    id: id ?? undefined,
    name,
    campaignId: campaignId || null,
    templateId,
    audience,
    subject: content.subject,
    preheader: content.preheader || null,
    contentJson: content.json,
    contentHtml: content.html,
  });

  const validate = (forSend: boolean): boolean => {
    const next: Errors = {};
    if (!name.trim()) next.name = "Give the broadcast a name.";
    if (forSend) {
      if (!content.subject.trim()) next.subject = "Add a subject line.";
      if (isEmailBodyEmpty(content.html)) next.body = "The email body is empty.";
      if (!isAudienceComplete(audience)) next.audience = "Finish choosing who should receive this.";
      else if (preview && preview.count === 0) next.audience = "This audience has no eligible recipients.";
    }
    setErrors(next);
    const first = Object.values(next)[0];
    if (first) toast.error(first);
    return !first;
  };

  const saveDraft = () => {
    if (!validate(false)) return;
    startSave(async () => {
      const res = await saveBroadcastAction(payload());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Draft saved");
      setSavedFp(current());
      if (!id) {
        setId(res.data!.id);
        router.replace(`/emails/broadcasts/${res.data!.id}`);
      } else router.refresh();
    });
  };

  const send = (schedule: string | null) => {
    startSave(async () => {
      const res = await sendBroadcastAction({ broadcast: payload(), schedule });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSavedFp(current());
      toast.success(schedule ? "Broadcast scheduled" : "Broadcast is sending", {
        description: schedule ? "You can cancel the schedule from the broadcast page." : "Watch the delivery report update live.",
      });
      router.push(`/emails/broadcasts/${res.data!.id}`);
    });
  };

  const applyTemplate = (tplId: string) => {
    if (tplId.startsWith("starter:")) {
      const s = EMAIL_STARTERS.find((x) => x.id === tplId.slice(8));
      if (!s) return;
      setContent({ subject: s.subject, preheader: s.preheader, json: null, html: s.html });
      setTemplateId(null);
      return;
    }
    const t = options.templates.find((x) => x.id === tplId);
    if (!t) return;
    setContent({ subject: t.subject, preheader: t.preheader, json: t.contentJson, html: t.contentHtml });
    setTemplateId(t.id);
  };

  const onTemplateChange = (value: string) => {
    if (!value) return;
    const hasContent = !isEmailBodyEmpty(content.html) || content.subject.trim();
    if (hasContent) setPendingTemplate(value);
    else applyTemplate(value);
  };

  const pendingName = pendingTemplate
    ? pendingTemplate.startsWith("starter:")
      ? EMAIL_STARTERS.find((x) => x.id === pendingTemplate.slice(8))?.name
      : options.templates.find((x) => x.id === pendingTemplate)?.name
    : null;

  const custom = options.templates.filter((t) => !t.systemKey);
  const builtIn = options.templates.filter((t) => t.systemKey);
  const addressMissing = !branding.address;
  const recipients = preview?.count ?? null;

  return (
    <>
      <PageHeader
        back={{ href: "/emails", label: "Broadcasts" }}
        title={id ? name || "Untitled broadcast" : "New broadcast"}
        description={dirty ? "Unsaved changes" : id ? "Draft saved" : "Compose an email and choose who receives it"}
      />
      <PageBody className="pb-0">
        {status === "cancelled" && (
          <Alert>
            <Info />
            <AlertTitle>This broadcast was cancelled</AlertTitle>
            <AlertDescription>Nothing more will be sent. Edit it and send or schedule it again when you&apos;re ready.</AlertDescription>
          </Alert>
        )}
        {addressMissing && (
          <Alert>
            <TriangleAlert />
            <AlertTitle>Add your postal address</AlertTitle>
            <AlertDescription>
              Marketing emails should include a physical address in the footer.{" "}
              <Link href="/settings" className="font-medium text-foreground underline underline-offset-4">
                Add it in Settings → General
              </Link>
              .
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Only you and your team see the broadcast name.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="grid gap-1.5">
              <Label htmlFor="bc-name">Name</Label>
              <Input
                id="bc-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrors((x) => ({ ...x, name: undefined }));
                }}
                placeholder="e.g. October newsletter"
                maxLength={120}
                aria-invalid={Boolean(errors.name)}
                autoFocus={!id}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bc-campaign">
                Campaign <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <NativeSelect id="bc-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="w-full">
                <NativeSelectOption value="">No campaign</NativeSelectOption>
                {options.campaigns.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audience</CardTitle>
            <CardDescription>Unsubscribed and bounced contacts, and contacts without an email address, are always skipped.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <AudienceBuilder
              value={audience}
              onChange={(a) => {
                setAudience(a);
                setErrors((x) => ({ ...x, audience: undefined }));
              }}
              options={options}
              initialPreview={initialPreview}
              onPreviewChange={setPreview}
            />
            {errors.audience && <p className="text-xs text-destructive">{errors.audience}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Content</CardTitle>
            <CardDescription>Write the email, then check the preview and send yourself a test.</CardDescription>
            <div className="pt-2">
              <Label htmlFor="bc-template" className="sr-only">
                Start from a template
              </Label>
              <NativeSelect id="bc-template" value="" onChange={(e) => onTemplateChange(e.target.value)} className="w-full sm:w-72" aria-label="Start from a template">
                <NativeSelectOption value="">Start from a template or layout…</NativeSelectOption>
                <NativeSelectOptGroup label="Starter layouts">
                  {EMAIL_STARTERS.map((s) => (
                    <NativeSelectOption key={s.id} value={`starter:${s.id}`}>
                      {s.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelectOptGroup>
                {custom.length > 0 && (
                  <NativeSelectOptGroup label="Your templates">
                    {custom.map((t) => (
                      <NativeSelectOption key={t.id} value={t.id}>
                        {t.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                )}
                {builtIn.length > 0 && (
                  <NativeSelectOptGroup label="Built-in emails">
                    {builtIn.map((t) => (
                      <NativeSelectOption key={t.id} value={t.id}>
                        {t.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                )}
              </NativeSelect>
            </div>
          </CardHeader>
          <CardContent>
            <EmailComposer
              value={content}
              onChange={(v) => {
                setContent(v);
                if (errors.subject || errors.body) setErrors((x) => ({ ...x, subject: undefined, body: undefined }));
              }}
              branding={branding}
              marketing
              errors={{ subject: errors.subject }}
            />
            {errors.body && <p className="mt-2 text-xs text-destructive">{errors.body}</p>}
          </CardContent>
        </Card>

        <div className="sticky bottom-0 z-10 -mx-6 mt-2 flex flex-wrap items-center gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="min-w-0 flex-1 text-sm text-muted-foreground">
            {recipients != null ? (
              <>
                <span className="font-medium text-foreground tabular-nums">{formatNumber(recipients)}</span> {recipients === 1 ? "recipient" : "recipients"}
              </>
            ) : (
              "Choose an audience"
            )}
            {dirty && <span className="ml-2 hidden sm:inline">· Unsaved changes</span>}
          </div>
          <Button variant="outline" onClick={saveDraft} disabled={saving}>
            {saving ? <Spinner /> : <Save />} Save draft
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (validate(true)) setScheduleOpen(true);
            }}
            disabled={saving}
          >
            <CalendarClock /> Schedule
          </Button>
          <Button
            onClick={() => {
              if (validate(true)) setConfirmSend(true);
            }}
            disabled={saving}
          >
            <Send /> Send now
          </Button>
        </div>
      </PageBody>

      <ControlledConfirm
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title={`Send to ${recipients != null ? formatNumber(recipients) : "your"} ${recipients === 1 ? "recipient" : "recipients"} now?`}
        description={
          <>
            “{content.subject || name}” will start sending immediately. Once an email is sent it can&apos;t be recalled, though you can stop a send that is still in
            progress.
          </>
        }
        confirmLabel="Send now"
        onConfirm={() => send(null)}
      />
      <ControlledConfirm
        open={pendingTemplate != null}
        onOpenChange={(o) => !o && setPendingTemplate(null)}
        title="Replace the current content?"
        description={`Starting from “${pendingName ?? "this template"}” replaces your subject, preview text and body.`}
        confirmLabel="Replace content"
        destructive
        onConfirm={() => {
          if (pendingTemplate) applyTemplate(pendingTemplate);
        }}
      />
      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        timezone={timezone}
        recipients={recipients}
        busy={saving}
        onConfirm={(value) => {
          setScheduleOpen(false);
          send(value);
        }}
      />
    </>
  );
}

function minSchedule(timezone: string) {
  return toZonedLocalInput(new Date(Date.now() + 2 * 60e3), timezone);
}

function defaultSchedule(timezone: string) {
  const tomorrow = toZonedLocalInput(new Date(Date.now() + 24 * 3600e3), timezone);
  return `${tomorrow.slice(0, 10)}T09:00`;
}

function ScheduleDialog({
  open,
  onOpenChange,
  timezone,
  recipients,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  timezone: string;
  recipients: number | null;
  busy: boolean;
  onConfirm: (value: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open && <ScheduleForm timezone={timezone} recipients={recipients} busy={busy} onConfirm={onConfirm} onCancel={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function ScheduleForm({
  timezone,
  recipients,
  busy,
  onConfirm,
  onCancel,
}: {
  timezone: string;
  recipients: number | null;
  busy: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [min] = useState(() => minSchedule(timezone));
  const [value, setValue] = useState(() => defaultSchedule(timezone));
  const invalid = !value || value < min;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) onConfirm(value);
      }}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle>Schedule broadcast</DialogTitle>
        <DialogDescription>
          Choose when to send to {recipients != null ? `${formatNumber(recipients)} ${recipients === 1 ? "person" : "people"}` : "your audience"}. Times are in{" "}
          {timezone.replace(/_/g, " ")}.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="schedule-at">Send at</Label>
        <Input id="schedule-at" type="datetime-local" value={value} min={min} onChange={(e) => setValue(e.target.value)} aria-invalid={invalid} required />
        {invalid && <p className="text-xs text-destructive">Pick a time in the future.</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={invalid || busy}>
          {busy ? <Spinner /> : <CalendarClock />} Schedule send
        </Button>
      </DialogFooter>
    </form>
  );
}
