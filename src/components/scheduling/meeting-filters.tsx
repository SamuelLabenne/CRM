"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** URL-driven filters for /meetings (host, booking page, date range, search). */
export function MeetingFilters({
  hosts,
  pages,
  showHostAndDates = true,
}: {
  hosts: { id: string; name: string }[];
  pages: { id: string; title: string }[];
  showHostAndDates?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("p");
    router.replace(`${pathname}?${next.toString()}`);
  };

  // debounce the search box
  useEffect(() => {
    const current = sp.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => set({ q: q.trim() || null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = ["host", "page", "from", "to", "q"].some((k) => sp.get(k));

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="relative min-w-48 flex-1 sm:max-w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search" placeholder="Search contact…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {showHostAndDates && (
        <NativeSelect aria-label="Host" value={sp.get("host") ?? ""} onChange={(e) => set({ host: e.target.value || null })}>
          <NativeSelectOption value="">All hosts</NativeSelectOption>
          {hosts.map((h) => (
            <NativeSelectOption key={h.id} value={h.id}>
              {h.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
      <NativeSelect aria-label="Booking page" value={sp.get("page") ?? ""} onChange={(e) => set({ page: e.target.value || null })}>
        <NativeSelectOption value="">All booking pages</NativeSelectOption>
        {pages.map((p) => (
          <NativeSelectOption key={p.id} value={p.id}>
            {p.title}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {showHostAndDates && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Input aria-label="From date" type="date" className="w-36" value={sp.get("from") ?? ""} onChange={(e) => set({ from: e.target.value || null })} />
          <span>to</span>
          <Input aria-label="To date" type="date" className="w-36" value={sp.get("to") ?? ""} onChange={(e) => set({ to: e.target.value || null })} />
        </div>
      )}
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            const next = new URLSearchParams();
            const tab = sp.get("tab");
            const days = sp.get("days");
            if (tab) next.set("tab", tab);
            if (days) next.set("days", days);
            router.replace(`${pathname}?${next.toString()}`);
          }}
        >
          <X /> Clear
        </Button>
      )}
    </div>
  );
}
