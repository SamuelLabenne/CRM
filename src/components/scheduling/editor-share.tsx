"use client";

import { ExternalLink, QrCode, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inlineEmbedSnippet, popupEmbedSnippet } from "@/lib/scheduling/embed";
import { Card } from "./editor-setup";
import { CopyButton } from "./copy-button";

function Snippet({ title, description, code }: { title: string; description: string; code: string }) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <CopyButton text={code} label="Copy code" successMessage="Embed code copied" />
      </div>
      <pre className="max-h-56 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function ShareTab({
  slug,
  savedSlug,
  origin,
  qrDataUrl,
  color,
  isActive,
  stats,
}: {
  slug: string;
  savedSlug: string;
  origin: string;
  qrDataUrl: string;
  color: string;
  isActive: boolean;
  stats: { bookings30: number; views30: number };
}) {
  const publicUrl = `${origin}/book/${savedSlug}`;
  const embedUrl = `${origin}/embed/book/${savedSlug}`;
  const conversion = stats.views30 ? `${Math.round((stats.bookings30 / stats.views30) * 1000) / 10}%` : "–";
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid content-start gap-5">
        {slug !== savedSlug && (
          <p className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <TriangleAlert className="size-4 shrink-0 text-amber-600" /> You changed the link but have not saved yet. The links below still use the saved one.
          </p>
        )}
        {!isActive && (
          <p className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <TriangleAlert className="size-4 shrink-0 text-amber-600" /> This page is paused – visitors will see a &ldquo;not available&rdquo; message until you activate it.
          </p>
        )}
        <Card title="Public link" description="Share it anywhere – email signatures, social bios, ads. Add ?utm_source=… to track where bookings come from.">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={publicUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Public link" />
            <div className="flex gap-2">
              <CopyButton text={publicUrl} label="Copy link" successMessage="Link copied" variant="default" />
              <Button asChild variant="outline" size="sm">
                <a href={`/book/${savedSlug}`} target="_blank" rel="noreferrer">
                  <ExternalLink /> Open
                </a>
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Prefill the form with <code className="rounded bg-muted px-1">?name=Ada%20Lovelace&amp;email=ada@example.com</code>.
          </p>
        </Card>

        <Card title="Embed on your website" description="The embedded widget has no header or footer and keeps your accent color.">
          <Snippet title="Inline embed" description="Paste where the calendar should appear. The frame resizes itself." code={inlineEmbedSnippet(embedUrl)} />
          <Snippet title="Popup button" description="A button that opens the booking widget in an overlay." code={popupEmbedSnippet(embedUrl, { color })} />
        </Card>
      </div>

      <div className="grid content-start gap-5">
        <Card title="QR code" description="Great for print, events and slides.">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt={`QR code for ${publicUrl}`} className="mx-auto w-full max-w-56 rounded-lg border bg-white p-2" />
          <Button asChild variant="outline" className="w-full">
            <a href={qrDataUrl} download={`booking-${savedSlug}.png`}>
              <QrCode /> Download PNG
            </a>
          </Button>
        </Card>
        <Card title="Last 30 days">
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div>
              <dt className="text-xs text-muted-foreground">Visitors</dt>
              <dd className="text-xl font-semibold tabular-nums">{stats.views30}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Bookings</dt>
              <dd className="text-xl font-semibold tabular-nums">{stats.bookings30}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Conversion</dt>
              <dd className="text-xl font-semibold tabular-nums">{conversion}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
