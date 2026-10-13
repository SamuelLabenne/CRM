"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  CONDITION_FIELDS,
  OPERATOR_LABELS,
  conditionFieldFor,
  operatorsFor,
  valueless,
  type ConditionField,
  type BuilderLookups,
} from "@/lib/automations/meta";
import type { ContactFilter, FilterGroup, FilterOperator } from "@/lib/types";
import { ValueSelect } from "./fields";

/**
 * Minimal contact-filter editor for condition steps: field / operator / value rows joined by
 * "all" or "any". (The engine understands every FilterGroup field; this editor offers the common ones.)
 */
export function FilterRows({
  value,
  onChange,
  lookups,
}: {
  value: FilterGroup;
  onChange: (next: FilterGroup) => void;
  lookups: Pick<BuilderLookups, "tags" | "stages" | "customFields">;
}) {
  const fields: ConditionField[] = [
    ...CONDITION_FIELDS,
    ...lookups.customFields.map((c) => ({ value: `custom:${c.key}`, label: `${c.label} (custom)`, kind: "text" as const })),
  ];

  const update = (i: number, patch: Partial<ContactFilter>) =>
    onChange({ ...value, filters: value.filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });

  const changeField = (i: number, field: string) => {
    const def = conditionFieldFor(field, lookups.customFields);
    const operator = operatorsFor(def?.kind ?? "text")[0];
    update(i, { field, operator, value: null });
  };

  const add = () =>
    onChange({ ...value, filters: [...value.filters, { field: "stage", operator: "is", value: null }] });

  return (
    <div className="grid gap-3">
      {value.filters.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Contact must match</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={value.match}
            onValueChange={(v) => v && onChange({ ...value, match: v as "all" | "any" })}
          >
            <ToggleGroupItem value="all">all</ToggleGroupItem>
            <ToggleGroupItem value="any">any</ToggleGroupItem>
          </ToggleGroup>
          <span className="text-muted-foreground">of these</span>
        </div>
      )}

      {value.filters.length === 0 && (
        <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">No contact filters yet.</p>
      )}

      {value.filters.map((f, i) => {
        const def = conditionFieldFor(f.field, lookups.customFields);
        const kind = def?.kind ?? "text";
        const ops = operatorsFor(kind);
        return (
          <div key={i} className="grid gap-2 rounded-lg border bg-card p-2.5 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-2">
              <NativeSelect className="w-full" value={f.field} onChange={(e) => changeField(i, e.target.value)} aria-label="Field">
                {fields.map((o) => (
                  <NativeSelectOption key={o.value} value={o.value}>
                    {o.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                <NativeSelect
                  className="w-full sm:w-36"
                  value={f.operator}
                  onChange={(e) => update(i, { operator: e.target.value as FilterOperator })}
                  aria-label="Operator"
                >
                  {ops.map((op) => (
                    <NativeSelectOption key={op} value={op}>
                      {OPERATOR_LABELS[op] ?? op}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {valueless(f.operator) ? (
                  <div />
                ) : kind === "tag" ? (
                  <ValueSelect
                    value={typeof f.value === "string" ? f.value : null}
                    onChange={(v) => update(i, { value: v })}
                    options={lookups.tags.map((t) => ({ value: t.id, label: t.name }))}
                    placeholder="Choose a tag"
                  />
                ) : kind === "stage" ? (
                  <ValueSelect
                    value={typeof f.value === "string" ? f.value : null}
                    onChange={(v) => update(i, { value: v })}
                    options={lookups.stages.map((s) => ({ value: s.key, label: s.label }))}
                    placeholder="Choose a stage"
                  />
                ) : kind === "enum" && def?.options ? (
                  <ValueSelect
                    value={typeof f.value === "string" ? f.value : null}
                    onChange={(v) => update(i, { value: v })}
                    options={def.options}
                    placeholder="Choose a value"
                  />
                ) : (
                  <Input
                    value={typeof f.value === "string" || typeof f.value === "number" ? String(f.value) : ""}
                    onChange={(e) => update(i, { value: e.target.value })}
                    placeholder="Value"
                    aria-label="Value"
                  />
                )}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove condition"
              onClick={() => onChange({ ...value, filters: value.filters.filter((_, idx) => idx !== i) })}
            >
              <X />
            </Button>
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={add}>
        <Plus /> Add condition
      </Button>
    </div>
  );
}
