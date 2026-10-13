"use client";

/**
 * FilterBuilder – reusable, fully controlled editor for a contact `FilterGroup`
 * (the same structure consumed by `buildContactWhere()` in `@/lib/contacts/filters`, saved on
 * Smart Views, broadcast audiences `{type:"filter"}` and automation conditions).
 *
 * ```tsx
 * const [group, setGroup] = useState<FilterGroup>({ match: "all", filters: [] });
 * <FilterBuilder value={group} onChange={setGroup} options={{ tags, users, stages, customFields, events }} />
 * ```
 *
 * Props
 *  - `value`     The current group. `match` is "all" (AND) or "any" (OR); `filters` is the list of rows.
 *                Incomplete rows (e.g. no value picked yet) are kept while editing so the UI doesn't jump;
 *                strip them before saving/applying with `sanitizeFilterGroup()` from
 *                `@/lib/contacts/filter-codec`.
 *  - `onChange`  Called with a new group on every edit (never mutates `value`).
 *  - `options`   Reference data for the pickers (see `FilterOptions`): `tags` {id,name}, `users` {id,name},
 *                `stages` {key,label}, `customFields` {key,label,type,options?} (from custom_field_defs) and
 *                `events` {id,title}. Pass empty arrays for anything you don't have.
 *  - `className` Optional wrapper class.
 *  - `emptyHint` Optional text shown when there are no rows.
 *
 * Helpers (all client-safe) live next to it:
 *  - `@/lib/contacts/filter-codec`  `encodeFilter` / `decodeFilter` (`?f=<base64url JSON>`), `sanitizeFilterGroup`
 *  - `@/lib/contacts/filter-fields` `describeFilter(filter, options)` for chips, `FilterOptions`
 *  - server: `buildContactWhere(group)` turns the group into SQL.
 */

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { operatorTakesNoValue } from "@/lib/contacts/filter-codec";
import {
  buildFieldList,
  defaultOperator,
  operatorLabel,
  operatorsFor,
  type FilterFieldDef,
  type FilterOptions,
} from "@/lib/contacts/filter-fields";
import type { ContactFilter, FilterGroup, FilterOperator } from "@/lib/types";
import { cn } from "@/lib/utils";

export type { FilterOptions } from "@/lib/contacts/filter-fields";

const GROUP_ORDER: FilterFieldDef["group"][] = ["Contact", "Pipeline", "Activity", "Tags & events", "Custom fields"];

export function FilterBuilder({
  value,
  onChange,
  options,
  className,
  emptyHint = "No filters yet – showing everyone.",
}: {
  value: FilterGroup;
  onChange: (group: FilterGroup) => void;
  options: FilterOptions;
  className?: string;
  emptyHint?: string;
}) {
  const fields = buildFieldList(options);
  const byKey = new Map(fields.map((f) => [f.key, f]));

  const update = (i: number, next: ContactFilter) => onChange({ ...value, filters: value.filters.map((f, j) => (j === i ? next : f)) });
  const remove = (i: number) => onChange({ ...value, filters: value.filters.filter((_, j) => j !== i) });
  const add = () => {
    const first = fields.find((f) => f.key === "stage") ?? fields[0];
    onChange({ ...value, filters: [...value.filters, { field: first.key, operator: defaultOperator(first), value: null }] });
  };

  return (
    <div className={cn("grid gap-3", className)}>
      {value.filters.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Match</span>
          <NativeSelect
            size="sm"
            aria-label="Match all or any filter"
            value={value.match}
            onChange={(e) => onChange({ ...value, match: e.target.value === "any" ? "any" : "all" })}
          >
            <NativeSelectOption value="all">all</NativeSelectOption>
            <NativeSelectOption value="any">any</NativeSelectOption>
          </NativeSelect>
          <span className="text-muted-foreground">of these filters</span>
        </div>
      )}

      {value.filters.length === 0 && <p className="text-sm text-muted-foreground">{emptyHint}</p>}

      <div className="grid gap-2">
        {value.filters.map((f, i) => {
          const def = byKey.get(f.field);
          const ops = def ? operatorsFor(def) : [];
          return (
            <div key={i} className="grid gap-2 rounded-lg border bg-muted/30 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_auto] sm:items-center sm:border-0 sm:bg-transparent sm:p-0">
              <NativeSelect
                className="w-full"
                aria-label="Filter field"
                value={f.field}
                onChange={(e) => {
                  const nd = byKey.get(e.target.value);
                  if (nd) update(i, { field: nd.key, operator: defaultOperator(nd), value: null });
                }}
              >
                {!def && <NativeSelectOption value={f.field}>{f.field}</NativeSelectOption>}
                {GROUP_ORDER.map((g) => {
                  const inGroup = fields.filter((x) => x.group === g);
                  return inGroup.length ? (
                    <NativeSelectOptGroup key={g} label={g}>
                      {inGroup.map((x) => (
                        <NativeSelectOption key={x.key} value={x.key}>
                          {x.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelectOptGroup>
                  ) : null;
                })}
              </NativeSelect>
              <NativeSelect
                className="w-full"
                aria-label="Filter operator"
                value={f.operator}
                onChange={(e) => {
                  const op = e.target.value as FilterOperator;
                  const keepValue = !operatorTakesNoValue(op) && (f.operator === op || sameValueShape(f.operator, op));
                  update(i, { ...f, operator: op, value: keepValue ? f.value : null });
                }}
              >
                {ops.map((op) => (
                  <NativeSelectOption key={op} value={op}>
                    {operatorLabel(def, op)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <ValueInput filter={f} def={def} options={options} onChange={(v) => update(i, { ...f, value: v })} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove filter" onClick={() => remove(i)}>
                <Trash2 />
              </Button>
            </div>
          );
        })}
      </div>

      <div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus /> Add filter
        </Button>
      </div>
    </div>
  );
}

/** Operators that take the same kind of value, so switching between them keeps what was typed. */
function sameValueShape(a: FilterOperator, b: FilterOperator) {
  const text = new Set<FilterOperator>(["contains", "not_contains", "is", "is_not"]);
  const date = new Set<FilterOperator>(["before", "after"]);
  const count = new Set<FilterOperator>(["gt", "lt", "in_last_days"]);
  return (text.has(a) && text.has(b)) || (date.has(a) && date.has(b)) || (count.has(a) && count.has(b)) || (a === "has" && b === "has_not") || (a === "has_not" && b === "has");
}

function ValueInput({
  filter,
  def,
  options,
  onChange,
}: {
  filter: ContactFilter;
  def: FilterFieldDef | undefined;
  options: FilterOptions;
  onChange: (v: ContactFilter["value"]) => void;
}) {
  if (operatorTakesNoValue(filter.operator)) return <div className="hidden sm:block" />;
  const raw = Array.isArray(filter.value) ? (filter.value[0] ?? "") : (filter.value ?? "");
  const str = String(raw);
  const kind = def?.kind ?? "text";

  const select = (opts: { value: string; label: string }[], placeholder = "Select…") => {
    const known = opts.some((o) => o.value === str);
    return (
      <NativeSelect className="w-full" aria-label="Filter value" value={str} onChange={(e) => onChange(e.target.value || null)}>
        <NativeSelectOption value="">{placeholder}</NativeSelectOption>
        {str && !known && <NativeSelectOption value={str}>{str}</NativeSelectOption>}
        {opts.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  };

  switch (kind) {
    case "select":
    case "multiselect":
      return select(def?.options ?? []);
    case "bool":
      return select([
        { value: "true", label: "Checked" },
        { value: "false", label: "Unchecked" },
      ]);
    case "tag":
      return select(options.tags.map((t) => ({ value: t.id, label: t.name })), "Select a tag…");
    case "event":
    case "attended_event":
      return select(options.events.map((e) => ({ value: e.id, label: e.title })), "Select an event…");
    case "number":
      return (
        <Input
          type="number"
          inputMode="decimal"
          aria-label="Filter value"
          placeholder="0"
          value={str}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    case "date":
      return filter.operator === "in_last_days" ? (
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          aria-label="Number of days"
          placeholder="Days, e.g. 30"
          value={str}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      ) : (
        <Input type="date" aria-label="Filter date" value={str.slice(0, 10)} onChange={(e) => onChange(e.target.value || null)} />
      );
    default:
      return <Input aria-label="Filter value" placeholder="Value" value={str} onChange={(e) => onChange(e.target.value || null)} />;
  }
}
