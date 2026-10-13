"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { markNotificationsReadAction } from "@/app/(app)/actions";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export type BellItem = { id: string; title: string; body: string | null; href: string | null; readAt: Date | null; createdAt: Date };

export function NotificationsBell({ items }: { items: BellItem[] }) {
  const unread = items.filter((i) => !i.readAt).length;
  const [pending, start] = useTransition();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          <Button variant="ghost" size="xs" disabled={!unread || pending} onClick={() => start(() => markNotificationsReadAction())}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const content = (
                  <div className={cn("flex gap-2 px-3 py-2.5 text-sm hover:bg-muted/60", !n.readAt && "bg-accent/40")}>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{n.title}</span>
                      {n.body && <span className="block truncate text-muted-foreground">{n.body}</span>}
                      <span className="text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    </span>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.href ? (
                      <Link href={n.href} onClick={() => !n.readAt && start(() => markNotificationsReadAction([n.id]))}>
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
