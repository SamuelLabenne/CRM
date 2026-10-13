"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, ChevronsUpDown, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { searchContactsAction } from "@/app/(app)/actions";
import { cn } from "@/lib/utils";

export type PickedContact = { id: string; name: string; email: string | null };

/** Searchable single-contact picker. */
export function ContactPicker({
  value,
  onChange,
  placeholder = "Select a contact…",
  className,
  excludeIds,
}: {
  value: PickedContact | null;
  onChange: (c: PickedContact | null) => void;
  placeholder?: string;
  className?: string;
  excludeIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PickedContact[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => start(async () => setHits(await searchContactsAction(q, 20))), 150);
    return () => clearTimeout(t);
  }, [q, open]);

  const visible = hits.filter((h) => !excludeIds?.includes(h.id));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className={cn("w-full justify-between font-normal", className)}>
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? `${value.name}${value.email ? ` · ${value.email}` : ""}` : placeholder}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search by name, email or company…" value={q} onValueChange={setQ} />
          <CommandList>
            {pending && (
              <div className="flex items-center justify-center p-3">
                <Spinner />
              </div>
            )}
            <CommandEmpty>
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <UserPlus className="size-4" /> No contacts found
              </span>
            </CommandEmpty>
            <CommandGroup>
              {visible.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onChange(value?.id === c.id ? null : c);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value?.id === c.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{c.name}</span>
                  {c.email && <span className="ml-auto truncate text-xs text-muted-foreground">{c.email}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
