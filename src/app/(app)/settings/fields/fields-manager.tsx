"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, TextCursorInput, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { FieldErrors } from "@/components/settings/field-error";
import { SettingsCard } from "@/components/settings/settings-card";
import { useRunAction } from "@/components/settings/use-run-action";
import { pluralize, slugify } from "@/lib/format";
import type { CustomFieldType } from "@/lib/types";
import { createFieldAction, deleteFieldAction, moveFieldAction, updateFieldAction } from "./actions";

export type FieldRow = { id: string; key: string; label: string; type: CustomFieldType; options: string[]; usage: number };

const TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Single choice" },
  { value: "multiselect", label: "Multiple choice" },
  { value: "url", label: "URL" },
  { value: "checkbox", label: "Checkbox (yes/no)" },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label])) as Record<CustomFieldType, string>;

export function FieldsManager({ fields }: { fields: FieldRow[] }) {
  const [editing, setEditing] = useState<FieldRow | "new" | null>(null);
  const { run, pending } = useRunAction();

  return (
    <>
      <SettingsCard
        title="Contact fields"
        description={fields.length ? `${pluralize(fields.length, "custom field")}. The order here is the order on the contact card and import mapping.` : undefined}
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Add field
          </Button>
        }
        contentClassName="gap-2"
      >
        {fields.length === 0 ? (
          <EmptyState
            icon={TextCursorInput}
            title="No custom fields yet"
            description="Add fields like “Lead score”, “Industry” or “Preferred language” to keep everything about a contact in one place."
            action={
              <Button onClick={() => setEditing("new")}>
                <Plus /> Add your first field
              </Button>
            }
            className="border-0 bg-transparent"
          />
        ) : (
          <ul className="grid gap-2">
            {fields.map((f, i) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 sm:flex-nowrap">
                <div className="min-w-0 flex-1 basis-48">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{f.label}</span>
                    <Badge variant="secondary">{TYPE_LABEL[f.type]}</Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <code className="font-mono">{`{{contact.custom.${f.key}}}`}</code>
                    <span>{pluralize(f.usage, "contact")} with a value</span>
                    {f.options.length > 0 && <span className="truncate">Options: {f.options.join(", ")}</span>}
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center">
                  <Button variant="ghost" size="icon-sm" disabled={i === 0 || pending} aria-label={`Move ${f.label} up`} onClick={() => run(() => moveFieldAction({ id: f.id, direction: -1 }), { success: "" })}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-sm" disabled={i === fields.length - 1 || pending} aria-label={`Move ${f.label} down`} onClick={() => run(() => moveFieldAction({ id: f.id, direction: 1 }), { success: "" })}>
                    <ArrowDown />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${f.label}`} onClick={() => setEditing(f)}>
                    <Pencil />
                  </Button>
                  <ConfirmDialog
                    title={`Delete “${f.label}”?`}
                    description={
                      f.usage > 0
                        ? `This also removes the value from ${pluralize(f.usage, "contact")}. This can’t be undone. Merge tags and filters that use this field will stop working.`
                        : "No contact has a value for this field. Merge tags and filters that use it will stop working."
                    }
                    confirmLabel="Delete field"
                    destructive
                    onConfirm={async () => {
                      const res = await deleteFieldAction(f.id);
                      if (res.ok) toast.success(res.message);
                      else toast.error(res.error);
                    }}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${f.label}`} className="text-destructive hover:text-destructive">
                        <Trash2 />
                      </Button>
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
      <FieldDialog editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function FieldDialog({ editing, onClose }: { editing: FieldRow | "new" | null; onClose: () => void }) {
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {/* Remount per target so the form state resets. */}
        {editing && <FieldForm key={editing === "new" ? "new" : editing.id} editing={editing} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function FieldForm({ editing, onClose }: { editing: FieldRow | "new"; onClose: () => void }) {
  const existing = editing === "new" ? null : editing;
  const [label, setLabel] = useState(existing?.label ?? "");
  const [type, setType] = useState<CustomFieldType>(existing?.type ?? "text");
  const [optionsText, setOptionsText] = useState((existing?.options ?? []).join("\n"));
  const { run, pending, fieldErrors } = useRunAction();
  const choice = type === "select" || type === "multiselect";
  const keyPreview = existing?.key ?? (slugify(label).replace(/-/g, "_") || "…");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const options = optionsText.split("\n").map((o) => o.trim()).filter(Boolean);
    const input = { label, type, options: choice ? options : [] };
    run(() => (existing ? updateFieldAction({ id: existing.id, ...input }) : createFieldAction(input)), { onSuccess: onClose });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{existing ? "Edit field" : "Add custom field"}</DialogTitle>
        <DialogDescription>{existing ? "The key can’t change because contacts and merge tags already use it." : "Choose a label – the key is generated for you."}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="field-label">Label</Label>
        <Input id="field-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} required autoFocus placeholder="e.g. Lead score" aria-invalid={!!fieldErrors.label} />
        <p className="text-xs text-muted-foreground">
          Key: <code className="font-mono">{keyPreview}</code>
        </p>
        <FieldErrors errors={fieldErrors.label} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="field-type">Type</Label>
        <NativeSelect id="field-type" className="w-full" value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>
          {TYPES.map((t) => (
            <NativeSelectOption key={t.value} value={t.value}>
              {t.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {existing && existing.type !== type && existing.usage > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">Existing values on {pluralize(existing.usage, "contact")} are kept as they are and may not match the new type.</p>
        )}
      </div>
      {choice && (
        <div className="grid gap-2">
          <Label htmlFor="field-options">Options (one per line)</Label>
          <Textarea id="field-options" rows={5} value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder={"Free\nPro\nEnterprise"} />
          <FieldErrors errors={fieldErrors.options} />
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !label.trim()}>
          {pending && <Spinner />} {existing ? "Save field" : "Add field"}
        </Button>
      </DialogFooter>
    </form>
  );
}
