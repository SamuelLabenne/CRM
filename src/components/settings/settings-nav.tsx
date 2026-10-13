"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Columns3, Mail, Plug, Tags, TextCursorInput, UserRound, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { title: string; href: string; icon: LucideIcon; adminOnly?: boolean };

const ITEMS: Item[] = [
  { title: "General", href: "/settings", icon: Building2, adminOnly: true },
  { title: "Profile", href: "/settings/profile", icon: UserRound },
  { title: "Email", href: "/settings/email", icon: Mail, adminOnly: true },
  { title: "Team", href: "/settings/team", icon: Users, adminOnly: true },
  { title: "Pipeline", href: "/settings/pipeline", icon: Columns3, adminOnly: true },
  { title: "Custom fields", href: "/settings/fields", icon: TextCursorInput, adminOnly: true },
  { title: "Tags", href: "/settings/tags", icon: Tags, adminOnly: true },
  { title: "Integrations", href: "/settings/integrations", icon: Plug, adminOnly: true },
];

/** Left sub-navigation on desktop; a horizontally scrolling tab strip on mobile. */
export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = ITEMS.filter((i) => isAdmin || !i.adminOnly);
  const active = (href: string) => (href === "/settings" ? pathname === "/settings" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav
      aria-label="Settings"
      className="shrink-0 border-b bg-background md:sticky md:top-14 md:h-[calc(100svh-3.5rem)] md:w-56 md:overflow-y-auto md:border-r md:border-b-0"
    >
      <div className="hidden px-5 pt-5 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase md:block">Settings</div>
      <ul className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex gap-1 overflow-x-auto px-3 py-2 md:flex-col md:overflow-visible md:px-3 md:pb-4">
        {items.map((item) => (
          <li key={item.href} className="shrink-0">
            <Link
              href={item.href}
              aria-current={active(item.href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                active(item.href) && "bg-muted text-foreground",
              )}
            >
              <item.icon className="size-4" />
              {item.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
