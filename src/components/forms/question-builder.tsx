"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { FormQuestion, FormQuestionType } from "@/lib/types";

const TYPES: { value: FormQuestionType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "select", label: "Single choice" },
  { value: "multiselect", label: "Multiple choice" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
  { value: "checkbox", label: "Checkbox (yes/no)" },
];

export const CONTACT_MAP_TARGETS = [
  { value: "company", label: "Company" },
  { value: "job_title", label: "Job title" },
  { value: "phone", label: "Phone" },
  { value: "website", label: "Website" },
  { value: "city", label: "City" },
  { value: "country", label: "Country" },
];

/** Editor for public form questions (event registration & booking pages). Controlled component. */
export function QuestionBuilder({
  value,
  onChange,
  customFields = [],
}: {
  value: FormQuestion[];
  onChange: (next: FormQuestion[]) => void;
  /** Custom contact fields that answers can be saved into. */
  customFields?: { key: string; label: string }[];
}) {
  const update = (i: number, patch: Partial<FormQuestion>) => onChange(value.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () =>
    onChange([...value, { id: `q_${nanoid(6)}`, label: "New question", type: "text", required: false, options: [], mapTo: null }]);

  return (
    <div className="grid gap-3">
      {value.length === 0 && (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No extra questions. Name and email are always asked.
        </p>
      )}
      {value.map((q, i) => (
        <div key={q.id} className="grid gap-3 rounded-lg border bg-card p-3">
          <div className="flex items-start gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label className="text-xs text-muted-foreground">Question</Label>
              <Input value={q.label} onChange={(e) => update(i, { label: e.target.value })} />
            </div>
            <div className="flex gap-1 pt-5">
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                <ArrowUp />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => move(i, 1)} disabled={i === value.length - 1} aria-label="Move down">
                <ArrowDown />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(value.filter((_, idx) => idx !== i))} aria-label="Delete question">
                <Trash2 />
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <NativeSelect value={q.type} onChange={(e) => update(i, { type: e.target.value as FormQuestionType })}>
                {TYPES.map((t) => (
                  <NativeSelectOption key={t.value} value={t.value}>
                    {t.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Save answer to contact</Label>
              <NativeSelect value={q.mapTo ?? ""} onChange={(e) => update(i, { mapTo: e.target.value || null })}>
                <NativeSelectOption value="">Don&apos;t save</NativeSelectOption>
                {CONTACT_MAP_TARGETS.map((t) => (
                  <NativeSelectOption key={t.value} value={t.value}>
                    {t.label}
                  </NativeSelectOption>
                ))}
                {customFields.map((f) => (
                  <NativeSelectOption key={f.key} value={`custom:${f.key}`}>
                    {f.label} (custom)
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <label className="flex items-center gap-2 pt-5 text-sm">
              <Switch checked={q.required} onCheckedChange={(v) => update(i, { required: v })} /> Required
            </label>
          </div>
          {(q.type === "select" || q.type === "multiselect") && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Options (one per line)</Label>
              <Textarea
                rows={3}
                value={(q.options ?? []).join("\n")}
                onChange={(e) => update(i, { options: e.target.value.split("\n").map((s) => s.trimStart()) })}
                onBlur={(e) => update(i, { options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
              />
            </div>
          )}
          {(q.type === "text" || q.type === "textarea" || q.type === "url" || q.type === "number") && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Placeholder</Label>
              <Input value={q.placeholder ?? ""} onChange={(e) => update(i, { placeholder: e.target.value })} />
            </div>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" onClick={add} className="w-fit">
        <Plus /> Add question
      </Button>
    </div>
  );
}
