"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { CustomFieldLite } from "@/lib/contacts/custom-values";

/** Edit control for one custom field value (value shape matches contacts.custom_fields). */
export function CustomFieldInput({
  def,
  value,
  onChange,
  id,
  invalid,
}: {
  def: CustomFieldLite;
  value: unknown;
  onChange: (v: unknown) => void;
  id?: string;
  invalid?: boolean;
}) {
  const str = value == null ? "" : String(value);
  switch (def.type) {
    case "textarea":
      return <Textarea id={id} value={str} rows={3} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <Input id={id} type="number" inputMode="decimal" value={str} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <Input id={id} type="date" value={str} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} />;
    case "url":
      return <Input id={id} type="url" placeholder="https://" value={str} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} />;
    case "select":
      return (
        <NativeSelect id={id} className="w-full" value={str} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)}>
          <NativeSelectOption value="">—</NativeSelectOption>
          {(def.options ?? []).map((o) => (
            <NativeSelectOption key={o} value={o}>
              {o}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {(def.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm has-checked:border-primary has-checked:bg-accent">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={selected.includes(o)}
                onChange={(e) => onChange(e.target.checked ? [...selected, o] : selected.filter((x) => x !== o))}
              />
              {o}
            </label>
          ))}
          {!(def.options ?? []).length && <p className="text-sm text-muted-foreground">No options configured for this field.</p>}
        </div>
      );
    }
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input id={id} type="checkbox" className="accent-[var(--primary)]" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          Yes
        </label>
      );
    default:
      return <Input id={id} value={str} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} />;
  }
}
