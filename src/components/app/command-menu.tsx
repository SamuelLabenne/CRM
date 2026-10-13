"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, User } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { NAV, SETTINGS_NAV } from "./nav";
import { searchContactsAction } from "@/app/(app)/actions";

type ContactHit = { id: string; name: string; email: string | null; company: string | null };

const QUICK = [
  { label: "New contact", href: "/contacts/new" },
  { label: "New event", href: "/events/new" },
  { label: "New campaign", href: "/campaigns/new" },
  { label: "New email template", href: "/emails/templates/new" },
  { label: "New broadcast", href: "/emails/broadcasts/new" },
  { label: "New automation", href: "/automations/new" },
  { label: "New booking page", href: "/scheduling/new" },
];

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    const t = setTimeout(() => {
      startTransition(async () => setHits(await searchContactsAction(q, 6)));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <>
      <Button
        variant="outline"
        className="h-8 w-full max-w-64 justify-start gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" />
        <span className="flex-1 text-left text-sm font-normal">Search…</span>
        <Kbd>⌘K</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search contacts and pages">
        <CommandInput placeholder="Search contacts, pages, actions…" value={q} onValueChange={setQ} />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          {q.trim().length >= 2 && hits.length > 0 && (
            <CommandGroup heading="Contacts">
              {hits.map((c) => (
                <CommandItem key={c.id} value={`contact ${c.name} ${c.email ?? ""} ${c.company ?? ""}`} onSelect={() => go(`/contacts/${c.id}`)}>
                  <User />
                  <span>{c.name}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">{c.email ?? c.company}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Go to">
            {[...NAV.flatMap((g) => g.items), SETTINGS_NAV].map((item) => (
              <CommandItem key={item.href} value={`go ${item.title}`} onSelect={() => go(item.href)}>
                <item.icon />
                {item.title}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Create">
            {QUICK.map((a) => (
              <CommandItem key={a.href} value={`create ${a.label}`} onSelect={() => go(a.href)}>
                <Plus />
                {a.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
