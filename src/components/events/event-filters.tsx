"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EVENT_TYPES } from "@/lib/events/utils";

/** Search + campaign + type filters kept in the URL (`?q=&campaign=&type=`), preserving the active tab. */
export function EventFilters({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const push = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    start(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`));
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  const active = params.get("q") || params.get("campaign") || params.get("type");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-52 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => push({ q: e.target.value.trim() }), 300);
          }}
          placeholder="Search events…"
          className="pl-8"
          aria-label="Search events"
        />
      </div>
      <NativeSelect aria-label="Filter by campaign" value={params.get("campaign") ?? ""} onChange={(e) => push({ campaign: e.target.value })}>
        <NativeSelectOption value="">All campaigns</NativeSelectOption>
        {campaigns.map((c) => (
          <NativeSelectOption key={c.id} value={c.id}>
            {c.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <NativeSelect aria-label="Filter by type" value={params.get("type") ?? ""} onChange={(e) => push({ type: e.target.value })}>
        <NativeSelectOption value="">All types</NativeSelectOption>
        {EVENT_TYPES.map((t) => (
          <NativeSelectOption key={t.value} value={t.value}>
            {t.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {active && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            push({ q: "", campaign: "", type: "" });
          }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" /> Clear
        </button>
      )}
    </div>
  );
}
