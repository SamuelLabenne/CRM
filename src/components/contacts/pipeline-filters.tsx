"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import type { TagDTO, UserDTO } from "@/lib/contacts/dto";

/** Search + owner + tag filters for the pipeline board (state lives in the URL). */
export function PipelineFilters({ q, owner, tag, users, tags }: { q: string; owner: string; tag: string; users: UserDTO[]; tags: TagDTO[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nav = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };

  const active = Boolean(q || owner || tag);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-52 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          aria-label="Search pipeline"
          placeholder="Search contacts…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (timer.current) clearTimeout(timer.current);
            const v = e.target.value.trim();
            timer.current = setTimeout(() => nav({ q: v || null }), 350);
          }}
        />
        {pending && <Spinner className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />}
      </div>
      <NativeSelect size="sm" aria-label="Filter by owner" value={owner} onChange={(e) => nav({ owner: e.target.value || null })}>
        <NativeSelectOption value="">Any owner</NativeSelectOption>
        {users.map((u) => (
          <NativeSelectOption key={u.id} value={u.id}>
            {u.name}
          </NativeSelectOption>
        ))}
        <NativeSelectOption value="none">Unassigned</NativeSelectOption>
      </NativeSelect>
      <NativeSelect size="sm" aria-label="Filter by tag" value={tag} onChange={(e) => nav({ tag: e.target.value || null })}>
        <NativeSelectOption value="">Any tag</NativeSelectOption>
        {tags.map((t) => (
          <NativeSelectOption key={t.id} value={t.id}>
            {t.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setText("");
            nav({ q: null, owner: null, tag: null });
          }}
        >
          <X /> Clear
        </Button>
      )}
    </div>
  );
}
