"use client";

import { useState } from "react";
import { Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MERGE_TAG_GROUPS } from "@/lib/email/merge-tags";
import { cn } from "@/lib/utils";

/** Build the text inserted for a merge tag, with an optional fallback: {{key | "fallback"}}. */
export function mergeTagText(key: string, fallback?: string) {
  const fb = (fallback ?? "").replace(/["{}|]/g, "").trim();
  return fb ? `{{${key} | "${fb}"}}` : `{{${key}}}`;
}

/**
 * Popover listing the available merge tags. `onInsert` receives the text to insert (`{{key}}`).
 * Used by the editor toolbar and the subject/preheader inputs.
 */
export function MergeTagMenu({
  onInsert,
  label = "Merge tag",
  iconOnly,
  className,
  variant = "ghost",
  size = "sm",
}: {
  onInsert: (text: string) => void;
  label?: string;
  iconOnly?: boolean;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const [open, setOpen] = useState(false);
  const [fallback, setFallback] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={iconOnly ? "icon-sm" : size}
          className={cn(className)}
          aria-label="Insert merge tag"
          title="Insert merge tag"
          // Keep the editor selection when clicking the trigger.
          onMouseDown={(e) => e.preventDefault()}
        >
          <Braces />
          {!iconOnly && label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="border-b p-2">
          <Input
            value={fallback}
            onChange={(e) => setFallback(e.target.value)}
            placeholder="Fallback if empty (optional)"
            className="h-8"
            aria-label="Fallback text"
          />
        </div>
        <Command>
          <CommandInput placeholder="Search merge tags…" />
          <CommandList className="max-h-64">
            <CommandEmpty>No merge tags found.</CommandEmpty>
            {MERGE_TAG_GROUPS.map((g) => (
              <CommandGroup key={g.group} heading={g.group}>
                {g.tags.map((t) => (
                  <CommandItem
                    key={t.key}
                    value={`${t.label} ${t.key}`}
                    onSelect={() => {
                      onInsert(mergeTagText(t.key, fallback));
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{t.label}</span>
                    <code className="ml-auto truncate text-[11px] text-muted-foreground">{t.key}</code>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
