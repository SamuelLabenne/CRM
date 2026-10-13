"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, FlaskConical, Mail, TriangleAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { sendContactEmailAction, type SendEmailOutcome } from "@/app/(app)/contacts/actions";
import { applyMergeTags, sampleMergeContext, type MergeContext } from "@/lib/email/merge-tags";
import { inlineEmailStyles, renderEmailLayout } from "@/lib/email/layout";

export type TemplateOption = { id: string; name: string; subject: string; contentHtml: string };

/** Compose and send a one-to-one email to a contact (template or plain text) via sendEmail({kind:"manual"}). */
export function SendEmailDialog({
  open,
  onOpenChange,
  contact,
  templates,
  workspace,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contact: { id: string; name: string; email: string | null; emailStatus: string; firstName: string | null; lastName: string | null; company: string | null; jobTitle: string | null; phone: string | null };
  templates: TemplateOption[];
  workspace: { name: string; brandColor: string };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {open && <Form key="form" contact={contact} templates={templates} workspace={workspace} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Form({ contact, templates, workspace, onClose }: { contact: React.ComponentProps<typeof SendEmailDialog>["contact"]; templates: TemplateOption[]; workspace: { name: string; brandColor: string }; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"template" | "custom">(templates.length ? "template" : "custom");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SendEmailOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const template = templates.find((t) => t.id === templateId) ?? null;
  const ctx: MergeContext = useMemo(() => {
    const base = sampleMergeContext();
    return {
      ...base,
      contact: {
        first_name: contact.firstName,
        last_name: contact.lastName,
        full_name: contact.name,
        email: contact.email,
        company: contact.company,
        job_title: contact.jobTitle,
        phone: contact.phone,
      },
      workspace: { name: workspace.name },
    };
  }, [contact, workspace.name]);

  const preview = useMemo(() => {
    if (!template) return "";
    return renderEmailLayout({
      bodyHtml: inlineEmailStyles(applyMergeTags(template.contentHtml, ctx), workspace.brandColor),
      brandColor: workspace.brandColor,
      workspaceName: workspace.name,
    });
  }, [template, ctx, workspace]);

  const pick = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) setSubject(t.subject);
  };

  const send = () => {
    setError(null);
    start(async () => {
      const res = await sendContactEmailAction(contact.id, { templateId: mode === "template" ? templateId : null, subject, body: mode === "custom" ? body : "" });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      setResult(res.data!);
      if (res.data!.status === "sent") toast.success(`Email sent to ${contact.email}`);
      else if (res.data!.status === "simulated") toast.success("Email simulated (outbox mode)");
      else toast.error(res.data!.detail ?? "The email was not sent");
      router.refresh();
    });
  };

  if (result) return <Result result={result} email={contact.email} onClose={onClose} onAgain={() => setResult(null)} />;

  const canSend = !!subject.trim() && (mode === "template" ? !!templateId : !!body.trim());
  return (
    <>
      <DialogHeader>
        <DialogTitle>Email {contact.name}</DialogTitle>
        <DialogDescription>
          To <span className="font-medium text-foreground">{contact.email}</span>. Merge tags like {"{{contact.first_name}}"} are filled in automatically.
        </DialogDescription>
      </DialogHeader>
      {contact.emailStatus !== "subscribed" && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {contact.emailStatus === "unsubscribed"
            ? "This contact unsubscribed from marketing emails. A one-to-one email will still be delivered – only send what they'd expect."
            : `This contact's address is marked ${contact.emailStatus}; delivery will be skipped.`}
        </p>
      )}
      <div className="inline-flex w-fit rounded-lg bg-muted p-0.5 text-sm" role="tablist">
        {(
          [
            ["template", "From template"],
            ["custom", "Write my own"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            disabled={key === "template" && !templates.length}
            onClick={() => setMode(key)}
            className={`rounded-md px-3 py-1 font-medium transition-colors disabled:opacity-50 ${mode === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "template" && (
        <div className="grid gap-1.5">
          <Label htmlFor="mail-template">Template</Label>
          <NativeSelect id="mail-template" className="w-full" value={templateId} onChange={(e) => pick(e.target.value)}>
            <NativeSelectOption value="">Choose a template…</NativeSelectOption>
            {templates.map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                {t.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="mail-subject">Subject</Label>
        <Input id="mail-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" maxLength={300} />
      </div>
      {mode === "custom" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="mail-body">Message</Label>
          <Textarea id="mail-body" rows={9} value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Hi {{contact.first_name | "there"}},\n\n…`} />
          <p className="text-xs text-muted-foreground">Plain text – blank lines start a new paragraph. It is sent inside your branded email layout.</p>
        </div>
      ) : (
        template && (
          <div className="grid gap-1.5">
            <Label>Preview</Label>
            <iframe title="Email preview" srcDoc={preview} sandbox="" className="h-72 w-full rounded-lg border bg-white" />
          </div>
        )
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" onClick={send} disabled={pending || !canSend}>
          {pending ? <Spinner /> : <Mail />} Send email
        </Button>
      </DialogFooter>
    </>
  );
}

function Result({ result, email, onClose, onAgain }: { result: SendEmailOutcome; email: string | null; onClose: () => void; onAgain: () => void }) {
  const view = result.messageId ? (
    <Button variant="outline" asChild>
      <Link href={`/emails/outbox/${result.messageId}`}>
        View in outbox <ExternalLink />
      </Link>
    </Button>
  ) : null;
  const ok = result.status === "sent" || result.status === "simulated";
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {result.status === "simulated" ? <FlaskConical className="size-5 text-sky-500" /> : ok ? <CheckCircle2 className="size-5 text-emerald-500" /> : <XCircle className="size-5 text-destructive" />}
          {result.status === "sent" && "Email sent"}
          {result.status === "simulated" && "Email simulated"}
          {result.status === "failed" && "Email failed"}
          {result.status === "skipped" && "Email not sent"}
        </DialogTitle>
        <DialogDescription>
          {result.status === "sent" && `Delivered to your email provider for ${email}. It's logged on the contact's journey.`}
          {result.status === "simulated" && "Your email provider is set to Outbox, so nothing left the system – the message was recorded and is visible in the outbox and on the contact's journey. Connect Resend or SMTP in Settings → Email to deliver for real."}
          {result.status === "failed" && (result.detail ?? "The provider rejected the message.")}
          {result.status === "skipped" && (result.detail ?? "The recipient can't receive this email.")}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        {view}
        <Button variant="outline" onClick={onAgain}>
          Write another
        </Button>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}
