"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function listTimeZones(current?: string): { zone: string; offset: string }[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = ["UTC"];
  }
  const set = new Set(zones);
  set.add("UTC");
  if (current) set.add(current);
  const now = new Date();
  return [...set]
    .sort((a, b) => a.localeCompare(b))
    .map((zone) => {
      let offset = "";
      try {
        offset =
          new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" })
            .formatToParts(now)
            .find((p) => p.type === "timeZoneName")?.value ?? "";
      } catch {
        offset = "";
      }
      return { zone, offset };
    });
}

/** Searchable IANA timezone picker. `emptyLabel` adds a "use default" option mapped to "". */
export function TimezoneSelect({
  value,
  onChange,
  id,
  emptyLabel,
  className,
  disabled,
}: {
  value: string;
  onChange: (tz: string) => void;
  id?: string;
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Only computed once the list is opened (also avoids SSR/client ICU differences).
  const zones = useMemo(() => (open ? listTimeZones(value) : []), [open, value]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", className)}
        >
          <span className="truncate">{value || emptyLabel || "Select a timezone"}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 gap-0 p-0">
        <Command>
          <CommandInput placeholder="Search timezones…" />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {emptyLabel && (
                <CommandItem
                  value="__default"
                  keywords={["default", emptyLabel]}
                  data-checked={value === ""}
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{emptyLabel}</span>
                </CommandItem>
              )}
              {zones.map(({ zone, offset }) => (
                <CommandItem
                  key={zone}
                  value={zone}
                  keywords={[zone.replace(/_/g, " "), offset]}
                  data-checked={zone === value}
                  onSelect={() => {
                    onChange(zone);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{zone.replace(/_/g, " ")}</span>
                  <span className="ml-auto pl-2 text-xs text-muted-foreground">{offset}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
