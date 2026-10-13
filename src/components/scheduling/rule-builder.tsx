"use client";

import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { FormQuestion, RuleCondition, RuleGroup, RuleOperator } from "@/lib/types";
import { cn } from "@/lib/utils";

type OpDef = { value: RuleOperator; label: string; input: "none" | "options" | "option" | "text" | "number" | "boolean" };

/** Operators offered per question type (must match conditionMatches in src/lib/leads.ts). */
function operatorsFor(q: FormQuestion | undefined): OpDef[] {
  const empty: OpDef[] = [
    { value: "is_empty", label: "is empty", input: "none" },
    { value: "is_not_empty", label: "is not empty", input: "none" },
  ];
  switch (q?.type) {
    case "select":
      return [
        { value: "is", label: "is any of", input: "options" },
        { value: "is_not", label: "is none of", input: "options" },
        ...empty,
      ];
    case "multiselect":
      return [
        { value: "is", label: "includes any of", input: "options" },
        { value: "is_not", label: "includes none of", input: "options" },
        ...empty,
      ];
    case "number":
      return [
        { value: "is", label: "equals", input: "number" },
        { value: "is_not", label: "does not equal", input: "number" },
        { value: "lt", label: "is less than", input: "number" },
        { value: "gt", label: "is greater than", input: "number" },
        ...empty,
      ];
    case "checkbox":
      return [{ value: "is", label: "is", input: "boolean" }];
    case "date":
      return [
        { value: "is", label: "is", input: "text" },
        { value: "is_not", label: "is not", input: "text" },
        ...empty,
      ];
    default:
      return [
        { value: "is", label: "is exactly", input: "text" },
        { value: "is_not", label: "is not", input: "text" },
        { value: "includes", label: "contains", input: "text" },
        { value: "not_includes", label: "does not contain", input: "text" },
        ...empty,
      ];
  }
}

function defaultValue(def: OpDef | undefined): RuleCondition["value"] {
  if (!def) return null;
  if (def.input === "options") return [];
  if (def.input === "boolean") return "true";
  if (def.input === "number") return 0;
  if (def.input === "text") return "";
  return null;
}

function ValueEditor({ question, def, condition, onChange }: { question: FormQuestion | undefined; def: OpDef | undefined; condition: RuleCondition; onChange: (v: RuleCondition["value"]) => void }) {
  if (!def || def.input === "none") return <div className="hidden sm:block" />;
  if (def.input === "options") {
    const selected = Array.isArray(condition.value) ? condition.value : condition.value ? [String(condition.value)] : [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {(question?.options ?? []).map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((x) => x !== o) : [...selected, o])}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                on ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {o}
            </button>
          );
        })}
        {!(question?.options ?? []).length && <span className="text-xs text-muted-foreground">Add options to the question first.</span>}
      </div>
    );
  }
  if (def.input === "boolean") {
    return (
      <NativeSelect value={String(condition.value ?? "true")} onChange={(e) => onChange(e.target.value)}>
        <NativeSelectOption value="true">ticked</NativeSelectOption>
        <NativeSelectOption value="false">not ticked</NativeSelectOption>
      </NativeSelect>
    );
  }
  if (def.input === "number") {
    return <Input type="number" value={condition.value == null || Array.isArray(condition.value) ? "" : String(condition.value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
  }
  return (
    <Input
      type={question?.type === "date" ? "date" : "text"}
      placeholder="Value"
      value={condition.value == null || Array.isArray(condition.value) ? "" : String(condition.value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Visual editor for disqualification rules: groups of conditions on question answers.
 * Conditions inside a group are joined by AND/OR; groups are OR'ed ("any matching group disqualifies").
 */
export function RuleBuilder({ questions, value, onChange }: { questions: FormQuestion[]; value: RuleGroup[]; onChange: (next: RuleGroup[]) => void }) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const setGroup = (gi: number, patch: Partial<RuleGroup>) => onChange(value.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const setCondition = (gi: number, ci: number, next: RuleCondition) =>
    setGroup(gi, { conditions: value[gi].conditions.map((c, i) => (i === ci ? next : c)) });
  const newCondition = (): RuleCondition => {
    const q = questions[0];
    const def = operatorsFor(q)[0];
    return { questionId: q?.id ?? "", operator: def.value, value: defaultValue(def) };
  };

  if (!questions.length) {
    return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Add at least one question above to build qualification rules.</p>;
  }

  return (
    <div className="grid gap-3">
      {value.length === 0 && (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No rules yet – everybody who answers the questions can book a time. Add a rule to screen out leads that are not a fit.
        </p>
      )}
      {value.map((g, gi) => (
        <div key={g.id} className="grid gap-3">
          {gi > 0 && (
            <div className="flex items-center gap-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>
          )}
          <div className="grid gap-3 rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">Block when</span>
                <NativeSelect size="sm" value={g.combinator} onChange={(e) => setGroup(gi, { combinator: e.target.value as "and" | "or" })} aria-label="Combine conditions with">
                  <NativeSelectOption value="and">all of these</NativeSelectOption>
                  <NativeSelectOption value="or">any of these</NativeSelectOption>
                </NativeSelect>
                <span className="font-medium">match</span>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove rule group" onClick={() => onChange(value.filter((_, i) => i !== gi))}>
                <Trash2 />
              </Button>
            </div>
            {g.conditions.map((c, ci) => {
              const q = byId.get(c.questionId);
              const ops = operatorsFor(q);
              const def = ops.find((o) => o.value === c.operator) ?? ops[0];
              return (
                <div key={ci} className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_auto] sm:items-start">
                  <NativeSelect
                    className="w-full"
                    aria-label="Question"
                    value={q ? c.questionId : ""}
                    onChange={(e) => {
                      const nq = byId.get(e.target.value);
                      const nd = operatorsFor(nq)[0];
                      setCondition(gi, ci, { questionId: e.target.value, operator: nd.value, value: defaultValue(nd) });
                    }}
                  >
                    {!q && <NativeSelectOption value="">Question removed</NativeSelectOption>}
                    {questions.map((qq) => (
                      <NativeSelectOption key={qq.id} value={qq.id}>
                        {qq.label || "Untitled question"}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    className="w-full"
                    aria-label="Operator"
                    value={def.value}
                    onChange={(e) => {
                      const nd = ops.find((o) => o.value === e.target.value) ?? ops[0];
                      setCondition(gi, ci, { ...c, operator: nd.value, value: nd.input === def.input ? c.value : defaultValue(nd) });
                    }}
                  >
                    {ops.map((o) => (
                      <NativeSelectOption key={o.value} value={o.value}>
                        {o.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <ValueEditor question={q} def={def} condition={c} onChange={(v) => setCondition(gi, ci, { ...c, value: v })} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove condition"
                    onClick={() => setGroup(gi, { conditions: g.conditions.filter((_, i) => i !== ci) })}
                  >
                    <Trash2 />
                  </Button>
                  {!q && (
                    <p className="flex items-center gap-1.5 text-xs text-destructive sm:col-span-4">
                      <TriangleAlert className="size-3.5" /> This condition points at a question that was deleted – it will be dropped when you save.
                    </p>
                  )}
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setGroup(gi, { conditions: [...g.conditions, newCondition()] })}>
              <Plus /> Add condition
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" className="w-fit" onClick={() => onChange([...value, { id: `g_${nanoid(6)}`, combinator: "and", conditions: [newCondition()] }])}>
        <Plus /> Add rule group
      </Button>
    </div>
  );
}
