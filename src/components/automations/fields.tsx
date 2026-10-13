"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ANY = "__any__";

export type Option = { value: string; label: string };

/** Select with an optional "any / none" choice that maps to `null`. */
export function ValueSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  anyLabel,
  className,
  id,
  invalid,
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  options: Option[];
  placeholder?: string;
  /** When set, adds a first option with this label that selects `null`. */
  anyLabel?: string;
  className?: string;
  id?: string;
  invalid?: boolean;
}) {
  const known = !value || options.some((o) => o.value === value);
  return (
    <Select value={value || (anyLabel ? ANY : "")} onValueChange={(v) => onChange(v === ANY ? null : v)}>
      <SelectTrigger id={id} aria-invalid={invalid || undefined} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {anyLabel && <SelectItem value={ANY}>{anyLabel}</SelectItem>}
        {!known && value && <SelectItem value={value}>Deleted item</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Label + control + optional hint. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Uncontrolled number input that reports valid numbers (clearing the field doesn't snap to 0 while typing).
 * Give it a `key` when the underlying value can change from outside.
 */
export function NumberField({
  value,
  onChange,
  min = 0,
  max,
  id,
  className,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  id?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      disabled={disabled}
      defaultValue={value}
      className={className}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n)) onChange(Math.round(n));
      }}
    />
  );
}
