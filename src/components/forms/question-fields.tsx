import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Answers, FormQuestion } from "@/lib/types";

/**
 * Renders public form questions as plain form controls named by question id
 * (works with FormData; multiselect uses repeated names). Server-component friendly.
 */
export function QuestionFields({
  questions,
  defaults = {},
  errors = {},
}: {
  questions: FormQuestion[];
  defaults?: Answers;
  errors?: Record<string, string>;
}) {
  return (
    <div className="grid gap-4">
      {questions.map((q) => {
        const id = `q-${q.id}`;
        const d = defaults[q.id];
        const err = errors[q.id];
        return (
          <div key={q.id} className="grid gap-2">
            {q.type !== "checkbox" && (
              <Label htmlFor={id}>
                {q.label}
                {q.required && <span className="text-destructive">*</span>}
              </Label>
            )}
            {q.type === "textarea" ? (
              <Textarea id={id} name={q.id} required={q.required} placeholder={q.placeholder} defaultValue={d == null ? "" : String(d)} rows={3} aria-invalid={!!err} />
            ) : q.type === "select" ? (
              <select
                id={id}
                name={q.id}
                required={q.required}
                defaultValue={d == null ? "" : String(d)}
                aria-invalid={!!err}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">Select…</option>
                {(q.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : q.type === "multiselect" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {(q.options ?? []).map((o) => (
                  <label key={o} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-accent">
                    <input type="checkbox" name={q.id} value={o} defaultChecked={Array.isArray(d) && d.includes(o)} className="accent-[var(--primary)]" />
                    {o}
                  </label>
                ))}
              </div>
            ) : q.type === "checkbox" ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" id={id} name={q.id} defaultChecked={d === true} required={q.required} className="accent-[var(--primary)]" />
                {q.label}
                {q.required && <span className="text-destructive">*</span>}
              </label>
            ) : (
              <Input
                id={id}
                name={q.id}
                type={q.type === "number" ? "number" : q.type === "date" ? "date" : q.type === "url" ? "url" : "text"}
                required={q.required}
                placeholder={q.placeholder}
                defaultValue={d == null ? "" : String(d)}
                aria-invalid={!!err}
              />
            )}
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Collect answers for `questions` from FormData (handles multiselect & checkbox). */
export function answersFromFormData(questions: FormQuestion[], form: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const q of questions) {
    raw[q.id] = q.type === "multiselect" ? form.getAll(q.id).map(String) : q.type === "checkbox" ? form.get(q.id) === "on" : form.get(q.id);
  }
  return raw;
}
