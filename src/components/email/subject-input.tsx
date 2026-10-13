"use client";

import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MergeTagMenu } from "./merge-tag-menu";

/** Text input with a merge-tag insert menu (inserts `{{key}}` at the caret). Used for subject & preheader. */
export function MergeTagInput({
  value,
  onChange,
  placeholder,
  id,
  maxLength = 300,
  recommended,
  className,
  "aria-invalid": invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  maxLength?: number;
  /** Soft length recommendation shown as a counter that turns amber when exceeded. */
  recommended?: number;
  className?: string;
  "aria-invalid"?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const insert = (text: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next.slice(0, maxLength));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className="relative min-w-0 flex-1">
        <Input
          ref={ref}
          id={id}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
          className={recommended ? "pr-12" : undefined}
        />
        {recommended != null && (
          <span
            className={cn(
              "pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs tabular-nums text-muted-foreground",
              value.length > recommended && "text-warning",
            )}
          >
            {value.length}
          </span>
        )}
      </div>
      <MergeTagMenu onInsert={insert} iconOnly variant="outline" />
    </div>
  );
}

/** Subject line input with merge tag menu and a length counter (inboxes show ~60 characters). */
export function SubjectInput(props: Omit<React.ComponentProps<typeof MergeTagInput>, "recommended">) {
  return <MergeTagInput placeholder="Subject line" recommended={60} {...props} />;
}
