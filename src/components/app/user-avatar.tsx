import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Colored initials avatar for users and contacts. */
export function UserAvatar({ name, color, className }: { name: string; color?: string | null; className?: string }) {
  return (
    <Avatar className={cn("size-7 rounded-lg", className)}>
      <AvatarFallback
        className="rounded-lg text-[11px] font-semibold text-white"
        style={{ background: color ?? colorFromString(name) }}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

const PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b"];

/** Stable color for a string (used for contacts without a color). */
export function colorFromString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
