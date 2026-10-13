"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Input for a stored secret. The real value never reaches the browser: when a secret is saved
 * we only show "•••• saved" with a Replace button. `value` is "" unless the user types a new one.
 */
export function SecretInput({
  id,
  saved,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  id?: string;
  saved: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [replacing, setReplacing] = useState(false);
  if (saved && !replacing) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-input bg-muted/40 px-2.5 text-sm text-muted-foreground">
          <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
          <span className="font-mono tracking-widest">••••</span> saved
        </div>
        <Button type="button" variant="outline" onClick={() => setReplacing(true)}>
          Replace
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={replacing}
      />
      {saved && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onChange("");
            setReplacing(false);
          }}
        >
          Cancel
        </Button>
      )}
    </div>
  );
}
