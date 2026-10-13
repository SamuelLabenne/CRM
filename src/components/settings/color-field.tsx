"use client";

import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const BRAND_PRESETS = ["#4f46e5", "#2563eb", "#0ea5e9", "#0d9488", "#16a34a", "#d97706", "#ea580c", "#dc2626", "#db2777", "#7c3aed", "#475569", "#111827"];
export const AVATAR_PRESETS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b"];
export const TAG_PRESETS = ["#64748b", "#ef4444", "#f97316", "#f59e0b", "#10b981", "#14b8a6", "#0ea5e9", "#3b82f6", "#8b5cf6", "#ec4899"];

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHexColor = (v: string) => HEX.test(v);

/** Native color picker + hex input + preset swatches. */
export function ColorField({
  value,
  onChange,
  presets = BRAND_PRESETS,
  id,
  compact,
  className,
}: {
  value: string;
  onChange: (hex: string) => void;
  presets?: string[];
  id?: string;
  /** Hide the hex input (swatches + picker only). */
  compact?: boolean;
  className?: string;
}) {
  const valid = isHexColor(value);
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Pick a color"
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="size-8 cursor-pointer rounded-lg border border-input bg-transparent p-0.5"
        />
        {!compact && (
          <Input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`)}
            maxLength={7}
            spellCheck={false}
            aria-invalid={!valid}
            className="w-28 font-mono uppercase"
          />
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Color presets">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            title={p}
            aria-label={`Use ${p}`}
            aria-pressed={value.toLowerCase() === p}
            className="flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-ring"
            style={{ background: p }}
          >
            {value.toLowerCase() === p && <Check className="size-3.5 text-white" />}
          </button>
        ))}
      </div>
    </div>
  );
}
