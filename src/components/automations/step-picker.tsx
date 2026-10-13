"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { STEP_GROUPS, STEP_META, STEP_TYPES, type StepType } from "@/lib/automations/meta";
import { cn } from "@/lib/utils";
import { STEP_ICONS, STEP_TONE } from "./icons";

/** Popover menu of step types (icon, name, description). Wraps any trigger element. */
export function StepPicker({
  children,
  onPick,
  side = "bottom",
}: {
  children: React.ReactNode;
  onPick: (type: StepType) => void;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side={side} align="center" className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0">
        <ScrollArea className="max-h-[min(26rem,60vh)]">
          <div className="grid gap-3 p-2">
            {STEP_GROUPS.map((group) => (
              <div key={group} className="grid gap-0.5">
                <p className="px-2 pt-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{group}</p>
                {STEP_TYPES.filter((t) => STEP_META[t].group === group).map((type) => {
                  const Icon = STEP_ICONS[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onPick(type);
                      }}
                      className="flex items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    >
                      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", STEP_TONE[type])}>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{STEP_META[type].label}</span>
                        <span className="block text-xs text-muted-foreground">{STEP_META[type].description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
