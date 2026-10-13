"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { Monitor, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ContactPicker, type PickedContact } from "@/components/app/contact-picker";
import { applyMergeTags, sampleMergeContext, type MergeContext } from "@/lib/email/merge-tags";
import { inlineEmailStyles, renderEmailLayout } from "@/lib/email/layout";
import { prepareForPreviewFrame } from "@/lib/email/html";
import { cn } from "@/lib/utils";
import { previewContextAction, sendTestEmailAction } from "./actions";
import { EmailFrame } from "./email-frame";
import type { EmailBranding } from "./types";

const EMPTY_BODY = `<p style="color:#9ca3af;text-align:center;margin:40px 0;">Your email is empty. Start writing and the preview will update here.</p>`;

/** Fully rendered email document (merge tags applied, styles inlined, layout wrapped) for previews. */
export function renderPreviewDocument(opts: {
  html: string;
  preheader?: string | null;
  branding: EmailBranding;
  ctx: MergeContext;
  marketing?: boolean;
}) {
  const { branding, ctx } = opts;
  const body = inlineEmailStyles(applyMergeTags(opts.html.trim() ? opts.html : EMPTY_BODY, ctx, { html: true }), branding.brandColor);
  const doc = renderEmailLayout({
    bodyHtml: body,
    preheader: opts.preheader ? applyMergeTags(opts.preheader, ctx, { html: false }) : null,
    brandColor: branding.brandColor,
    workspaceName: branding.name,
    logoUrl: branding.logoUrl,
    address: branding.address,
    unsubscribeUrl: opts.marketing && typeof ctx.unsubscribe_url === "string" ? ctx.unsubscribe_url : null,
  });
  return prepareForPreviewFrame(doc);
}

export type EmailPreviewProps = {
  subject: string;
  preheader?: string | null;
  html: string;
  branding: EmailBranding;
  /** Show the unsubscribe footer, like a real marketing send. */
  marketing?: boolean;
  /** Hide the contact picker / send-test controls (read-only previews). */
  readOnly?: boolean;
  className?: string;
};

/** Live preview with desktop/mobile toggle, "preview as contact" and "send test". */
export function EmailPreview({ subject, preheader, html, branding, marketing, readOnly, className }: EmailPreviewProps) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [ctx, setCtx] = useState<MergeContext | null>(null);
  const [loading, startLoad] = useTransition();
  const [sending, startSend] = useTransition();

  const deferredHtml = useDeferredValue(html);
  const sample = useMemo(() => sampleMergeContext(), []);
  const activeCtx = ctx ?? sample;

  const doc = useMemo(
    () => renderPreviewDocument({ html: deferredHtml, preheader, branding, ctx: activeCtx, marketing }),
    [deferredHtml, preheader, branding, activeCtx, marketing],
  );
  const renderedSubject = applyMergeTags(subject || "", activeCtx, { html: false }).trim();
  const renderedPreheader = preheader ? applyMergeTags(preheader, activeCtx, { html: false }).trim() : "";

  const pickContact = (c: PickedContact | null) => {
    setContact(c);
    if (!c) {
      setCtx(null);
      return;
    }
    startLoad(async () => {
      const res = await previewContextAction(c.id);
      if (res.ok && res.data) setCtx(res.data);
      else toast.error(res.ok ? "Could not load that contact" : res.error);
    });
  };

  const sendTest = () =>
    startSend(async () => {
      const res = await sendTestEmailAction({ subject, preheader: preheader ?? null, html, contactId: contact?.id ?? null, marketing });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Test email sent to ${res.data?.to}`, {
        description: res.data?.simulated ? "Outbox mode: the message was simulated. Find it in Emails → Outbox." : undefined,
      });
    });

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={device}
          onValueChange={(v) => v && setDevice(v as "desktop" | "mobile")}
          aria-label="Preview size"
        >
          <ToggleGroupItem value="desktop" aria-label="Desktop preview">
            <Monitor /> Desktop
          </ToggleGroupItem>
          <ToggleGroupItem value="mobile" aria-label="Mobile preview">
            <Smartphone /> Mobile
          </ToggleGroupItem>
        </ToggleGroup>
        {!readOnly && (
          <>
            <div className="flex min-w-48 flex-1 items-center gap-2 sm:max-w-72">
              <ContactPicker value={contact} onChange={pickContact} placeholder="Preview as contact…" className="h-8" />
              {loading && <Spinner />}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={sendTest} disabled={sending || !html.trim()} className="ml-auto">
              {sending ? <Spinner /> : <Send />} Send test
            </Button>
          </>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border bg-muted/40">
        <div className="border-b bg-card px-4 py-2.5 text-sm">
          <div className="truncate font-medium">{renderedSubject || <span className="text-muted-foreground">(no subject)</span>}</div>
          <div className="truncate text-xs text-muted-foreground">
            {renderedPreheader || (contact ? `Previewing as ${contact.name}` : "Previewing with sample data")}
          </div>
        </div>
        <div className="max-h-[70vh] overflow-auto p-3 sm:p-4">
          <div
            className={cn(
              "mx-auto overflow-hidden bg-white shadow-sm transition-[width]",
              device === "mobile" ? "w-[375px] max-w-full rounded-[1.75rem] border-[6px] border-foreground/80" : "w-full max-w-[680px] rounded-md border",
            )}
          >
            <EmailFrame html={doc} width={device === "mobile" ? 363 : undefined} className={device === "mobile" ? "w-full" : undefined} />
          </div>
        </div>
      </div>
    </div>
  );
}
