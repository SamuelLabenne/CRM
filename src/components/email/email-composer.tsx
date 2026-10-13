"use client";

import { useState } from "react";
import { Eye, PenLine } from "lucide-react";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { EmailEditor, type EmailEditorValue } from "./email-editor";
import { EmailPreview } from "./email-preview";
import { MergeTagInput, SubjectInput } from "./subject-input";
import type { EmailBranding } from "./types";

export type ComposerValue = EmailEditorValue & { subject: string; preheader: string };

/**
 * Subject + preheader + body editor with a live preview. Side by side on wide screens,
 * a Write/Preview switch on small ones. Used by templates and broadcasts.
 */
export function EmailComposer({
  value,
  onChange,
  branding,
  marketing,
  errors,
  placeholder,
  subjectId = "subject",
}: {
  value: ComposerValue;
  onChange: (value: ComposerValue) => void;
  branding: EmailBranding;
  /** Preview with the unsubscribe footer (broadcasts & marketing templates). */
  marketing?: boolean;
  errors?: { subject?: string };
  placeholder?: string;
  subjectId?: string;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  return (
    <div className="grid gap-4">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={tab}
        onValueChange={(v) => v && setTab(v as "write" | "preview")}
        className="xl:hidden"
        aria-label="Editor view"
      >
        <ToggleGroupItem value="write">
          <PenLine /> Write
        </ToggleGroupItem>
        <ToggleGroupItem value="preview">
          <Eye /> Preview
        </ToggleGroupItem>
      </ToggleGroup>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className={cn("grid min-w-0 content-start gap-4", tab === "preview" && "hidden xl:grid")}>
          <div className="grid gap-1.5">
            <Label htmlFor={subjectId}>Subject</Label>
            <SubjectInput
              id={subjectId}
              value={value.subject}
              onChange={(subject) => onChange({ ...value, subject })}
              aria-invalid={Boolean(errors?.subject)}
            />
            {errors?.subject && <p className="text-xs text-destructive">{errors.subject}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${subjectId}-preheader`}>
              Preview text <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <MergeTagInput
              id={`${subjectId}-preheader`}
              value={value.preheader}
              onChange={(preheader) => onChange({ ...value, preheader })}
              placeholder="The short summary shown next to the subject in the inbox"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Body</Label>
            <EmailEditor
              value={{ json: value.json, html: value.html }}
              onChange={(v) => onChange({ ...value, json: v.json, html: v.html })}
              brandColor={branding.brandColor}
              placeholder={placeholder}
            />
          </div>
        </div>

        <div className={cn("min-w-0 xl:sticky xl:top-20 xl:self-start", tab === "write" && "hidden xl:block")}>
          <EmailPreview subject={value.subject} preheader={value.preheader} html={value.html} branding={branding} marketing={marketing} />
        </div>
      </div>
    </div>
  );
}
