"use client";

import { useState } from "react";
import { FileText, Monitor, Smartphone } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { EmailFrame } from "./email-frame";

/** Read-only viewer for a stored message: rendered HTML (desktop/mobile) or the plain-text part. */
export function MessageViewer({ html, text }: { html: string; text: string | null }) {
  const [mode, setMode] = useState<"desktop" | "mobile" | "text">("desktop");
  return (
    <div className="grid gap-3">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={mode}
        onValueChange={(v) => v && setMode(v as typeof mode)}
        aria-label="View as"
        className="w-fit"
      >
        <ToggleGroupItem value="desktop">
          <Monitor /> Desktop
        </ToggleGroupItem>
        <ToggleGroupItem value="mobile">
          <Smartphone /> Mobile
        </ToggleGroupItem>
        <ToggleGroupItem value="text">
          <FileText /> Plain text
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="overflow-hidden rounded-lg border bg-muted/40">
        {mode === "text" ? (
          <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">{text || "This message has no plain-text version."}</pre>
        ) : (
          <div className="max-h-[75vh] overflow-auto p-3 sm:p-4">
            <div
              className={cn(
                "mx-auto overflow-hidden bg-white shadow-sm",
                mode === "mobile" ? "w-[375px] max-w-full rounded-[1.75rem] border-[6px] border-foreground/80" : "w-full max-w-[680px] rounded-md border",
              )}
            >
              <EmailFrame html={html} title="Message" width={mode === "mobile" ? 363 : undefined} minHeight={400} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
