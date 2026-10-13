"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

/** Integer input that lets you clear the field while typing (commits valid numbers on change). */
export function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  className,
  ...rest
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "min" | "max" | "type">) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  return (
    <Input
      {...rest}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      className={className}
      value={focused ? text : String(value)}
      onFocus={() => {
        setText(String(value));
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min, Math.round(n))));
      }}
    />
  );
}

export type DurationUnit = "minutes" | "hours" | "days";
const UNIT_MINUTES: Record<DurationUnit, number> = { minutes: 1, hours: 60, days: 1440 };

function bestUnit(minutes: number, units: DurationUnit[]): DurationUnit {
  const order: DurationUnit[] = ["days", "hours", "minutes"];
  for (const u of order) if (units.includes(u) && minutes > 0 && minutes % UNIT_MINUTES[u] === 0) return u;
  return units.includes("hours") && minutes === 0 ? "hours" : units[units.length - 1];
}

/** "N minutes / hours / days" editor for a value stored in minutes. */
export function DurationInput({
  value,
  onChange,
  units = ["minutes", "hours", "days"],
  min = 0,
  className,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (minutes: number) => void;
  units?: DurationUnit[];
  min?: number;
  className?: string;
  "aria-label"?: string;
}) {
  const [unit, setUnit] = useState<DurationUnit>(() => bestUnit(value, units));
  const amount = Math.round(value / UNIT_MINUTES[unit]);
  return (
    <div className={cn("flex gap-2", className)}>
      <NumberInput
        aria-label={ariaLabel}
        className="w-24"
        min={min === 0 ? 0 : Math.ceil(min / UNIT_MINUTES[unit])}
        value={amount}
        onChange={(n) => onChange(n * UNIT_MINUTES[unit])}
      />
      <NativeSelect
        aria-label={ariaLabel ? `${ariaLabel} unit` : "Unit"}
        value={unit}
        onChange={(e) => {
          const next = e.target.value as DurationUnit;
          setUnit(next);
          onChange(amount * UNIT_MINUTES[next]);
        }}
      >
        {units.map((u) => (
          <NativeSelectOption key={u} value={u}>
            {u}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
