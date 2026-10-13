"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ColorBadge } from "@/components/app/status-badge";
import type { TagDTO } from "@/lib/contacts/dto";

/**
 * Tag chips + an "Add tag" picker. Works with tag *names*: picking an existing tag or typing a new
 * one both just add the name; the server creates missing tags (ensureTag) when the form is saved.
 */
export function TagsInput({
  value,
  onChange,
  suggestions,
  disabled,
  compact,
}: {
  value: string[];
  onChange: (names: string[]) => void;
  suggestions: TagDTO[];
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const lower = new Set(value.map((v) => v.toLowerCase()));
  const colorOf = (name: string) => suggestions.find((s) => s.name.toLowerCase() === name.toLowerCase())?.color ?? "#64748b";
  const typed = q.trim();
  const canCreate = typed.length > 0 && !suggestions.some((s) => s.name.toLowerCase() === typed.toLowerCase()) && !lower.has(typed.toLowerCase());

  const add = (name: string) => {
    const n = name.trim().slice(0, 60);
    if (!n || lower.has(n.toLowerCase())) return;
    onChange([...value, n]);
    setQ("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((name) => (
        <ColorBadge key={name} color={colorOf(name)} className="pr-1">
          {name}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove tag ${name}`}
              className="rounded-full p-0.5 hover:bg-foreground/10"
              onClick={() => onChange(value.filter((v) => v !== name))}
            >
              <X className="size-3" />
            </button>
          )}
        </ColorBadge>
      ))}
      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size={compact ? "xs" : "sm"} className="border-dashed text-muted-foreground">
              <Plus /> {value.length ? "Add" : "Add tag"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command shouldFilter>
              <CommandInput
                placeholder="Find or create a tag…"
                value={q}
                onValueChange={setQ}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canCreate) {
                    e.preventDefault();
                    add(typed);
                  }
                }}
              />
              <CommandList>
                <CommandEmpty>{canCreate ? "Press Enter to create" : "No tags yet"}</CommandEmpty>
                <CommandGroup>
                  {canCreate && (
                    <CommandItem value={`create-${typed}`} onSelect={() => add(typed)}>
                      <Plus className="size-4" /> Create “{typed}”
                    </CommandItem>
                  )}
                  {suggestions
                    .filter((s) => !lower.has(s.name.toLowerCase()))
                    .map((s) => (
                      <CommandItem key={s.id} value={s.name} onSelect={() => add(s.name)}>
                        <span className="size-2 rounded-full" style={{ background: s.color }} />
                        {s.name}
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
