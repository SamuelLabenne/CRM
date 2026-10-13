"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Code2, Copy, ExternalLink, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(key);
        toast.success("Copied to clipboard");
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
      } catch {
        toast.error("Couldn't copy. Select the text and copy it manually.");
      }
    },
  };
}

/** Public link + embed snippet for a registration page (event) or booking page. */
export function ShareCard({
  url,
  embedUrl,
  live,
  notLiveReason,
  embedId,
  title = "Share",
}: {
  url: string;
  embedUrl: string;
  live: boolean;
  notLiveReason?: string;
  embedId: string;
  title?: string;
}) {
  const { copied, copy } = useCopy();
  const snippet = `<iframe id="relay-${embedId}" src="${embedUrl}" title="Registration" style="width:100%;min-height:640px;border:0" loading="lazy"></iframe>
<script>
  window.addEventListener("message", function (e) {
    var f = document.getElementById("relay-${embedId}");
    if (f && e.source === f.contentWindow && e.data && e.data.type === "relay:resize") f.style.height = e.data.height + "px";
  });
</script>`;
  return (
    <Card className="gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" /> Live
          </span>
        ) : (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Not live</span>
        )}
      </div>
      {!live && notLiveReason && <p className="-mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{notLiveReason}</p>}
      <div className="grid gap-1.5">
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground" htmlFor="share-link">
          <Link2 className="size-3.5" /> Registration link
        </label>
        <div className="flex gap-2">
          <input id="share-link" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-8 min-w-0 flex-1 rounded-lg border bg-muted/40 px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
          <Button type="button" variant="outline" size="icon" onClick={() => copy("link", url)} aria-label="Copy link">
            {copied === "link" ? <Check className="text-emerald-600" /> : <Copy />}
          </Button>
          <Button asChild variant="outline" size="icon" aria-label="Open page">
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink />
            </a>
          </Button>
        </div>
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Code2 className="size-3.5" /> Embed on your website
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={() => copy("embed", snippet)}>
            {copied === "embed" ? <Check className="text-emerald-600" /> : <Copy />} Copy code
          </Button>
        </div>
        <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/40 p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap break-all">{snippet}</pre>
        <p className="text-xs text-muted-foreground">The iframe resizes itself to fit the form. Prefill with <code className="rounded bg-muted px-1">?email=</code>, <code className="rounded bg-muted px-1">?first_name=</code>, UTM params are tracked.</p>
      </div>
    </Card>
  );
}
