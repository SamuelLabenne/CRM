"use client";

import { MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Answers, FormQuestion } from "@/lib/types";

function show(v: Answers[string] | undefined): string {
  if (v == null || v === "") return "–";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "–";
  return String(v);
}

/** Small "Answers" button that opens the form answers of a lead or meeting. */
export function AnswersPopover({ questions, answers, label = "Answers" }: { questions: FormQuestion[]; answers: Answers; label?: string }) {
  const known = new Set(questions.map((q) => q.id));
  const extra = Object.keys(answers).filter((k) => !known.has(k));
  const rows = [...questions.map((q) => ({ label: q.label, value: answers[q.id] })), ...extra.map((k) => ({ label: k, value: answers[k] }))];
  const answered = rows.filter((r) => r.value != null && r.value !== "" && !(Array.isArray(r.value) && !r.value.length)).length;
  if (!rows.length) return <span className="text-xs text-muted-foreground">No questions</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="xs">
          <MessageSquareText /> {label} ({answered})
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-3">
        <dl className="grid gap-3 text-sm">
          {rows.map((r, i) => (
            <div key={i}>
              <dt className="text-xs text-muted-foreground">{r.label}</dt>
              <dd className="break-words whitespace-pre-line">{show(r.value)}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
