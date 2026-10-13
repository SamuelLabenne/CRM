"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export type UrlFilterField =
  | { type: "search"; name: string; placeholder?: string }
  | { type: "select"; name: string; label: string; options: { value: string; label: string }[] };

/**
 * Filter bar that keeps its state in the URL query string (server components re-render on change).
 * Search is debounced; any change resets `page`.
 */
export function UrlFilters({ fields, className }: { fields: UrlFilterField[]; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const search = fields.find((f) => f.type === "search");
  const [q, setQ] = useState(search ? (params.get(search.name) ?? "") : "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Keep the box in sync when the URL changes elsewhere (e.g. "clear filters").
  const urlQ = search ? (params.get(search.name) ?? "") : "";
  const [seenUrlQ, setSeenUrlQ] = useState(urlQ);
  const [pushedQ, setPushedQ] = useState(urlQ);
  if (urlQ !== seenUrlQ) {
    setSeenUrlQ(urlQ);
    // Ignore the echo of our own debounced update (the user may have typed more since).
    if (urlQ !== pushedQ) setQ(urlQ);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  const active = fields.some((f) => params.get(f.name));

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70", className)}>
      {fields.map((f) =>
        f.type === "search" ? (
          <div key={f.name} className="relative min-w-48 flex-1 sm:max-w-80">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                clearTimeout(timer.current);
                const v = e.target.value.trim();
                timer.current = setTimeout(() => {
                  setPushedQ(v);
                  push({ [f.name]: v || null });
                }, 300);
              }}
              placeholder={f.placeholder ?? "Search…"}
              aria-label={f.placeholder ?? "Search"}
              className="pl-8"
            />
          </div>
        ) : (
          <NativeSelect
            key={f.name}
            aria-label={f.label}
            value={params.get(f.name) ?? ""}
            onChange={(e) => push({ [f.name]: e.target.value || null })}
          >
            <NativeSelectOption value="">{f.label}</NativeSelectOption>
            {f.options.map((o) => (
              <NativeSelectOption key={o.value} value={o.value}>
                {o.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ),
      )}
      {active && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            setPushedQ("");
            push(Object.fromEntries(fields.map((f) => [f.name, null])));
          }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" /> Clear
        </button>
      )}
    </div>
  );
}
