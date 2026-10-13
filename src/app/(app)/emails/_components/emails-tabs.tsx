import Link from "next/link";
import { cn } from "@/lib/utils";

export const EMAIL_TABS = [
  { key: "broadcasts", label: "Broadcasts" },
  { key: "templates", label: "Templates" },
  { key: "outbox", label: "Outbox" },
] as const;
export type EmailTab = (typeof EMAIL_TABS)[number]["key"];

export function parseTab(v: string | string[] | undefined): EmailTab {
  const t = Array.isArray(v) ? v[0] : v;
  return EMAIL_TABS.some((x) => x.key === t) ? (t as EmailTab) : "broadcasts";
}

/** Section tabs shown under the page title (server-rendered links, state lives in ?tab=). */
export function EmailsTabs({ active }: { active: EmailTab }) {
  return (
    <nav className="-mb-4 flex gap-1 overflow-x-auto" aria-label="Email sections">
      {EMAIL_TABS.map((t) => (
        <Link
          key={t.key}
          href={t.key === "broadcasts" ? "/emails" : `/emails?tab=${t.key}`}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
            t.key === active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
